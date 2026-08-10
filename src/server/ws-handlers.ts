/**
 * The UI WebSocket: watch/unwatch sessions, live prompts and queue control,
 * question answers, terminals, collaborative notes — plus the
 * create_session flow. Extracted verbatim from opensession.ts; sandbox
 * transport sockets are delegated to run-ws.ts before any of this runs.
 */

import type { WebSocketHandler } from "bun";
import type { WSClientData } from "./ws-hub";
import { cancelAgentRun, interruptAndSteerAgentRun, isAgentSessionBusy, steerAgentRun, stopAgentRunTurn } from "./agent-runner";
import { isLocalSessionUpgradeInProgress } from "./session-transfer-state";
import { audit } from "./audit";
import { pendingAsks } from "./asks";
import { mentionedUsers } from "./people";
import { sendPushToUser } from "./push";
import { startWatching, stopAllWatchesForClient, transcriptRev } from "./file-watcher";
import { INIT_WIRE_CLAMP_BYTES, entriesForWire, parseTranscriptAsync, parseTranscriptTail, parseTranscriptWindow } from "./jsonl-parser";
import { providerFor } from "./models";
import { applyNoteUpdate, getNoteState, isValidNoteId } from "./notes";
import { appendOpencodeTranscript, clearTranscriptStoreDegraded, transcriptLineRunnerNotice } from "./opencode-transcript";
import { deleteQueuedPrompt, persistQueues, promptQueues, queueWithIds, recordSteer, reorderQueuedPrompt, requeueSteerReceipts, steeredReceipts, stoppedSessions, updateQueuedPrompt } from "./queue-state";
import { transitionRunState } from "./run-state";
import { abortTurnAndDrain, enqueuePrompt, interruptQueuedPrompt, runSessionPrompt, runSessionPromptAndDrain, steerQueuedPrompt, watchExternalRunAndDrain } from "./run-session";
import { sandboxWsClose, sandboxWsMessage, sandboxWsOpen } from "./run-ws";
import { handleCreateSessionMessage } from "./session-create";
import { nodeWsClose, nodeWsMessage, nodeWsOpen } from "./node-ws";
import { type Sandbox } from "./sandbox";
import { findSession, invalidateSessionsCache, maybePersistEffort, maybePersistFastMode } from "./session-cache";
import { engineUserTexts, mergedSessionTranscript, mergedSessionTranscriptAsync, v2MirrorFiles, v2TranscriptHasDrift } from "./sessions";
import { handleSlashCommand } from "./slash-commands";
import { maybeRecapOnReturn } from "./recap";
import { resizeTerminal, startSessionTerminal, stopAllTerminals, stopTerminal, writeTerminal } from "./terminals";
import { subscribeTranscript } from "./transcript-bus";
import { resumeSessionFeed } from "./session-feed";
import { type SeqEntry, transcriptStore } from "./transcript-store";
import { startTranscriptWatch } from "./transcript-watch";
import { MAX_UPLOAD_BYTES, WS_MAX_PAYLOAD_BYTES, asDataUrlList, parseImageDataUrls } from "./uploads";
import { BOOT_ID, allClients, b64decode, b64encode, broadcastToNote, broadcastToSession, globalPresenceFrame, joinNote, joinSession, leaveNote, leaveSession, markClientSeen, revalidateLocalClients, setClientAway } from "./ws-hub";
import { existsSync, readFileSync, statSync, watch } from "fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
	cloudWebSocketClientClosed,
	routeCloudWebSocketMessage,
	verifiedCloudIdentity,
} from "./cloud-proxy";
import { isLocalProfile, setLocalProfileIdentity } from "./profile";
import {
	closeCloudProxyProtocol,
	handleCloudProxyProtocolMessage,
} from "./cloud-proxy-protocol";

// Who likely triggered the restart that booted THIS process — read once from
// the marker the previous process wrote in gracefulShutdown, and only trusted
// when the shutdown was recent (a stale marker from days ago means this boot
// wasn't that restart). Parked on globalThis so hot reloads keep the value.
function lastRestartBy(): string {
	const g = globalThis as any;
	if (g.__lastRestartBy === undefined) {
		g.__lastRestartBy = "";
		try {
			const d = JSON.parse(
				readFileSync(join(homedir(), ".opensession-last-restart.json"), "utf8"),
			);
			if (d?.by && Date.now() - Date.parse(d.at) < 10 * 60_000)
				g.__lastRestartBy = String(d.by);
		} catch {}
	}
	return g.__lastRestartBy;
}

/**
 * The non-transcript half of the watch handshake — pending question, queue +
 * steer receipts, running status. Sent on both watch paths: the full-snapshot
 * one AND the sinceOffset resume (these are cheap and idempotent; the client
 * replaces rather than merges them).
 */
function sendWatchExtras(
	ws: any,
	sessionId: string,
	session: NonNullable<ReturnType<typeof findSession>>,
): void {
	const pendingAsk = pendingAsks.get(sessionId);
	if (pendingAsk) {
		ws.send(
			JSON.stringify({
				type: "ask_question",
				sessionId,
				questionId: pendingAsk.questionId,
				questions: pendingAsk.questions,
			}),
		);
	}

	// Older in-memory rows may lack ids; assign and persist them before
	// sending so edit/delete/steer actions can address the same row.
	const queuedPrompts = queueWithIds(promptQueues.get(sessionId));
	const steeredPrompts = queueWithIds(steeredReceipts.get(sessionId));
	if (queuedPrompts.length > 0) promptQueues.set(sessionId, queuedPrompts);
	if (steeredPrompts.length > 0) steeredReceipts.set(sessionId, steeredPrompts);
	if (queuedPrompts.length > 0 || steeredPrompts.length > 0) persistQueues();
	ws.send(
		JSON.stringify({
			type: "queue_update",
			sessionId,
			queued: queuedPrompts,
			steered: steeredPrompts,
		}),
	);

	ws.send(
		JSON.stringify({
			type: "session_status",
			sessionId,
			isRunning:
				session.isRunning ||
				isAgentSessionBusy(
					session.claudeSessionId,
					session.codexThreadId,
					session.id,
				),
		}),
	);

	// The transcript snapshot above is authoritative. Replay the bounded live
	// phase after it, or send an active snapshot when the cursor cannot resume.
	if (ws.data?.supportsFeed) {
		const { frames, snapshot } = resumeSessionFeed(
			sessionId,
			ws.data.sinceFeedSeq,
			ws.data.feedEpoch,
		);
		for (const frame of frames) ws.send(JSON.stringify(frame));
		ws.send(JSON.stringify(snapshot));
	}
}

// ── Transcript v2 serve path (docs/transcripts.md §4) ──────────────
// Capability-gated: the client sends `supportsSeq: true` on watch. Eligible
// watches are served from the owned transcript store and fed live by the
// in-process bus — no mirror file-watcher polling. The legacy offset/rev
// watch below stays as the serve path for external CLI/tmux sessions and as
// the code-level fallback whenever the v2 serve refuses or throws (the env
// kill switch was retired with the mirror writes, 2026-07-23).

// Per-socket bus unsubscribe handles. Parked on globalThis so a hot reload
// can still tear down subscriptions made by the previous module instance
// (same reason file-watcher parks its watch map).
const v2Unsubs: Map<unknown, () => void> = ((globalThis as any)
	.__osTranscriptV2Unsubs ??= new Map());

/**
 * The ONE v2 teardown helper — called from all three paths that end a
 * socket's view of a session (mirroring stopAllWatchesForClient's contract):
 * watch-switch (re-watch of a different session on the same socket), unwatch,
 * and close. Releases the bus subscription and clears the v2 mark so the
 * rotation re-watch (run-session.ts) treats the socket as legacy again.
 */
function releaseTranscriptV2(ws: any): void {
	const unsub = v2Unsubs.get(ws);
	if (unsub) {
		v2Unsubs.delete(ws);
		try {
			unsub();
		} catch {}
	}
	if (ws?.data?.transcriptV2) ws.data.transcriptV2 = false;
}

/** Legacy transcripts above this mirror-file size import in the background
 *  (this watch serves legacy) instead of blocking the watch handshake — the
 *  §4 "import timeout → legacy + queued background import" behavior, applied
 *  proactively by size since the import itself is synchronous. */
const V2_SYNC_IMPORT_MAX_BYTES = 2 * 1024 * 1024;

/** Session ids with a background import scheduled (dedupe). */
const v2BgImports: Set<string> = ((globalThis as any).__osTranscriptV2BgImports ??=
	new Set());

/**
 * §4 snapshot clamp: v2 store rows are wire-bounded at 32KB, but the legacy
 * transcript-open payload clamps entries to INIT_WIRE_CLAMP_BYTES (8KB — the
 * e4e2340a slow-transcript fix; the UI eagerly renders ~6KB per bubble and
 * fetches the full entry on "Show more" anyway), so v2 init/history/backlog
 * pages go through the same budget. Same markers as entriesForWire,
 * except an already-store-stripped entry keeps its original contentLength
 * (the true pre-strip length) instead of the 32KB form's. Live
 * transcript_append frames keep the fatter store forms, same as legacy
 * appends.
 */
function clampV2InitEntries(entries: SeqEntry[]): SeqEntry[] {
	if (!entries.some((e) => (e.content?.length ?? 0) > INIT_WIRE_CLAMP_BYTES))
		return entries;
	return entries.map((e) =>
		(e.content?.length ?? 0) <= INIT_WIRE_CLAMP_BYTES
			? e
			: {
					...e,
					content: e.content.slice(0, INIT_WIRE_CLAMP_BYTES),
					contentClamped: true,
					contentLength: e.contentLength ?? e.content.length,
				},
	);
}

/** Legacy (re-)import for a session (same routine as §3's import-first
 *  gate): merged cross-engine history → importLegacyTranscript (which marks
 *  the session imported; empty history marks 'live-only'). Watermark = the
 *  TOTAL size of the §8 drift candidate set (session transcript file + oc
 *  mirror — the exact set v2TranscriptHasDrift compares against; measuring
 *  only transcriptPath would leave opencode sessions permanently
 *  grown-beyond-watermark). Also the drift RE-import: idempotent upserts, and
 *  a completed import releases the failure-side store-degraded marker. */
function v2ImportSession(
	session: NonNullable<ReturnType<typeof findSession>>,
): void {
	// Deliberately id-less ref: guarantees the legacy merge — an id-carrying
	// ref would route mergedSessionTranscript back into the v2 store path,
	// which on a drift re-import is exactly what we're refreshing.
	const entries = mergedSessionTranscript({
		transcriptPath: session.transcriptPath ?? null,
		opencodeSessionId: session.opencodeSessionId,
		claudeSessionId: session.claudeSessionId ?? null,
	});
	v2FinishImport(session, entries);
}

/** v2ImportSession for the background queue: the merge parse yields to the
 *  event loop (mergedSessionTranscriptAsync), so a multi-MB legacy transcript
 *  — exactly what gets routed here by the sync-import size ceiling — no
 *  longer wedges the server for the duration of the parse. */
async function v2ImportSessionAsync(
	session: NonNullable<ReturnType<typeof findSession>>,
): Promise<void> {
	const entries = await mergedSessionTranscriptAsync({
		transcriptPath: session.transcriptPath ?? null,
		opencodeSessionId: session.opencodeSessionId,
		claudeSessionId: session.claudeSessionId ?? null,
	});
	v2FinishImport(session, entries);
}

function v2FinishImport(
	session: NonNullable<ReturnType<typeof findSession>>,
	entries: ReturnType<typeof mergedSessionTranscript>,
): void {
	let watermark: number | null = null;
	try {
		const files = v2MirrorFiles(session);
		if (files.length) watermark = files.reduce((sum, f) => sum + f.size, 0);
	} catch {}
	transcriptStore().importLegacyTranscript(
		session.id,
		entries,
		entries.length ? "merged" : "live-only",
		watermark,
	);
	clearTranscriptStoreDegraded(
		session.id,
		session.opencodeSessionId,
		session.claudeSessionId,
	);
}

/** Queue an off-handshake import. `reimport` = the session is already
 *  imported but drifted (serveTranscriptV2's §8 check) — run the import even
 *  though needsImport is false; without it only never-imported sessions load. */
function v2QueueBackgroundImport(sessionId: string, reimport = false): void {
	if (v2BgImports.has(sessionId)) return;
	v2BgImports.add(sessionId);
	setTimeout(async () => {
		try {
			const session = findSession(sessionId);
			if (session && (reimport || transcriptStore().needsImport(sessionId)))
				await v2ImportSessionAsync(session);
		} catch (e) {
			console.warn(`[ws] v2 background import failed for ${sessionId}:`, e);
		} finally {
			v2BgImports.delete(sessionId);
		}
	}, 0);
}

/**
 * Serve a watch from the v2 store + bus. Returns true when the watch was
 * fully served (caller sends the watch extras and stops); false = not
 * eligible / import deferred / flag off — fall through to the untouched
 * legacy path.
 */
function serveTranscriptV2(
	ws: any,
	sessionId: string,
	session: NonNullable<ReturnType<typeof findSession>>,
	msg: any,
): boolean {
	if (msg.supportsSeq !== true) return false;
	// Plain loop runs don't thread a unified session id to the runner (§3), so
	// their store rows would be forever partial — refuse v2, keep legacy.
	// (Linear runs DO since transcriptSessionId landed; they lazy-import here
	// like any other session, and appends from runs started before the
	// enabling restart degrade safely via the §8 store-degraded/drift path.)
	if (sessionId.startsWith("plain-")) return false;
	// Externally-owned runs (CLI/tmux: running via PID but not in our
	// activeRuns — session-control's observe-only signal) write only their
	// transcript file. The file-watcher feeds parsed appends into the store
	// (file-watcher.ts feedTranscriptStore), but that feed only runs while
	// some legacy watch exists — a v2-only viewer set would have no feeder,
	// so v2 here would render silently stale mid-run. The refusal stays until
	// a socket-independent feed lifecycle exists — the one remaining step of
	// mirror retirement (design doc §11); mirror writes themselves are gone.
	if (
		session.isRunning &&
		!isAgentSessionBusy(session.claudeSessionId, session.codexThreadId, session.id)
	)
		return false;

	let store: ReturnType<typeof transcriptStore>;
	try {
		store = transcriptStore();
		if (store.needsImport(sessionId)) {
			// Lazy import: small legacy transcripts import synchronously inside
			// the watch; big ones import in the background and THIS watch serves
			// legacy (the next one upgrades). The ceiling measures the WHOLE §8
			// candidate set (session transcript file + oc mirror) — transcriptPath
			// alone undercounts opencode sessions, whose history mostly lives in
			// the mirror.
			let mirrorSize = 0;
			try {
				for (const f of v2MirrorFiles(session)) mirrorSize += f.size;
			} catch {}
			if (mirrorSize > V2_SYNC_IMPORT_MAX_BYTES) {
				v2QueueBackgroundImport(sessionId);
				return false;
			}
			v2ImportSession(session);
		} else if (v2TranscriptHasDrift(store, sessionId, session)) {
			// Imported but stale (§8): the mirror grew in a way the store can't
			// explain — external CLI/tmux runs while we were idle, unmapped oc
			// ids, failed store appends, kill-switch windows — or the failure-side
			// store-degraded flag is set. The bus never fires for those entries,
			// so serving v2 would render silently stale. Queue the background
			// re-import (idempotent upserts; clears the flag) and fall through to
			// the legacy file-watcher path for THIS watch — live external appends
			// keep streaming; the next watch upgrades to v2.
			v2QueueBackgroundImport(sessionId, true);
			return false;
		}
	} catch (e) {
		console.warn(`[ws] v2 import failed for ${sessionId} — legacy path:`, e);
		return false;
	}

	// From here this socket is a v2 viewer for this session. The extracted
	// protocol subscribes BEFORE reading and treats bus events as wake-ups for
	// durable changeSeq reconciliation, closing both handshake and reconnect
	// rewrite gaps.
	ws.data.transcriptV2 = true;
	try {
		const watch = startTranscriptWatch({
			sessionId,
			store,
			socket: ws,
			subscribe: subscribeTranscript,
			isCurrent: () =>
				ws.data?.watchingSessionId === sessionId && !!ws.data?.transcriptV2,
			...(msg.supportsChangeSeq === true && typeof msg.sinceChangeSeq === "number"
				? { sinceChangeSeq: msg.sinceChangeSeq }
				: {}),
			clampSnapshot: clampV2InitEntries,
			formatAppend: (frame, event) =>
				ws.data?.supportsFeed && event?.feed
					? { ...event.feed, event: frame }
					: frame,
		});
		v2Unsubs.set(ws, () => watch.unsubscribe());
	} catch (error) {
		ws.data.transcriptV2 = false;
		throw error;
	}
	return true;
}

export const websocketHandlers: WebSocketHandler<WSClientData> = {
	// Default is 16 MB — too small for a base64'd attachment near MAX_UPLOAD_BYTES,
	// which would otherwise drop the frame (close 1009) before staging. See above.
	maxPayloadLength: WS_MAX_PAYLOAD_BYTES,
	open(ws) {
		// Sandbox transport sockets (run hosts / MCP proxies dialing back)
		// are not UI clients — run-ws.ts owns them entirely.
		if (sandboxWsOpen(ws)) return;
		// Execution-node channels are not UI clients either (node-ws.ts).
		if (nodeWsOpen(ws)) return;
		allClients.add(ws);
		// Hello frame: hands the client this process's bootId so a reconnect
		// can tell a real restart (bootId changed → "restarted" toast) from a
		// transient socket blip (unchanged → clear the reconnecting pill
		// silently). Clients on servers without this frame fall back to
		// polling /api/health, which also carries bootId. `restartBy` names the
		// session that likely triggered the restart (marker written by the OLD
		// process's shutdown — see gracefulShutdown) so the toast can say who.
		try {
			ws.send(
				JSON.stringify({
					type: "hello",
					bootId: BOOT_ID,
					...(lastRestartBy() ? { restartBy: lastRestartBy() } : {}),
				}),
			);
		} catch {}
		// Who's where, once, right away: presence is broadcast on change only,
		// so without this a client that just connected shows an empty team
		// until somebody opens or leaves a session.
		try {
			ws.send(JSON.stringify(globalPresenceFrame()));
		} catch {}
		console.log("WebSocket client connected");
	},

	async message(ws, message) {
		if (sandboxWsMessage(ws, message as any)) return;
		if (nodeWsMessage(ws, message as any)) return;
		if (isLocalProfile()) {
			const identity = await verifiedCloudIdentity();
			setLocalProfileIdentity(identity);
			revalidateLocalClients(identity);
			if (!identity || ws.data.authLogin !== identity.login) {
				ws.close(4001, "Hosted GitHub session expired");
				return;
			}
		}
		let msg: any;
		try {
			msg = JSON.parse(String(message));
		} catch {
			ws.send(JSON.stringify({ type: "error", message: "Invalid JSON" }));
			return;
		}

		// A throw anywhere below used to escape as an unhandled rejection and
		// kill the whole process (2026-07-27: four crash-restarts from a prompt
		// message missing `content` — every in-process run died each time). One
		// malformed or unlucky message must never take down the server, so the
		// entire dispatch is fenced; the switch body keeps its indentation to
		// avoid a 1500-line re-indent in the shared checkout.
		try {
		// GitHub web sign-in active (web-auth.ts): the upgrade stamped this
		// socket with the cookie's verified identity — it overrides whatever
		// name the client claims in any message, so attribution and per-user
		// gating stop trusting self-declared users.
		if (ws.data?.authUser) msg.user = ws.data.authUser;
		if (
			await handleCloudProxyProtocolMessage(
				ws,
				msg,
				(lane, payload) => websocketHandlers.message?.(lane, payload),
				(lane) => websocketHandlers.close?.(lane, 1000, "cloud proxy lane closed"),
			)
		) {
			return;
		}
		if (routeCloudWebSocketMessage(ws, msg)) return;
		markClientSeen(ws);

		switch (msg.type) {
			case "ping": {
				// App-level liveness probe (browsers can't send WS protocol pings).
				// The client closes + reconnects a socket whose ping goes unanswered
				// — how a half-open iOS/Safari socket gets detected.
				ws.send('{"type":"pong"}');
				break;
			}

			case "away": {
				// Presence, not subscription: the tab went hidden or unfocused (or came
				// back). The watch stays put — the transcript must keep streaming so
				// unread counts and notifications still land — but an away socket
				// stops showing its owner's face to everyone else.
				setClientAway(ws, msg.away === true);
				// Coming back to a session whose turn finished while everyone was
				// away → drop in an away-summary system chip (recap.ts).
				const returnedTo = ws.data?.watchingSessionId;
				if (msg.away !== true && returnedTo)
					maybeRecapOnReturn(returnedTo, ws.data?.user || undefined);
				break;
			}

			case "watch": {
				const sessionId = msg.sessionId;
				const session = findSession(sessionId);
				if (!session) {
					ws.send(
						JSON.stringify({ type: "error", message: "Session not found" }),
					);
					return;
				}

				// Stop watching any previous session first
				stopAllWatchesForClient(ws);
				releaseTranscriptV2(ws);
				leaveSession(ws);

				const data = ws.data;
				data.watchingSessionId = sessionId;
				data.supportsFeed = msg.supportsFeed === true;
				data.sinceFeedSeq =
					typeof msg.sinceFeedSeq === "number" ? msg.sinceFeedSeq : undefined;
				data.feedEpoch =
					typeof msg.feedEpoch === "string" ? msg.feedEpoch : undefined;
				if (msg.user) data.user = msg.user;
				joinSession(ws, sessionId);

				// Opening a session whose last turn finished with nobody watching →
				// drop in an away-summary system chip (recap.ts). Fire-and-forget;
				// the recap arrives through the transcript bus like any append.
				maybeRecapOnReturn(sessionId, data.user || undefined);

				// Transcript v2 (flag + supportsSeq gated): eligible watches are
				// served from the owned store + bus with seq cursors — no mirror
				// file-watcher. Ineligible/flag-off falls through byte-identical.
				// The call itself is guarded: a throw anywhere in the v2 path must
				// degrade to the legacy watch, never kill the watch silently (a
				// cold-boot binding failure did exactly that on 2026-07-23 — the
				// client got no init and no error).
				let v2Served = false;
				try {
					v2Served = serveTranscriptV2(ws, sessionId, session, msg);
				} catch (e) {
					console.error(
						`[ws] transcript v2 serve threw for ${sessionId} — falling back to legacy watch:`,
						e,
					);
				}
				if (v2Served) {
					sendWatchExtras(ws, sessionId, session);
					break;
				}

				// Reconnect resume: a client that still holds this session's entries
				// re-watches with the byte cursor of the last transcript frame it
				// received (sinceOffset + sinceRev from transcript_init/append). When
				// the cursor still matches the live mirror file — same rev (the
				// transcript didn't rotate to a new engine id) and an offset the file
				// still covers — skip the full-tail transcript_init replace and let
				// the file-watcher's gap-fill replay exactly the missed entries from
				// the jsonl (the client's id-keyed upsert absorbs any overlap). The
				// jsonl IS the replay buffer: append-only, restart-proof, and it
				// covers entries written while nobody was watching. Any mismatch
				// falls through to the full snapshot below.
				const sinceOffset =
					typeof msg.sinceOffset === "number" && msg.sinceOffset > 0
						? msg.sinceOffset
						: undefined;
				if (
					sinceOffset !== undefined &&
					typeof msg.sinceRev === "string" &&
					session.transcriptPath &&
					msg.sinceRev === transcriptRev(session.transcriptPath) &&
					existsSync(session.transcriptPath) &&
					sinceOffset <= statSync(session.transcriptPath).size
				) {
					startWatching(session.transcriptPath, ws, sinceOffset, sessionId);
					sendWatchExtras(ws, sessionId, session);
					break;
				}

				// Send one bounded transcript tail so the loading state transitions to
				// a complete conversation instead of first painting a screenful and
				// prepending the rest a beat later. The tighter INIT wire clamp keeps
				// that snapshot manageable: the UI eagerly renders only
				// ~6KB of markdown per bubble and fetches the full entry on demand,
				// so the fat 32KB clamp only bought transfer time (a heavy tail hit
				// 1.7MB on the wire). `startOffset` is the pagination cursor for
				// "load earlier".
				let { entries, truncated, endOffset, startOffset } = session.transcriptPath
					? parseTranscriptTail(session.transcriptPath)
					: { entries: [], truncated: false, endOffset: 0, startOffset: 0 };
				if (!entries.length) {
					// No mirror file yet — a fresh session, or an engine-id rotation
					// whose next run hasn't seeded the new id's file. Without this the
					// thread renders blank until the next send (which seeds the file);
					// serve history via the cross-engine fallback (old transcript file
					// merged with OpenCode's SQLite store) instead. No byte cursor into
					// a file here, so no "load earlier" paging — the next run's seeded
					// file restores it.
					const merged = await mergedSessionTranscriptAsync(session);
					if (merged.length) {
						truncated = merged.length > 120;
						entries = truncated ? merged.slice(-120) : merged;
						startOffset = 0;
					}
				}
				ws.send(
					JSON.stringify({
						type: "transcript_init",
						sessionId,
						entries: entriesForWire(entries, INIT_WIRE_CLAMP_BYTES),
						truncated,
						startOffset,
						// Resume cursor (see the sinceOffset branch above): where this
						// snapshot ends in the mirror file, and which file that was.
						...(session.transcriptPath
							? { endOffset, rev: transcriptRev(session.transcriptPath) }
							: {}),
					}),
				);

				// Start file watcher from where the tail parse left off — bytes
				// appended between the parse and the watch would otherwise be lost.
				if (session.transcriptPath) {
					startWatching(session.transcriptPath, ws, endOffset, sessionId);
				}

				sendWatchExtras(ws, sessionId, session);
				break;
			}

			case "unwatch": {
				// Viewer navigated away from the session (not just to another one):
				// stop streaming transcript events and clear their ghost presence.
				// Mirrors the disconnect/close cleanup; leaveSession broadcasts
				// presence to the viewers who remain.
				stopAllWatchesForClient(ws);
				releaseTranscriptV2(ws);
				leaveSession(ws);
				break;
			}

			case "load_history": {
				// "Load earlier history": one PAGE of history — the byte window just
				// before the client's earliest offset (`beforeOffset`, threaded from
				// transcript_init/transcript_history startOffset). The old behavior
				// (re-send the ENTIRE transcript) hit ~15MB wire payloads and a
				// 600-bubble render on big transcripts; it survives only as the
				// fallback for clients that don't send an offset.
				//
				// Transcript v2 seq paging: a client in seq mode pages backwards
				// with `beforeSeq` → one ~40-entry page from the store. Legacy
				// offset paging below is untouched; a store failure falls
				// through to it.
				if (typeof msg.beforeSeq === "number" && msg.beforeSeq > 0) {
					try {
						// "Jump to the start" walks the entire backlog, so it asks for
						// fatter pages: fewer round trips, and — the real cost — fewer
						// whole-transcript reconciliations per entry recovered. Capped
						// because each entry is only clamped to 8KB on the wire.
						const page = transcriptStore().readBefore(
							msg.sessionId,
							Math.floor(msg.beforeSeq),
							Math.min(Math.max(1, Math.floor(msg.limit ?? 40)), 500),
						);
						ws.send(
							JSON.stringify({
								type: "transcript_history",
								sessionId: msg.sessionId,
								// Backlog pages take the same init clamp as legacy history
								// pages (see clampV2InitEntries).
								entries: clampV2InitEntries(page.entries),
								firstSeq: page.firstSeq,
								lastSeq: page.lastSeq,
								truncated: page.firstSeq > 1,
								v2: true,
							}),
						);
						break;
					} catch (e) {
						console.warn(`[ws] v2 load_history failed for ${msg.sessionId}:`, e);
					}
				}
				const session = findSession(msg.sessionId);
				if (!session?.transcriptPath) {
					// Same no-mirror-file state as the watch fallback: serve the merged
					// cross-engine history rather than blanking the client's view.
					ws.send(
						JSON.stringify({
							type: "transcript_init",
							sessionId: msg.sessionId,
							entries: session
								? entriesForWire(
										await mergedSessionTranscriptAsync(session),
									)
								: [],
							truncated: false,
						}),
					);
					return;
				}
				const before =
					typeof msg.beforeOffset === "number" && msg.beforeOffset > 0
						? msg.beforeOffset
						: null;
				if (before !== null) {
					const rev = transcriptRev(session.transcriptPath);
					let fileSize: number | null = null;
					try {
						if (existsSync(session.transcriptPath)) {
							fileSize = statSync(session.transcriptPath).size;
						}
					} catch {
						fileSize = null;
					}
					if (
						msg.beforeRev !== rev ||
						fileSize === null ||
						before > fileSize
					) {
						if (fileSize === null) {
							ws.send(
								JSON.stringify({
									type: "transcript_init",
									sessionId: msg.sessionId,
									entries: entriesForWire(
										await mergedSessionTranscriptAsync(session),
									),
									truncated: false,
								}),
							);
							break;
						}
						const tail = parseTranscriptTail(session.transcriptPath);
						ws.send(
							JSON.stringify({
								type: "transcript_init",
								sessionId: msg.sessionId,
								entries: entriesForWire(tail.entries, INIT_WIRE_CLAMP_BYTES),
								truncated: tail.truncated,
								startOffset: tail.startOffset,
								endOffset: tail.endOffset,
								rev,
							}),
						);
						break;
					}
					// ~40 entries per page; the 1MB soft window cap bounds the server
					// read through fat tool-result regions, but the parser still
					// guarantees ≥10 entries per page (see parseTranscriptWindow) —
					// 2-entry pages made "load earlier" feel broken and kept the
					// infinite-scroll sentinel in range, chaining loads every ~1.6s.
					const page = parseTranscriptWindow(
						session.transcriptPath,
						before,
						undefined,
						40,
						1024 * 1024,
					);
					ws.send(
						JSON.stringify({
							type: "transcript_history",
							sessionId: msg.sessionId,
							entries: entriesForWire(page.entries, INIT_WIRE_CLAMP_BYTES),
							truncated: page.truncated,
							startOffset: page.startOffset,
						}),
					);
					break;
				}
				const entries = await parseTranscriptAsync(session.transcriptPath);
				ws.send(
					JSON.stringify({
						type: "transcript_init",
						sessionId: msg.sessionId,
						entries: entriesForWire(entries),
						truncated: false,
					}),
				);
				break;
			}

			case "prompt": {
				const { sessionId, user } = msg;
				// Non-string content (a client bug — e.g. `text` instead of
				// `content`) used to flow all the way into the run path and crash
				// the process. Coerce, and reject a send with nothing in it.
				const content = typeof msg.content === "string" ? msg.content : "";
				const images = parseImageDataUrls(msg.images);
				const imageUrls = asDataUrlList(msg.images);
				if (
					!content.trim() &&
					!images?.length &&
					!(Array.isArray(msg.files) && msg.files.length)
				) {
					ws.send(
						JSON.stringify({ type: "error", message: "Empty prompt (no content/images/files)" }),
					);
					return;
				}
				const session = findSession(sessionId);
				if (!session) {
					ws.send(
						JSON.stringify({ type: "error", message: "Session not found" }),
					);
					return;
				}
				if (session.upgradedTo || isLocalSessionUpgradeInProgress(sessionId)) {
					ws.send(
						JSON.stringify({
							type: "error",
							message: "This session is being upgraded to the cloud. Retry the prompt in the cloud session.",
						}),
					);
					return;
				}

				// The composer's effort pill rides every send; persist a change so
				// this and future runs (queue drains, resumes) honor it.
				maybePersistEffort(session, msg.effort);
				maybePersistFastMode(session, msg.fastMode);

				// Slash commands are handled by opensession itself
				const notice = handleSlashCommand(
					session,
					String(content || "").trim(),
					user,
				);
				if (notice !== null) {
					ws.send(JSON.stringify({ type: "notice", message: notice }));
					invalidateSessionsCache();
					break;
				}

				// @People-mentions in a prompt ping the tagged teammates (roster
				// from the identity config, never the sender). Fires at send time
				// on every path — direct, queued, steer.
				{
					const promptText = String(content || "");
					if (promptText.includes("@")) {
						const preview =
							promptText.length > 140
								? `${promptText.slice(0, 139)}…`
								: promptText;
						for (const name of mentionedUsers(promptText, String(user || ""))) {
							void sendPushToUser(name, {
								title: `${user || "Someone"} mentioned you in ${session.title || "a session"}`,
								body: preview,
								url: `/session/${encodeURIComponent(sessionId)}`,
								tag: `opensession-mention-${sessionId}`,
							});
						}
					}
				}

				// Busy sends queue by default, so the user can still delete/edit or
				// manually steer the message. Settings can opt the composer into
				// steer-by-default (`busyMode: "steer"`), delivered at the next turn
				// boundary and falling back to queue when the run isn't steerable.
				if (
					isAgentSessionBusy(
						session.claudeSessionId,
						session.codexThreadId,
						session.id,
					)
				) {
					if (msg.busyMode === "queue") {
						enqueuePrompt(sessionId, {
							content,
							user,
							images: imageUrls,
							files: msg.files,
							// Queue-by-choice: held until the agent FULLY completes
							// (including running child workers), not just until the
							// next turn boundary. Steer is the deliver-sooner path.
							hold: true,
						});
						watchExternalRunAndDrain(sessionId);
						break;
					}
					const attributed = user ? `[${user}] ${content}` : content;
					// Images fold into the live run as content blocks; disk-staged
					// files can't ride the steer channel, so a send carrying files
					// falls through to the queue (its drain delivers images + files
					// together at the run's next idle point).
					const hasFiles = Array.isArray(msg.files) && msg.files.length > 0;
					if (
						msg.busyMode === "steer" &&
						!hasFiles &&
						steerAgentRun(
							[session.claudeSessionId, session.codexThreadId, session.id],
							attributed,
							images,
						)
					) {
						// The message lands in the transcript when its turn starts. Until
						// then a steer receipt is the durable visible record (survives
						// reload/leave); kept out of promptQueues so the drain never
						// re-delivers it, and cleared when the run finishes.
						recordSteer(sessionId, { content, user, images: imageUrls });
						break;
					}
					enqueuePrompt(sessionId, {
						content,
						user,
						images: imageUrls,
						files: msg.files,
					});
					watchExternalRunAndDrain(sessionId);
					break;
				}

				// Codex sessions start a fresh thread on first prompt. Open Session
				// sessions with no engine id are *fresh* sessions (a new sibling from the
				// tab strip's +): runSessionPrompt starts a new conversation. Only
				// non-opensession sources genuinely need an id to resume.
				if (
					providerFor(session.model) === "claude" &&
					!session.claudeSessionId &&
					session.source !== "opensession"
				) {
					ws.send(
						JSON.stringify({
							type: "error",
							message: "No Claude session to resume",
						}),
					);
					return;
				}

				// Sibling-session transcripts attached via the fresh-session chips.
				const contextSessions = Array.isArray(msg.contextSessions)
					? msg.contextSessions.filter(
							(id: unknown): id is string => typeof id === "string",
						)
					: undefined;
				await runSessionPromptAndDrain(
					sessionId,
					content,
					user,
					images,
					msg.files,
					contextSessions,
				);
				break;
			}

			case "interrupt_prompt": {
				// Esc-style redirect: stop the current turn, keep the session, and
				// continue right away with this message. Falls back to a normal
				// prompt (steer/queue/run) when there's nothing to interrupt.
				const { sessionId, content, user } = msg;
				const images = parseImageDataUrls(msg.images);
				const imageUrls = asDataUrlList(msg.images);
				const session = findSession(sessionId);
				if (!session) {
					ws.send(
						JSON.stringify({ type: "error", message: "Session not found" }),
					);
					return;
				}
				if (session.upgradedTo || isLocalSessionUpgradeInProgress(sessionId)) {
					ws.send(
						JSON.stringify({
							type: "error",
							message: "This session is being upgraded to the cloud. Retry the prompt in the cloud session.",
						}),
					);
					return;
				}
				maybePersistEffort(session, msg.effort);
				maybePersistFastMode(session, msg.fastMode);
				const attributed = user ? `[${user}] ${content}` : content;
				// Files can't ride the interrupt/steer content-block channel — a send
				// carrying files falls through to the queue (drain delivers images +
				// files together), so it isn't interrupted here.
				const hasFiles = Array.isArray(msg.files) && msg.files.length > 0;
				if (
					!hasFiles &&
					isAgentSessionBusy(
						session.claudeSessionId,
						session.codexThreadId,
						session.id,
					) &&
					interruptAndSteerAgentRun(
						[session.claudeSessionId, session.codexThreadId, session.id],
						attributed,
						images,
					)
				) {
					// Interrupt aborts the current turn and continues immediately, so
					// the message lands in the transcript almost at once — no steer
					// receipt ("folded in" would be wrong for an interrupt) and no system
					// notice. The sender's optimistic bubble reconciles when its real
					// turn appears; the SDK's "[Request interrupted by user]" marker is
					// filtered out in jsonl-parser.
					break;
				}
				// No in-band interrupt-and-steer (opencode runs, or a send carrying
				// files): queue the message durably, then abort the current turn so
				// the drain delivers it as the immediate next turn — esc+enter
				// semantics. If nothing is abortable either (external CLI/tmux run),
				// it stays queued for the natural stopping point, so nothing — text
				// or attachment — is lost.
				if (
					isAgentSessionBusy(
						session.claudeSessionId,
						session.codexThreadId,
						session.id,
					)
				) {
					enqueuePrompt(sessionId, {
						content,
						user,
						images: imageUrls,
						files: msg.files,
					});
					if (!abortTurnAndDrain(sessionId, session)) {
						watchExternalRunAndDrain(sessionId);
					}
					break;
				}
				await runSessionPromptAndDrain(
					sessionId,
					content,
					user,
					images,
					msg.files,
				);
				break;
			}

			case "delete_queued_prompt": {
				const { sessionId, queueId, queueIndex } = msg;
				deleteQueuedPrompt(sessionId, queueId, queueIndex);
				break;
			}

			case "update_queued_prompt": {
				const { sessionId, queueId, queueIndex, content } = msg;
				const next = String(content || "").trim();
				// Present-but-empty means "this message now carries no images",
				// which asDataUrlList can't express (it collapses [] to
				// undefined, the "unchanged" signal) — so read the key itself.
				const nextImages = Array.isArray(msg.images)
					? (asDataUrlList(msg.images) ?? [])
					: undefined;
				if (!next && !nextImages?.length) {
					// Nothing left to send: an edit that empties a message is
					// how the queue is cleared from a text field.
					deleteQueuedPrompt(sessionId, queueId, queueIndex);
				} else {
					updateQueuedPrompt(sessionId, queueId, queueIndex, next, nextImages);
				}
				break;
			}

			case "steer_queued_prompt": {
				const { sessionId, queueId, queueIndex } = msg;
				if (!steerQueuedPrompt(sessionId, queueId, queueIndex)) {
					ws.send(
						JSON.stringify({
							type: "notice",
							sessionId,
							message:
								"Could not steer that queued message right now. It is still queued.",
						}),
					);
				}
				break;
			}

			case "interrupt_queued_prompt": {
				const { sessionId, queueId, queueIndex } = msg;
				if (!interruptQueuedPrompt(sessionId, queueId, queueIndex)) {
					ws.send(
						JSON.stringify({
							type: "notice",
							sessionId,
							message:
								"Could not interrupt with that message right now. It is still queued.",
						}),
					);
				}
				break;
			}

			case "reorder_queued_prompt": {
				const { sessionId, order } = msg;
				if (Array.isArray(order) && order.every((x) => typeof x === "string")) {
					reorderQueuedPrompt(sessionId, order);
				}
				break;
			}

			case "cancel": {
				const data = ws.data;
				if (data.watchingSessionId) {
					const sessionId = data.watchingSessionId;
					const session = findSession(sessionId);
					// Park the queue until the user's next explicit action —
					// otherwise the drain would deliver the requeued steers into a
					// fresh run the moment the stopped one winds down.
					stoppedSessions.add(sessionId);
					if (session) {
						// Esc-style: gracefully interrupt the current turn (the run
						// winds down at the forced boundary with a clean transcript).
						// Hard cancel only for runs with no interrupt support (codex,
						// external processes); the full kill lives on session delete.
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
						// A stopped run's only trace is the runner's anonymous
						// "cancelled" turn event — record who pulled the plug (stop
						// button / Esc), or diagnosing "why did it go silent?" means
						// inferring the gesture by elimination.
						console.log(
							`[ws] run stopped on ${sessionId} by ${data.user || "unknown"} (${stopped ? "graceful" : "hard-cancel"})`,
						);
						audit({
							msg: "run_cancelled",
							session_id: sessionId,
							source: "ui_stop",
							user: data.user,
							graceful: stopped,
						});
						transitionRunState(sessionId, "cancel", {
							source: "ui_stop",
							user: data.user,
						});
						// Durable trace in the transcript too: a stopped turn otherwise
						// just goes silent mid-tool-call, and readers can't tell a
						// deliberate stop from a crash (the audit line answers it for
						// the agent, this chip answers it for everyone reading the UI).
						if (session.claudeSessionId) {
							try {
								appendOpencodeTranscript(session.claudeSessionId, [
									transcriptLineRunnerNotice(
										`Turn stopped by ${data.user || "someone"} (stop button / Esc).`,
									),
								]);
							} catch {}
						}
					}
					const requeued = requeueSteerReceipts(
						sessionId,
						session ? engineUserTexts(session) : undefined,
					);
					if (requeued > 0) {
						broadcastToSession(sessionId, {
							type: "notice",
							message: `Stopped — ${requeued} steered message${requeued === 1 ? "" : "s"} returned to the queue.`,
						});
					}
				}
				break;
			}

			case "answer_question": {
				const { sessionId, questionId, answers } = msg;
				const pending = pendingAsks.get(sessionId);
				if (pending && pending.questionId === questionId) {
					pending.resolve(
						answers && typeof answers === "object" ? answers : null,
					);
				}
				break;
			}

			// ── Interactive shell (Shell tab) — multiple PTYs per socket, one
			// per shell tab, keyed by the client's termId ("0" for legacy
			// clients that predate multi-tab shells). Outbound frames are
			// tagged with the termId so the client routes them to the right tab.
			case "term_start": {
				const termId = typeof msg.termId === "string" ? msg.termId : "0";
				// Sandbox-aware: docker/daytona sessions get the shell INSIDE
				// their sandbox; host worktree shell otherwise (terminals.ts).
				void startSessionTerminal(ws, termId, findSession(msg.sessionId), {
					cols: Number(msg.cols) || undefined,
					rows: Number(msg.rows) || undefined,
					send: (m) => {
						try {
							ws.send(JSON.stringify({ ...m, termId }));
						} catch {}
					},
				});
				break;
			}
			case "term_input": {
				if (typeof msg.data === "string")
					writeTerminal(
						ws,
						typeof msg.termId === "string" ? msg.termId : "0",
						msg.data,
					);
				break;
			}
			case "term_resize": {
				resizeTerminal(
					ws,
					typeof msg.termId === "string" ? msg.termId : "0",
					Number(msg.cols),
					Number(msg.rows),
				);
				break;
			}
			case "term_stop": {
				stopTerminal(ws, typeof msg.termId === "string" ? msg.termId : "0");
				break;
			}

			case "create_session": {
				await handleCreateSessionMessage(ws, msg);
				break;
			}
			// ── Collaborative notes (Yjs over the shared socket) ──
			case "watch_note": {
				const noteId = msg.noteId;
				if (!isValidNoteId(noteId)) {
					ws.send(
						JSON.stringify({ type: "error", message: "Invalid note id" }),
					);
					return;
				}
				// Leave any previously-watched note first (one note per client).
				leaveNote(ws);
				if (msg.user) ws.data.user = msg.user;
				ws.data.watchingNoteId = noteId;
				joinNote(ws, noteId);
				// Send the full current doc state so the client syncs immediately.
				ws.send(
					JSON.stringify({
						type: "note_state",
						noteId,
						update: b64encode(getNoteState(noteId)),
					}),
				);
				break;
			}

			case "leave_note": {
				leaveNote(ws);
				break;
			}

			case "note_update": {
				const noteId = msg.noteId;
				if (!isValidNoteId(noteId) || typeof msg.update !== "string")
					return;
				try {
					applyNoteUpdate(noteId, b64decode(msg.update));
				} catch {}
				// Relay to the other editors of this note.
				broadcastToNote(
					noteId,
					{ type: "note_update", noteId, update: msg.update },
					ws,
				);
				break;
			}

			case "note_awareness": {
				const noteId = msg.noteId;
				if (!isValidNoteId(noteId) || typeof msg.update !== "string")
					return;
				// Cursors/presence are ephemeral — relay only, never persist.
				broadcastToNote(
					noteId,
					{ type: "note_awareness", noteId, update: msg.update },
					ws,
				);
				break;
			}
		}
		} catch (e) {
			console.error(`[ws] ${msg?.type || "unknown"} handler failed:`, e);
			try {
				ws.send(
					JSON.stringify({
						type: "error",
						message: `Internal error handling "${msg?.type || "message"}" — see server log`,
					}),
				);
			} catch {}
		}
	},

	close(ws) {
		if (sandboxWsClose(ws)) return;
		if (nodeWsClose(ws)) return;
		closeCloudProxyProtocol(ws, (lane) =>
			websocketHandlers.close?.(lane, 1000, "cloud proxy disconnected"),
		);
		cloudWebSocketClientClosed(ws);
		allClients.delete(ws);
		stopAllWatchesForClient(ws);
		releaseTranscriptV2(ws);
		leaveSession(ws);
		leaveNote(ws);
		stopAllTerminals(ws); // the Shell tabs' PTYs die with their socket
		console.log("WebSocket client disconnected");
	},
};
