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
	// Creation events without a tracked palette owner come from direct session
	// actions and retain their established navigate-on-success behavior.
	if (!draft) return true;
	// "Create in background" asked for the current view to stay put.
	if (draft.background) return false;
	return creationSurfaceOpen && draft.originPath === currentPath;
}
