/**
 * Session listing, transcripts, transcript search/images, archive/title/status/review overrides, delete.
 *
 * Extracted verbatim from the opensession.ts fetch chain. Every handler
 * returns a Response for a matched route or undefined to fall through to the
 * next handler (see routes/index.ts for the dispatch order).
 */

import { requestUser, type RouteContext } from "./context";
import { cancelAgentRun, isAgentSessionBusy, stopAgentRunTurn } from "../agent-runner";
import { archiveOlderThan, setArchived, unpinArchivedSessions } from "../archive";
import { audit } from "../audit";
import { pendingAsks } from "../asks";
import { transcriptMatchSnippet } from "../jsonl-parser";
import { classifyEntries, classifyEntry } from "@tellahq/opensession-protocol/notices";
import { withToolPresentations } from "@tellahq/opensession-protocol/tool-presentation";
import { transcriptDbPath, transcriptStore } from "../transcript-store";
import { clearSessionFileArchive } from "../plain-archive";
import { editPrReviewers, isNoPrError, prMetaForBranch } from "../pr-info";
import { promptQueues, requeueSteerReceipts, stoppedSessions } from "../queue-state";
import { markPrReviewNotified } from "../pr-review-notifications";
import { getReviewRequest, setReviewAccepted, setReviewRequest } from "../review-requests";
import { getSessionControl, type SandboxRequest } from "../session-control";
import { suggestBranchName } from "../suggest-branch";
import { transitionRunState } from "../run-state";
import {
	findSession,
	getCachedSessions,
	invalidateSessionsCache,
	maybePersistEffort,
	maybePersistFastMode,
	runErrors,
} from "../session-cache";
import { asDataUrlList, parseImageDataUrls } from "../uploads";
import { notifyMentions } from "../mentions";
import { reviewTeamFor } from "../people";
import { sendPushToUser } from "../push";
import {
	promptReceipt,
	promptReceiptKey,
	rememberPromptReceipt,
} from "../prompt-receipts";
import { searchIndex } from "../session-index";
import { resolvePrTarget } from "../session-repos";
import { destroySessionSandbox } from "../session-sandbox";
import { stopAllPortalServices } from "../portal-supervisor";
import { dropRunnerPortalRoutes } from "../runner-portals";
import { cleanupRunnerWorkspace } from "../runner-ws";
import {
	deleteSession,
	engineUserTexts,
	getAllSessions,
	mergedSessionTranscriptAsync,
} from "../sessions";
import { githubLoginFor } from "../shared/user-mappings";
import {
	getOpencodeSubagentTranscript,
	listSessionSubagents,
} from "../opencode-subagents";
import { isManualStatus, setStatusOverride } from "../status-overrides";
import { getSubagentTranscript } from "../subagents";
import { setTitleOverride } from "../title-overrides";
import { buildWorkspaceOverview, resolveTranscriptImage } from "../workspace-overview";
import { type Workspace, deleteWorkspace, getWorkspace } from "../workspaces";
import { prHostFor } from "../pr-host";
import { getRepo, removeWorktree, repoForPath } from "../worktree";
import { preparingWorkspaces } from "../ws-hub";
import { existsSync } from "fs";
import { mergedCloudSessions } from "../cloud-proxy";
import {
	githubCredentialRequiredResponse,
	githubMutationCredential,
} from "./github-credential";
import { defaultRepo } from "../config";
import type { UnifiedSession } from "../types";

const SESSIONS_RESPONSE_TTL_MS = 5_000;
interface SessionsResponseSnapshot {
	text: string;
	hash: string;
	cloudUnreachable: boolean;
	expiresAt: number;
	gzip?: Blob;
}
/**
 * Which slice of the session list a request asked for.
 *
 * Archived sessions are ~46% of this instance's payload (2,772 of 6,223 rows,
 * 3.9 MB of 8.5 MB raw), and a client that never opens one shouldn't carry
 * them through every poll. Each variant caches its own body, hash and ETag, so
 * the archived slice settles into a near-permanent 304 while the live slice
 * keeps churning on `isRunning` / `lastActivity`.
 */
export type SessionsVariant = "include" | "exclude" | "only" | "only-slim";

/** Read the requested slice off the query. Anything unrecognised means the
 *  whole list, so a typo degrades to today's behaviour rather than to an
 *  empty screen. */
export function sessionsVariant(params: URLSearchParams): SessionsVariant {
	const archived = params.get("archived");
	if (archived === "exclude") return "exclude";
	if (archived !== "only") return "include";
	return params.get("slim") === "1" ? "only-slim" : "only";
}

// Parked on globalThis so invalidateSessionsCache() can clear it without this
// module and session-cache importing each other (the same cycle-breaker
// session-cache uses to reach promptQueues). Without that, archiving a session
// stayed visible for up to SESSIONS_RESPONSE_TTL_MS after the underlying cache
// had already been invalidated — the response snapshot outlived its source.
const sessionsResponseSnapshots: Map<
	SessionsVariant,
	SessionsResponseSnapshot
> = ((globalThis as any).__osSessionsResponseSnapshots ??= new Map());

function sessionsListResponse(
	req: Request,
	snapshot: SessionsResponseSnapshot,
): Response {
	const gzip = (req.headers.get("Accept-Encoding") || "").includes("gzip");
	const etag = `"${snapshot.hash}${gzip ? "-gzip" : ""}"`;
	const headers = new Headers({
		"Cache-Control": "private, no-cache",
		"Content-Type": "application/json; charset=utf-8",
		ETag: etag,
		Vary: "Accept-Encoding",
	});
	if (snapshot.cloudUnreachable)
		headers.set("X-OpenSession-Cloud-Unreachable", "true");
	if (gzip) headers.set("Content-Encoding", "gzip");
	if (req.headers.get("If-None-Match") === etag)
		return new Response(null, { status: 304, headers });
	if (!gzip) return new Response(snapshot.text, { headers });
	if (!snapshot.gzip) {
		snapshot.gzip = new Blob([
			Bun.gzipSync(new TextEncoder().encode(snapshot.text)),
		]);
	}
	return new Response(snapshot.gzip, { headers });
}

/**
 * Overlay the live, in-process signals that aren't on the cached session
 * objects: whether a run is blocked on a human question (pendingAsks) and how
 * many prompts are queued behind it. Drives the sidebar/tab "needs input"
 * highlight without a second round-trip.
 *
 * Shared by the list and by the single-session route, so a session hydrated on
 * open carries exactly what the list would have handed the client.
 */
function enrichSession(s: UnifiedSession) {
	return {
		...s,
		repo: s.repo || defaultRepo().id,
		waitingForInput: pendingAsks.has(s.id),
		queuedCount: promptQueues.get(s.id)?.length || 0,
		// Worktree still being created by this session's create run — the
		// viewer shows "Waiting for workspace" and queues sends meanwhile.
		...(preparingWorkspaces.has(s.id) ? { workspacePreparing: true } : {}),
		// Terminal failure of the last run (credits/limits/API) — persisted
		// on opensession session files, in-memory for slack/linear sessions.
		lastRunError: runErrors.get(s.id) || s.lastRunError,
	};
}

/**
 * An archived session as the Archived surfaces actually render it: the row's
 * own text, who closed it, when, and enough identity to group and open it.
 *
 * Everything else on a session object is weight nobody reads there — a full
 * row averages ~1,400 bytes on this instance, of which `walkthrough` alone is
 * ~300 and `prs`/`usage` another ~190. Opening one of these rows hydrates the
 * real session (GET /api/sessions/:id), so nothing downstream has to make do
 * with the subset.
 */
export function archivedIndexRow(s: UnifiedSession): UnifiedSession {
	return {
		// Every field the session shape REQUIRES, carried verbatim. An index
		// row is a real session, just a poorer one — a client can merge it into
		// its list and read it like any other row instead of threading a second
		// type through every consumer. What it drops is only ever optional.
		id: s.id,
		claudeSessionId: s.claudeSessionId,
		source: s.source,
		branch: s.branch,
		worktreeDir: s.worktreeDir,
		startedBy: s.startedBy,
		title: s.title,
		lastActivity: s.lastActivity,
		createdAt: s.createdAt,
		isRunning: s.isRunning,
		transcriptPath: s.transcriptPath,
		archived: true,
		// Says out loud that this is a summary, so a client that merges it into
		// its list knows to hydrate before reading anything the index doesn't
		// carry. Without it, opening an archived session renders a session
		// that is quietly missing its PRs and its walkthrough.
		slim: true,
		// The optionals the Archived surfaces actually read: the row's own
		// text, the lens the sidebar badge filters by, and enough identity to
		// group it (the tab strip's history menu keys on workspace, falling
		// back to a shared worktree for sessions predating workspaces).
		...(s.aliasIds?.length ? { aliasIds: s.aliasIds } : {}),
		...(s.archivedReason ? { archivedReason: s.archivedReason } : {}),
		...(s.mode ? { mode: s.mode } : {}),
		...(s.automation ? { automation: s.automation } : {}),
		...(s.repo ? { repo: s.repo } : {}),
		...(s.workspaceId ? { workspaceId: s.workspaceId } : {}),
		// sessionRepo() falls back to the first external ref's kind, so a
		// repo-less feed session files under its feed rather than the default
		// repo. Identity is cheap; the ref's `url` and `title` are not, and
		// nothing on these surfaces reads them.
		...(s.externalRefs?.length
			? {
					externalRefs: [
						{ kind: s.externalRefs[0].kind, id: s.externalRefs[0].id },
					],
				}
			: {}),
		// Desk sessions are hidden from every list; clients filter on it.
		...(s.desk ? { desk: true } : {}),
	};
}

/**
 * List which of `files` contain `query` (case-insensitive, literal) via
 * ripgrep — the cheap first stage of transcript full-text search. rg exits 1
 * when nothing matches, which we treat as "no hits", not an error. Chunked so a
 * very long file list can't overflow the argv limit.
 */
async function ripgrepFiles(
	query: string,
	files: string[],
): Promise<string[]> {
	const hits = new Set<string>();
	const CHUNK = 1000;
	for (let i = 0; i < files.length; i += CHUNK) {
		const chunk = files.slice(i, i + CHUNK);
		const proc = Bun.spawn(
			["rg", "-l", "-i", "-F", "--no-messages", "--", query, ...chunk],
			{ stdout: "pipe", stderr: "ignore" },
		);
		const out = await new Response(proc.stdout).text();
		await proc.exited;
		for (const line of out.split("\n")) {
			const p = line.trim();
			if (p) hits.add(p);
		}
	}
	return [...hits];
}

export async function handleSessionsRoutes(
	ctx: RouteContext,
): Promise<Response | undefined> {
	const { req, url, path, publicPrefix } = ctx;

	// Create a session. REST shape for the native iOS/macOS apps (prompting is
	// WS-only, but creation routes through the same SessionControl path the
	// opensession-sessions MCP tools use — worktree, branch, opening run and
	// all). The web UI keeps its richer create_session WS message.
	if (path === "/api/sessions" && req.method === "POST") {
		const body = (await req.json().catch(() => null)) as {
			prompt?: unknown;
			repo?: unknown;
			mode?: unknown;
			model?: unknown;
			effort?: unknown;
			fastMode?: unknown;
			images?: unknown;
			branch?: unknown;
			user?: unknown;
			workspaceId?: unknown;
			sandbox?: unknown;
		} | null;
		const prompt = typeof body?.prompt === "string" ? body.prompt.trim() : "";
		if (!prompt) {
			return Response.json({ error: "prompt required" }, { status: 400 });
		}
		// Join an existing workspace as a sibling session — the native apps' "new
		// session in this workspace", equivalent to the web tab strip's "+".
		const workspaceId =
			typeof body?.workspaceId === "string" && body.workspaceId
				? body.workspaceId
				: "";
		const mode =
			body?.mode === "code"
				? ("code" as const)
				: body?.mode === "scratch"
					? ("scratch" as const)
					: ("ask" as const);
		let branch = typeof body?.branch === "string" ? body.branch.trim() : "";
		// A code session joining a workspace that already owns a worktree works on
		// that worktree's branch, so skip the (LLM) branch suggestion — it would
		// only be discarded. A workspace with no worktree yet still needs one.
		const joinsWorktree = !!(workspaceId && getWorkspace(workspaceId)?.worktreeDir);
		if (mode === "code" && !branch && !joinsWorktree) {
			branch =
				(await suggestBranchName(prompt).catch(() => null)) ||
				`session-${Date.now().toString(36)}`;
		}
		try {
			const { id } = await getSessionControl().createSession({
				prompt,
				mode,
				...(mode === "code" && branch ? { branch } : {}),
				...(workspaceId ? { workspaceId } : {}),
				...(typeof body?.repo === "string" && body.repo
					? { repo: body.repo }
					: {}),
				...(typeof body?.model === "string" && body.model
					? { model: body.model }
					: {}),
				...(typeof body?.effort === "string" && body.effort
					? { effort: body.effort }
					: {}),
				...(body?.fastMode === true ? { fastMode: true } : {}),
				// Where the session runs, as the native composer's sandbox chip
				// names it ("local" is the host, chosen explicitly). Omitted, the
				// instance's own default still decides — which is what every
				// caller that doesn't offer the choice wants. Validation stays
				// where the web create's does (resolveRequestedSandbox), so an
				// unavailable provider fails the create with its own message
				// rather than silently running somewhere else.
				...(typeof body?.sandbox === "string" && body.sandbox
					? { sandbox: body.sandbox as SandboxRequest }
					: {}),
				// Image attachments as data URLs (the native apps' create path;
				// validated/parsed by the wiring's parseImageDataUrls).
				...(Array.isArray(body?.images) && body.images.length
					? {
							images: body.images.filter(
								(u): u is string => typeof u === "string",
							),
						}
					: {}),
				user: requestUser(ctx, body?.user),
			});
			return Response.json({ id });
		} catch (e) {
			return Response.json(
				{ error: e instanceof Error ? e.message : String(e) },
				{ status: 400 },
			);
		}
	}

	// List sessions.
	//
	// `?archived=` slices the payload — `exclude` for the cold-start list,
	// `only` (with `slim=1` for the narrow index) for the Archived surfaces.
	// The default stays the whole list on purpose: os1-ios reads archived rows
	// straight off it (SessionsListViewModel splits the one response into
	// active + archived), so moving the default would empty the Archived
	// screen of every TestFlight build already in the wild. Clients opt in as
	// they learn to fetch the index and hydrate what they open.
	if (path === "/api/sessions" && req.method === "GET") {
		const variant = sessionsVariant(url.searchParams);
		const cached = sessionsResponseSnapshots.get(variant);
		if (cached && cached.expiresAt > Date.now())
			return sessionsListResponse(req, cached);
		const enriched = getCachedSessions().map(enrichSession);
		// Slice AFTER the cloud merge: on a local profile the upstream's
		// archived sessions belong on the Archived page too, and filtering
		// first would drop them without a trace.
		const { sessions, cloudUnreachable } = await mergedCloudSessions(enriched);
		const sliced =
			variant === "include"
				? sessions
				: variant === "exclude"
					? sessions.filter((s) => !s.archived)
					: sessions.filter((s) => s.archived);
		const text = JSON.stringify(
			variant === "only-slim" ? sliced.map(archivedIndexRow) : sliced,
		);
		const snapshot: SessionsResponseSnapshot = {
			text,
			hash: Bun.hash(text).toString(16),
			cloudUnreachable,
			expiresAt: Date.now() + SESSIONS_RESPONSE_TTL_MS,
		};
		sessionsResponseSnapshots.set(variant, snapshot);
		return sessionsListResponse(req, snapshot);
	}

	// Deliver a follow-up prompt to an existing session. REST shape for the
	// native/extension clients (os1-ios, os1-chrome) and the web durable outbox.
	// It accepts the same attachments and sibling-session context as WS.
	// Same semantics as the opensession-sessions MCP send_to_session: steers a
	// busy run by default, `busy: "queue"` waits behind it, idle starts a fresh
	// turn.
	//
	// Unlike the WS frame this one ACKNOWLEDGES: the reply names where the
	// message landed (started/steered/queued/handled), which is what lets the
	// native outbox hold a send until the server has really taken it. Composer
	// parity with the WS path — images, the effort/fast pills, @-mention
	// pushes — lives here so a client can use this as its only send path.
	{
		const m = path.match(/^\/api\/sessions\/([^/]+)\/prompt$/);
		if (m && req.method === "POST") {
			const sessionId = decodeURIComponent(m[1]);
			const body = (await req.json().catch(() => null)) as {
				content?: unknown;
				prompt?: unknown;
				user?: unknown;
				busy?: unknown;
				images?: unknown;
				effort?: unknown;
				fastMode?: unknown;
				busyMode?: unknown;
				files?: unknown;
				contextSessions?: unknown;
				clientId?: unknown;
			} | null;
			const raw =
				typeof body?.content === "string" && body.content.trim()
					? body.content
					: typeof body?.prompt === "string"
						? body.prompt
						: "";
			const content = raw.trim();
			const images = parseImageDataUrls(body?.images);
			const imageUrls = asDataUrlList(body?.images);
			// An image-only send is a real message — only reject an empty one.
			const files = Array.isArray(body?.files) ? body.files : undefined;
			if (!content && !images?.length && !files?.length) {
				return Response.json({ error: "content required" }, { status: 400 });
			}
			const clientId =
				typeof body?.clientId === "string" && body.clientId.trim()
					? body.clientId.trim().slice(0, 200)
					: undefined;
			const receiptKey = clientId
				? promptReceiptKey(sessionId, clientId)
				: undefined;
			if (receiptKey) {
				const seen = promptReceipt(receiptKey);
				// Already delivered under this id — replay the answer instead of
				// posting the message a second time.
				if (seen) return Response.json({ ...seen.body, duplicate: true });
			}
			// No findSession GATE: the 2s session cache can lag a just-created
			// session, and deliverToSession resolves the id (and reports unknown
			// ids) itself. The lookup here only drives the best-effort extras.
			const session = findSession(sessionId);
			if (session) {
				// The composer's effort/fast pills ride every send; persist a
				// change so this and future runs honor it, as the WS path does.
				maybePersistEffort(
					session,
					typeof body?.effort === "string" ? body.effort : undefined,
				);
				maybePersistFastMode(
					session,
					typeof body?.fastMode === "boolean" ? body.fastMode : undefined,
				);
			}
			const user = requestUser(ctx, body?.user);
			const busyMode =
				body?.busyMode === "queue" || body?.busy === "queue"
					? "queue"
					: body?.busyMode === "steer"
						? "steer"
						: undefined;
			const contextSessions = Array.isArray(body?.contextSessions)
				? body.contextSessions.filter((id): id is string => typeof id === "string")
				: undefined;
			const res = await getSessionControl().deliverToSession(
				sessionId,
				content,
				user,
				{
					busy: busyMode,
					// Queue-by-choice holds until the agent fully completes,
					// matching what the composers mean by "queue".
					hold: busyMode === "queue",
					images,
					imageUrls,
					files,
					contextSessions,
				},
			);
			if (res.status === "error") {
				return Response.json(
					{ ...res, error: res.message },
					{ status: /no session/i.test(res.message) ? 404 : 400 },
				);
			}
			// @People-mentions ping the tagged teammates on every delivery path,
			// exactly like the WS prompt (same matcher, never the sender).
			if (session)
				await notifyMentions(
					content,
					String(user || ""),
					sessionId,
					"prompt",
					session.title || "a session",
				);
			const payload = { ...res, ...(clientId ? { clientId } : {}) };
			if (receiptKey) rememberPromptReceipt(receiptKey, payload);
			return Response.json(payload);
		}
	}

	// Get transcript for a session
	if (
		path.match(/^\/api\/sessions\/(.+)\/transcript$/) &&
		req.method === "GET"
	) {
		const sessionId = decodeURIComponent(
			path.match(/^\/api\/sessions\/(.+)\/transcript$/)![1],
		);
		const session = findSession(sessionId);
		if (!session)
			return Response.json({ error: "Session not found" }, { status: 404 });
		// Engine-spanning read: the transcript file plus, for sessions with
		// opencode history, the opencode store (covers legacy opencode
		// sessions from before transcript persistence, and migrated
		// sessions whose history spans engines). Classified on the way out,
		// like every other send site — this is what the native clients read.
		return Response.json(
			withToolPresentations(
				classifyEntries(await mergedSessionTranscriptAsync(session)),
			),
		);
	}

	// One transcript entry, unclamped. The WS wire clamps giant entry contents
	// (clampEntriesForWire) — the bubble's "Show full message" fetches the real
	// thing here.
	{
		const m = path.match(
			/^\/api\/sessions\/(.+)\/entry\/([^/]+)$/,
		);
		if (m && req.method === "GET") {
			const session = findSession(decodeURIComponent(m[1]));
			if (!session)
				return Response.json({ error: "Session not found" }, { status: 404 });
			const entryId = decodeURIComponent(m[2]);
			// Transcript v2 (docs/transcripts.md §8): the store keeps the
			// full unstripped entry (blob when the stored row was bounded) —
			// consult it first; unknown ids and store failures fall through to
			// the legacy merged-transcript scan unchanged.
			try {
				const full = transcriptStore().getFullEntry(session.id, entryId);
				// content keeps its exact legacy shape; toolInput/images are
				// additive (existing clients ignore them) — they carry the
				// unstripped fields the bounded store row summarized away.
				if (full)
					return Response.json({
						// Same stripping the wire path applies, so expanding a
						// clamped notice doesn't suddenly reveal the sentinel and
						// "[Name] " prefix its folded form hid. The store row
						// carries no type; a user turn is the only kind that
						// arrives with delivery plumbing, and the detectors are
						// conservative enough to leave anything else alone.
						content: classifyEntry({
							id: entryId,
							type: "user",
							content: full.content,
							timestamp: "",
						}).content,
						toolInput: full.toolInput,
						images: full.images,
						featuredMedia: full.featuredMedia,
					});
			} catch {
				// store read failed — the legacy scan below still serves the entry
			}
			const found = (await mergedSessionTranscriptAsync(session)).find(
				(e) => e.id === entryId,
			);
			if (!found)
				return Response.json({ error: "Entry not found" }, { status: 404 });
			const entry = classifyEntry(found);
			return Response.json({
				content: entry.content,
				toolInput: entry.toolInput,
				images: entry.images,
				featuredMedia: entry.featuredMedia,
			});
		}
	}

	// Workspace overview: the opening prompt + all media (screenshots,
	// videos) across the workspace's member sessions — feeds the floating
	// preview panel in the session viewer. Images come back as
	// transcript-image refs (below), not inline base64.
	{
		const m = path.match(
			/^\/api\/workspaces\/([^/]+)\/overview$/,
		);
		if (m && req.method === "GET") {
			const wsId = decodeURIComponent(m[1]);
			const members = getCachedSessions().filter(
				(s) => s.workspaceId === wsId,
			);
			return Response.json(await buildWorkspaceOverview(members));
		}
	}

	// The same overview for ONE session, which is what a session's hover card
	// shows: its latest message and its own media. Scoping matters here. A
	// workspace overview answers with whichever member session spoke last, and
	// on a card headed by one session's title that is the wrong session's story.
	{
		const m = path.match(/^\/api\/sessions\/(.+)\/overview$/);
		if (m && req.method === "GET") {
			const session = findSession(decodeURIComponent(m[1]));
			if (!session)
				return Response.json({ error: "session not found" }, { status: 404 });
			return Response.json(await buildWorkspaceOverview([session]));
		}
	}

	// One image out of a transcript entry, served as real bytes (decoded
	// from the base64 block) so the overview panel can lazy-load and the
	// browser can cache thumbnails instead of shipping data URLs in JSON.
	{
		const m = path.match(
			/^\/api\/sessions\/(.+)\/transcript-image\/([^/]+)\/(\d+)$/,
		);
		if (m && req.method === "GET") {
			const session = findSession(decodeURIComponent(m[1]));
			if (!session)
				return Response.json({ error: "Session not found" }, { status: 404 });
			const entryId = decodeURIComponent(m[2]);
			const idx = parseInt(m[3], 10);
			let img = session.transcriptPath
				? await resolveTranscriptImage(session.transcriptPath, entryId, idx)
				: null;
			// Transcript v2 fallback (docs/transcripts.md §1): entries
			// >32KB are stored with images[] replaced by "os-blob:<uuid>/<i>"
			// markers; the real data-URLs live in the store's full entry. When the
			// mirror can't resolve the image, decode it from there. Guarded on the
			// DB file existing — not the flag — so images keep serving through
			// kill-switch windows.
			if (!img && existsSync(transcriptDbPath())) {
				try {
					const src = transcriptStore().getFullEntry(session.id, entryId)
						?.images?.[idx];
					if (typeof src === "string") {
						if (!src.startsWith("data:")) {
							img = { redirect: src };
						} else {
							const dm = src.match(/^data:([^;,]+);base64,(.*)$/s);
							if (dm) {
								const buf = Buffer.from(dm[2], "base64");
								img = {
									bytes: buf.buffer.slice(
										buf.byteOffset,
										buf.byteOffset + buf.byteLength,
									) as ArrayBuffer,
									contentType: dm[1],
								};
							}
						}
					}
				} catch {
					// store read failed — fall through to the 404 below
				}
			}
			if (!img)
				return Response.json({ error: "Image not found" }, { status: 404 });
			if ("redirect" in img)
				return Response.redirect(img.redirect, 302);
			return new Response(img.bytes, {
				headers: {
					"Content-Type": img.contentType,
					"Content-Length": String(img.bytes.byteLength),
					// A transcript entry never changes once written — cache hard.
					"Cache-Control": "private, max-age=86400, immutable",
				},
			});
		}
	}

	// Full-text search across session transcripts (the ⌘K palette's
	// "search in conversations"). Two-stage: a cheap ripgrep pass narrows
	// hundreds of transcripts to the few that contain the query, then we
	// parse only those (cached) to pull a clean snippet — which also drops
	// matches that only occur in transcript metadata (base64, JSON keys).
	if (path === "/api/sessions/search" && req.method === "GET") {
		const q = (url.searchParams.get("q") || "").trim();
		if (q.length < 2) return Response.json({ matches: [] });
		const byPath = new Map<string, string>(); // transcriptPath → sessionId
		for (const s of getCachedSessions()) {
			if (
				s.transcriptPath &&
				!byPath.has(s.transcriptPath) &&
				existsSync(s.transcriptPath)
			)
				byPath.set(s.transcriptPath, s.id);
		}
		const files = [...byPath.keys()];
		if (!files.length) return Response.json({ matches: [] });
		const matches: Array<{ id: string; snippet: string }> = [];
		for (const f of await ripgrepFiles(q, files)) {
			const id = byPath.get(f);
			if (!id) continue;
			const snippet = transcriptMatchSnippet(f, q);
			if (snippet) matches.push({ id, snippet });
			if (matches.length >= 50) break;
		}
		return Response.json({ matches });
	}

	// Every sub-agent this session spawned (opencode task-tool children +
	// Claude-SDK subagent layout) — feeds the Agents tab's sub-agents card.
	{
		const m = path.match(/^\/api\/sessions\/(.+)\/subagents$/);
		if (m && req.method === "GET") {
			const session = findSession(decodeURIComponent(m[1]));
			if (!session)
				return Response.json(
					{ error: "Session not found" },
					{ status: 404 },
				);
			return Response.json({
				subagents: listSessionSubagents(session),
				sessionRunning: session.isRunning,
			});
		}
	}

	// Sub-agent (Task/Agent) conversation for a session. The agentId is either
	// a Task tool_result's `agentId` (Claude SDK layout) or an opencode child
	// session id (ses_…) from the task tool / the subagents list above.
	{
		const m = path.match(
			/^\/api\/sessions\/(.+)\/subagent\/([^/]+)$/,
		);
		if (m && req.method === "GET") {
			const session = findSession(decodeURIComponent(m[1]));
			if (!session)
				return Response.json(
					{ error: "Session not found" },
					{ status: 404 },
				);
			const agentId = decodeURIComponent(m[2]);
			const sub =
				(session.transcriptPath
					? await getSubagentTranscript(session.transcriptPath, agentId)
					: null) ?? getOpencodeSubagentTranscript(session, agentId);
			if (!sub)
				return Response.json(
					{ error: "Sub-agent not found" },
					{ status: 404 },
				);
			return Response.json({ ...sub, sessionRunning: session.isRunning });
		}
	}

	// Bulk-archive idle sessions
	if (
		path === "/api/sessions/archive-old" &&
		req.method === "POST"
	) {
		const body = await req.json().catch(() => ({}));
		const days = Math.max(1, parseInt(body.days) || 7);
		const count = archiveOlderThan(getAllSessions(), days);
		invalidateSessionsCache();
		return Response.json({ archived: count });
	}

	// Archive / unarchive a single session
	const archiveMatch = path.match(
		/^\/api\/sessions\/(.+)\/archive$/,
	);
	if (archiveMatch && req.method === "POST") {
		const sessionId = decodeURIComponent(archiveMatch[1]);
		const session = findSession(sessionId);
		if (!session)
			return Response.json({ error: "Session not found" }, { status: 404 });
		const body = await req.json().catch(() => ({}));
		const archived = body.archived !== false;
		// Archiving means "I'm done with this" — so stop an owned in-flight
		// run rather than leaving an orphaned turn burning tokens after the
		// session already reads as archived. Only runs owned by this process
		// (busyHere) are stoppable; external/CLI runs can't be reached from
		// here. Graceful Esc-style stop (fall back to hard cancel for runs
		// with no interrupt support) keeps the transcript clean and resumable
		// on unarchive.
		let stoppedRun = false;
		if (
			archived &&
			isAgentSessionBusy(
				session.claudeSessionId,
				session.codexThreadId,
				session.id,
			)
		) {
			// Park the queue so the drain doesn't feed requeued steers into a
			// fresh run as the stopped one winds down.
			stoppedSessions.add(session.id);
			const stopped = stopAgentRunTurn([
				session.claudeSessionId,
				session.codexThreadId,
				session.id,
			]);
			if (!stopped) {
				cancelAgentRun(
					session.claudeSessionId,
					session.codexThreadId,
					session.id,
				);
			}
			audit({
				msg: "run_cancelled",
				session_id: session.id,
				source: "archive",
				graceful: stopped,
			});
			transitionRunState(session.id, "cancel", { source: "archive" });
			requeueSteerReceipts(session.id, engineUserTexts(session));
			stoppedRun = true;
		}
		setArchived(sessionId, archived);
		// Plain done-tickets are archived via a file-level flag, not the
		// registry; clearing only the registry would leave them archived. On
		// unarchive, also clear the file flag so the session returns to "My
		// sessions".
		if (!archived) clearSessionFileArchive(sessionId);
		invalidateSessionsCache();
		if (archived) {
			// setArchived drops the plain id pin; also drop legacy alias-id pins,
			// and the workspace pin once its last live session is archived (else the
			// row resurfaces in Pinned when a new session joins the workspace).
			unpinArchivedSessions([session], getAllSessions());
		}
		return Response.json({ ok: true, stoppedRun });
	}

	// Rename a session (manual display title; empty/blank clears it back to
	// the derived title). Works for any source via the override registry.
	const titleMatch = path.match(
		/^\/api\/sessions\/(.+)\/title$/,
	);
	if (titleMatch && req.method === "PUT") {
		const sessionId = decodeURIComponent(titleMatch[1]);
		const session = findSession(sessionId);
		if (!session)
			return Response.json({ error: "Session not found" }, { status: 404 });
		const body = await req.json().catch(() => ({}));
		const title =
			typeof body?.title === "string" ? body.title.trim().slice(0, 80) : "";
		setTitleOverride(sessionId, title || null);
		invalidateSessionsCache();
		return Response.json({ ok: true });
	}

	// Set (or clear) a session's manual sidebar-lane. `status` is one of the
	// lane keys (needsinput/inprogress/review/merged/pending); null/invalid
	// clears the override back to the derived lane.
	const statusMatch = path.match(
		/^\/api\/sessions\/(.+)\/status$/,
	);
	if (statusMatch && req.method === "PUT") {
		const sessionId = decodeURIComponent(statusMatch[1]);
		const session = findSession(sessionId);
		if (!session)
			return Response.json({ error: "Session not found" }, { status: 404 });
		const body = await req.json().catch(() => ({}));
		const status = isManualStatus(body?.status) ? body.status : null;
		setStatusOverride(sessionId, status);
		invalidateSessionsCache();
		return Response.json({ ok: true });
	}

	// Set (or clear) a session's review request — the info panel's Reviewer
		// picker. `reviewer` is a teammate display name or configured review-team
		// GitHub spec; null/empty clears the
	// request. Setting one pushes a "needs your review" notification to the
	// reviewer's registered devices (mirrors the needs-input ask push).
	const reviewMatch = path.match(
		/^\/api\/sessions\/(.+)\/review$/,
	);
	if (reviewMatch && req.method === "PUT") {
		const sessionId = decodeURIComponent(reviewMatch[1]);
		const session = findSession(sessionId);
		if (!session)
			return Response.json({ error: "Session not found" }, { status: 404 });
		const body = await req.json().catch(() => ({}));
		const by = requestUser(ctx, body?.by).slice(0, 40);

		// Accept / reopen the current request (the reviewer signing off). Keeps
		// the reviewer assignment intact but flips it to a "Reviewed" state that
		// the asker sees in their sidebar. Distinct from setting/clearing a
		// reviewer below, so it never touches GitHub's Reviewers list.
		if (typeof body?.accept === "boolean") {
			const existing = getReviewRequest(sessionId);
			if (!existing)
				return Response.json(
					{ error: "No review request to accept" },
					{ status: 400 },
				);
			setReviewAccepted(
				sessionId,
				body.accept ? { by: by || "someone", at: new Date().toISOString() } : null,
			);
			invalidateSessionsCache();
			// Buzz whoever asked for the review that it landed (not on self-review).
			if (
				body.accept &&
				existing.by &&
				existing.by.toLowerCase() !== (by || "").toLowerCase()
			) {
				void (async () => {
					try {
						const { sendPushToUser } = await import("../../server/push");
						await sendPushToUser(existing.by, {
							title: "Review complete",
							body: `${by || "Someone"} reviewed ${session.title || sessionId}`.slice(0, 180),
							url: `/session/${encodeURIComponent(sessionId)}`,
							tag: `review-${sessionId}`,
						});
					} catch {}
				})();
			}
			return Response.json({ ok: true });
		}

		const reviewer =
			typeof body?.reviewer === "string"
				? body.reviewer.trim().slice(0, 120)
				: "";
		const prevReviewer = getReviewRequest(sessionId)?.to;
		const reviewTeam = reviewTeamFor(reviewer);
		const previousReviewTeam = reviewTeamFor(prevReviewer);
		// Mirror the request onto GitHub's own Reviewers list before committing the
		// local assignment, so an auth/API failure cannot leave the two disagreeing.
		// setting a reviewer adds them, re-assigning swaps, clearing removes.
		// Only for sessions with a branch/PR whose reviewer maps to a GitHub
		// login — a phone buzz always fires below regardless.
		const addLogin = reviewer
			? reviewTeam?.github || githubLoginFor(reviewer)
			: null;
		const removeLogin =
			prevReviewer && prevReviewer !== reviewer
				? previousReviewTeam?.github ||
					(/^[\w.-]+\/[\w.-]+$/.test(prevReviewer)
						? prevReviewer
						: githubLoginFor(prevReviewer))
				: null;
		const target = resolvePrTarget(session, body?.repo);
		// Hosts without a reviewer concept (code.storage) have nothing to mirror
		// onto — the internal review request stands on its own there instead of
		// dying on the host round-trip. GitHub repos are unaffected (always true).
		const hostReviewers = target
			? prHostFor(getRepo(target.repoId)).capabilities.reviewers
			: false;
		// Whether the reviewer actually reached GitHub's list — false when there
		// was no PR to mirror onto, which the push marker below depends on.
		let mirroredToGithub = false;
		if (target && hostReviewers && (addLogin || removeLogin)) {
			const credential = githubMutationCredential(ctx);
			// No personal credential only actually blocks this when there is a PR
			// to mirror onto: `target` comes from branch metadata alone, so most
			// sessions reaching here have nothing on GitHub to change. Ask (as the
			// service identity — a read) before refusing, so an expired GitHub
			// connection can't take the internal review request down with it.
			// Fails closed: if we can't establish there's no PR, we still refuse.
			if (!credential) {
				const existing = await prMetaForBranch(
					target.branch,
					target.ghRepo,
				).catch(() => "unknown" as const);
				if (existing !== null) return githubCredentialRequiredResponse();
			} else {
				const mirrored = await editPrReviewers(
					target.branch,
					{ add: addLogin, remove: removeLogin },
					target.ghRepo,
					credential,
				).catch((e: any) => ({ error: e?.message || String(e) }));
				// Same reasoning the other way round: `gh pr edit` answering "no
				// pull requests found" is an answer, not a failure — nothing to
				// mirror, so the local request stands on its own. Every other
				// error still blocks, so a PR that DOES exist can never silently
				// disagree with the request stored here.
				if ("error" in mirrored) {
					if (!isNoPrError(mirrored.error))
						return Response.json(mirrored, { status: 502 });
				} else mirroredToGithub = true;
			}
		}
		setReviewRequest(
			sessionId,
			reviewer
				? {
						to: reviewTeam?.github || reviewer,
						...(reviewTeam ? { recipients: reviewTeam.members } : {}),
						by: by || "someone",
						at: new Date().toISOString(),
					}
				: null,
		);
		invalidateSessionsCache();
		if (reviewer) {
			// Only suppress the watcher's own push when the request really landed on
			// GitHub; marking a skipped mirror would swallow a later genuine one.
			if (mirroredToGithub && target && addLogin) {
				for (const recipient of reviewTeam?.members || [reviewer])
					markPrReviewNotified(target.ghRepo, target.branch, recipient);
			}
			// Best-effort phone buzz — never let a push hiccup fail the request.
			void (async () => {
				try {
					const { sendPushToUser } = await import("../../server/push");
					await Promise.all(
						(reviewTeam?.members || [reviewer]).map((recipient) =>
							sendPushToUser(recipient, {
								title: "Needs your review",
								body: `${by || "Someone"} asked you to review ${session.title || sessionId}`.slice(0, 180),
								url: `/session/${encodeURIComponent(sessionId)}`,
								tag: `review-${sessionId}`,
							}),
						),
					);
				} catch {}
			})();
		}
		return Response.json({ ok: true });
	}

	// One session, in the shape the list would have given it.
	//
	// Until now the list WAS the only source of a session object, which is why
	// dropping rows from it (the ?archived= slices above) needs somewhere else
	// to go: a client that no longer carries every archived session can still
	// open one and get the whole thing. Alias-aware, because a session keeps
	// its historical ids and a link may name one of those.
	//
	// Last in the family on purpose — every more specific /api/sessions/…
	// route, here and in the modules ahead of this one, has already had its
	// refusal. On a local profile the cloud proxy claims non-local ids before
	// dispatch reaches here, so hydrating a cloud session works unchanged.
	{
		const m = path.match(/^\/api\/sessions\/([^/]+)$/);
		if (m && req.method === "GET") {
			const sessionId = decodeURIComponent(m[1]);
			const session = getCachedSessions().find(
				(s) => s.id === sessionId || s.aliasIds?.includes(sessionId),
			);
			if (!session)
				return Response.json({ error: "Session not found" }, { status: 404 });
			return Response.json(enrichSession(session), {
				headers: { "Cache-Control": "private, no-cache" },
			});
		}
	}

	// Delete a session (+ optional worktree cleanup)
	if (
		path.match(/^\/api\/sessions\/(.+)$/) &&
		req.method === "DELETE"
	) {
		const sessionId = decodeURIComponent(
			path.match(/^\/api\/sessions\/(.+)$/)![1],
		);
		const session = findSession(sessionId);
		if (!session)
			return Response.json({ error: "Session not found" }, { status: 404 });

		const cleanWorktree = url.searchParams.get("worktree") === "true";
		// Purge any transcript-v2 store rows for a deleted session. Guarded on
		// the DB file existing — NOT the flag — so a kill-switch window can't
		// leave resurrectable rows behind for deterministic session ids
		// (bks-ghpr-*). Best-effort: a store hiccup must never block deletion.
		const purgeTranscriptRows = (id: string) => {
			try {
				if (existsSync(transcriptDbPath()))
					transcriptStore().deleteSessionTranscript(id);
			} catch {}
			try {
				searchIndex().remove(`session:${id}`);
			} catch {}
		};
		try {
			// Local Portals are their own detached process groups. Stop them before
			// deleting session metadata or optionally removing the worktree.
			if (session.runner)
				await dropRunnerPortalRoutes(session.id, session.runner.id, session.startedBy || undefined);
			else if (session.worktreeDir && !session.sandbox?.sandboxId)
				await stopAllPortalServices({ sessionId: session.id, worktreeDir: session.worktreeDir });
			deleteSession(session);
			// Runner workspace deletion is opt-in on the Runner. It remains
			// best-effort so an offline machine never blocks deleting a session.
			if (session.runner && session.repo && session.worktreeDir) {
				void cleanupRunnerWorkspace({ runnerId: session.runner.id, sessionId: session.id, repo: session.repo, workspacePath: session.worktreeDir, user: session.createdBy || undefined }).catch((error) =>
					console.warn(`[runners] Workspace retained after deleting ${session.id}:`, error),
				);
			}
			purgeTranscriptRows(session.id);
			invalidateSessionsCache();
			// Tear down the session's sandbox (container + engine-state volumes —
			// and in volume-workspace mode the workspace volume itself; that data
			// loss is the mode's documented contract). Best-effort and detached:
			// a docker hiccup must never block the delete.
			destroySessionSandbox(session, "delete");
			// If that was the workspace's last session, delete the workspace too —
			// otherwise auto-wrapped 1:1 workspaces linger as undeletable empty
			// sidebar rows. PR-backed workspaces (`key`) stay: they regroup new
			// sessions for the same PR.
			if (session.workspaceId) {
				const ws = getWorkspace(session.workspaceId);
				const members = getAllSessions().filter(
					(s) => s.workspaceId === session.workspaceId,
				);
				if (ws && !ws.key && members.length === 0)
					deleteWorkspace(ws.id);
			}
			if (cleanWorktree && session.worktreeDir && session.branch) {
				await removeWorktree(
					session.branch,
					repoForPath(session.worktreeDir).id,
				);
			}
			return Response.json({ ok: true });
		} catch (e: any) {
			return Response.json({ error: e.message }, { status: 500 });
		}
	}

	return undefined;
}
