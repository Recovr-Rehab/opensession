import type { UnifiedSession, Workspace } from "./types";

export function isScratchWorkspace(
	sessions: readonly Pick<UnifiedSession, "mode">[],
): boolean {
	return sessions.length > 0 && sessions.every((session) => session.mode === "scratch");
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
