import type { UnifiedSession } from "./types";

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
