import type { UnifiedSession } from "./types";
import { mainSession } from "./landing-session";

export type SessionPrRef = NonNullable<UnifiedSession["prs"]>[number];

function githubPrIdentity(
	value: string | undefined,
): { repo: string; number: number } | undefined {
	if (!value) return undefined;
	try {
		const url = new URL(value.trim());
		if (url.hostname.toLowerCase() !== "github.com") return undefined;
		const match = url.pathname.match(
			/^\/([^/]+)\/([^/]+)\/pull\/(\d+)(?:\/|$)/i,
		);
		if (!match?.[2] || !match[3]) return undefined;
		return { repo: match[2].toLowerCase(), number: Number(match[3]) };
	} catch {
		return undefined;
	}
}

function canonicalPrUrl(value: string | undefined): string | undefined {
	if (!value) return undefined;
	try {
		const url = new URL(value.trim());
		const github =
			url.hostname.toLowerCase() === "github.com"
				? url.pathname.match(/^\/([^/]+)\/([^/]+)\/pull\/(\d+)(?:\/|$)/i)
				: null;
		if (github) {
			return `https://github.com/${github[1]?.toLowerCase()}/${github[2]?.toLowerCase()}/pull/${github[3]}`;
		}
		url.hash = "";
		url.search = "";
		url.pathname = url.pathname.replace(/\/+$/, "");
		return url.toString().toLowerCase();
	} catch {
		return undefined;
	}
}

/** Match pasted PR links even when GitHub adds a tab, query, or trailing slash. */
export function prLinksMatch(
	query: string,
	candidate: string | undefined,
): boolean {
	const target = canonicalPrUrl(query);
	return target !== undefined && target === canonicalPrUrl(candidate);
}

/** Does a pasted PR link belong to any PR associated with this session? */
export function sessionUsesPrLink(session: UnifiedSession, query: string): boolean {
	const urls = [
		session.prUrl,
		...(session.prs || []).map((pr) => pr.url),
		...(session.linkedPrs || []).map((pr) => pr.url),
	];
	if (urls.some((url) => prLinksMatch(query, url))) return true;

	const target = githubPrIdentity(query);
	if (!target) return false;
	const refs = [
		{ repo: session.repo, number: session.prNumber },
		...(session.prs || []),
		...(session.linkedPrs || []),
	];
	return refs.some(
		(ref) =>
			ref.repo?.toLowerCase() === target.repo && ref.number === target.number,
	);
}

/**
 * A PR-backed workspace can contain the human implementation chat plus review
 * automations. A link search represents that workspace once, using the same
 * main-session choice as normal workspace navigation.
 */
export function collapsePrLinkSessions(
	sessions: UnifiedSession[],
): UnifiedSession[] {
	const byWorkspace = new Map<string, UnifiedSession[]>();
	for (const session of sessions) {
		if (!session.workspaceId) continue;
		const group = byWorkspace.get(session.workspaceId) || [];
		group.push(session);
		byWorkspace.set(session.workspaceId, group);
	}

	const emitted = new Set<string>();
	return sessions.flatMap((session) => {
		const workspaceId = session.workspaceId;
		if (!workspaceId) return [session];
		if (emitted.has(workspaceId)) return [];
		emitted.add(workspaceId);
		const oldestFirst = [...(byWorkspace.get(workspaceId) || [session])].sort(
			(a, b) => (a.createdAt || "").localeCompare(b.createdAt || ""),
		);
		return [mainSession(oldestFirst) || session];
	});
}

/** Bare attached branches are targets, not PRs; every explicit PR still counts. */
function pullRequests(session: UnifiedSession) {
	return (session.prs || []).filter(
		(ref) =>
			ref.source !== "attached" ||
			ref.number != null ||
			ref.url != null ||
			ref.state != null,
	);
}

/**
 * Pick the PR that owns the normal single-PR surface. A branch-derived PR is
 * always primary; when there is no such PR, a sole linked/discovered PR fills
 * that role instead of rendering as a one-item multi-PR stack.
 */
export function sessionPrPresentation(prs?: SessionPrRef[]): {
	primary?: SessionPrRef;
	additional: SessionPrRef[];
} {
	const actual = (prs || []).filter((ref) => ref.number != null);
	const primary = actual.find((ref) => ref.source === "primary");
	if (primary)
		return {
			primary,
			additional: actual.filter((ref) => ref !== primary),
		};
	if (actual.length === 1) return { primary: actual[0], additional: [] };
	return { additional: actual };
}

/**
 * Does this session have a PR at all? Counts the singular branch-derived fields
 * as well as the `prs` list, so a session whose PR sits on a branch it doesn't
 * own (a discovered one) counts too — those still have a diff to review.
 */
export function sessionHasPr(session: UnifiedSession): boolean {
	return (
		session.prNumber !== undefined ||
		!!session.prUrl ||
		pullRequests(session).length > 0
	);
}

/** A multi-PR session has landed once every actual PR is terminal and one merged. */
export function sessionPrMerged(session: UnifiedSession): boolean {
	const refs = pullRequests(session);
	if (refs.length > 0)
		return (
			refs.every((ref) => ref.state === "MERGED" || ref.state === "CLOSED") &&
			refs.some((ref) => ref.state === "MERGED")
		);
	return session.prState === "MERGED";
}

/** A multi-PR session is reviewed once no actual PR is still awaiting review. */
export function sessionPrApproved(session: UnifiedSession): boolean {
	const refs = pullRequests(session);
	if (refs.length > 0)
		return refs.every(
			(ref) =>
				ref.state === "MERGED" ||
				ref.state === "CLOSED" ||
				ref.reviewDecision === "APPROVED",
		);
	return session.prReviewDecision === "APPROVED";
}
