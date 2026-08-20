import { setArchived } from "./archive";
import { clearSessionFileArchive } from "./plain-archive";
import { invalidateSessionsCache } from "./session-cache";
import type { UnifiedSession } from "./types";

type ArchivableSession = Pick<UnifiedSession, "id" | "aliasIds" | "archived">;

export interface HumanTurnUnarchiveDeps {
	setArchived: typeof setArchived;
	clearSessionFileArchive: typeof clearSessionFileArchive;
	invalidateSessionsCache: typeof invalidateSessionsCache;
}

const defaultDeps: HumanTurnUnarchiveDeps = {
	setArchived,
	clearSessionFileArchive,
	invalidateSessionsCache,
};

/** Restore an archived session immediately before accepting a person's turn. */
export function unarchiveForHumanTurn(
	session: ArchivableSession,
	deps: HumanTurnUnarchiveDeps = defaultDeps,
): boolean {
	if (!session.archived) return false;

	for (const id of new Set([session.id, ...(session.aliasIds || [])])) {
		deps.setArchived(id, false);
	}
	deps.clearSessionFileArchive(session.id);
	deps.invalidateSessionsCache();
	return true;
}
