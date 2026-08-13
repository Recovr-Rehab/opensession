import type { UnifiedSession, Workspace } from "./types";

export function isScratchWorkspace(
	sessions: readonly Pick<UnifiedSession, "mode">[],
): boolean {
	return sessions.length > 0 && sessions.every((session) => session.mode === "scratch");
}

/**
 * The band repo-less Ask workspaces group into, pinned above the projects.
 *
 * A pseudo-band, not a repo: it is never written to the user's `repo-order`
 * pref, never drags, and is never a value of the repo filter. Keeping it out
 * of those keeps a namespace of real repo ids free of a sentinel that a repo
 * could one day be named.
 */
export const ASK_BAND = "__ask__";

/**
 * A workspace of nothing but repo-less Ask sessions — the "Ask" band that
 * sits above the project bands.
 *
 * Both halves are required. `mode` alone would sweep in every repo-scoped ask
 * session, which belongs in its repo's band; `repoLess` alone would sweep in
 * scratch. A workspace that mixes the two is not an Ask workspace and files
 * under its repo as usual.
 *
 * `repoLess`, never `!repo`: thousands of older ask sessions record no repo
 * and still sit in a real checkout, so `!repo` would empty every project band
 * into this one.
 */
export function isAskWorkspace(
	sessions: readonly Pick<UnifiedSession, "mode" | "repoLess">[],
): boolean {
	return (
		sessions.length > 0 &&
		sessions.every((session) => session.mode === "ask" && !!session.repoLess)
	);
}

export function spawnedSessionBelongsInSidebar(
	session: Pick<UnifiedSession, "spawnedBy">,
	needsAttention: boolean,
	claimed: boolean,
): boolean {
	return !session.spawnedBy || needsAttention || claimed;
}

/**
 * Which workspace row a selected session belongs to. Usually the row that
 * lists it, but a session the sidebar deliberately keeps out of the rows — an
 * automation run, an unclaimed spawned worker — still belongs to its
 * workspace, so opening one keeps that workspace selected instead of leaving
 * the sidebar with nothing lit up. Falls back to the shared worktree for the
 * runs that carry no workspace.
 */
export function workspaceRowOwnsSession(
	row: {
		key: string;
		workspace: Pick<Workspace, "id"> | null;
		sessions: readonly Pick<UnifiedSession, "id">[];
	},
	selected: Pick<UnifiedSession, "id" | "workspaceId" | "worktreeDir"> | null,
): boolean {
	if (!selected) return false;
	if (row.sessions.some((session) => session.id === selected.id)) return true;
	if (selected.workspaceId) return row.workspace?.id === selected.workspaceId;
	return !!selected.worktreeDir && row.key === `wt:${selected.worktreeDir}`;
}
