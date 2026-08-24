export function shouldOpenCreatedSession(
	draft: { originPath: string; background?: boolean } | null,
	currentPath: string,
	creationSurfaceOpen: boolean,
	roomScoped = false,
): boolean {
	// A restart-recovered create is announced to the session room so an already
	// open optimistic viewer can settle. It is not a creator reply and must never
	// pull another route back to that session through a stale watch.
	if (roomScoped) return false;
	// Only this browser's still-pending create may take the foreground. A
	// duplicate creator reply can be replayed from the durable command outbox on
	// reconnect, long after its draft was consumed; treating "no draft" as a
	// direct create made every reload jump back to that old session.
	if (!draft) return false;
	// "Create in background" asked for the current view to stay put.
	if (draft.background) return false;
	return creationSurfaceOpen && draft.originPath === currentPath;
}
