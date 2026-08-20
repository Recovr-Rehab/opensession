import type { Workspace } from "./types";

/**
 * Turn the workspace composer's current text into the server patch it owns.
 * A blank composer is the absence of a draft, not a draft-shaped empty value.
 */
export function workspaceDraftPatch(
	text: string,
	updatedAt: string,
	by?: string,
	autoName?: boolean,
): { draft: Workspace["draft"] | null } {
	if (!text.trim()) return { draft: null };
	return {
		draft: {
			text,
			updatedAt,
			...(by !== undefined ? { by } : {}),
			...(autoName !== undefined ? { autoName } : {}),
		},
	};
}
