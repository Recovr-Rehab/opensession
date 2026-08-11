export function shouldOpenCreatedSession(
	draft: { originPath: string } | null,
	currentPath: string,
	creationSurfaceOpen: boolean,
): boolean {
	// Creation events without a tracked palette owner come from direct session
	// actions and retain their established navigate-on-success behavior.
	if (!draft) return true;
	return creationSurfaceOpen && draft.originPath === currentPath;
}
