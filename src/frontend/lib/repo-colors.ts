/**
 * The color a repo's fallback letter tile wears.
 *
 * The server assigns one color per registered repo, across the whole set, so
 * that no two of them match — see src/server/repo-tile-colors.ts for why a
 * plain hash isn't enough (same-letter families like `tella-fusion` /
 * `tella-mac` / `tella-windows` are the normal case, and a colliding color
 * leaves their tiles identical). Those assignments arrive with the repo list
 * and are recorded here by `rememberRepoColors`.
 *
 * The palette and hash below are the fallback for an id the server never
 * listed — a local or unregistered checkout — and are mirrored from that
 * module. Keep all three copies (here, the server, OS1VisualStyle.swift) in
 * step or one surface will paint a repo a different color than the others.
 */

export const REPO_TILE_COLORS = [
	"#e8836b", // coral
	"#6ba5e8", // blue
	"#8ed99c", // green
	"#e8c46b", // amber
	"#c06be8", // purple
	"#6be8d2", // teal
	"#e86b9c", // pink
	"#a3b86b", // olive
	"#e8a56b", // orange
	"#6b7fe8", // indigo
	"#8ed96b", // lime
	"#6bd2e8", // cyan
	"#9c6be8", // violet
	"#6bd9a5", // spring
	"#e86bd2", // magenta
	"#c9d96b", // citron
];

/** Colors the server assigned, by repo id. */
const assigned = new Map<string, string>();

/** Record the assignment that came down with the repo list. */
export function rememberRepoColors(
	repos: Array<{ id: string; color?: string }>,
): void {
	for (const repo of repos) {
		if (repo.color) assigned.set(repo.id, repo.color);
	}
}

/** FNV-1a over the lowercased id — mirrored from the server module. */
function hashIndex(id: string): number {
	let hash = 0x811c9dc5;
	const key = id.toLowerCase();
	for (let i = 0; i < key.length; i++) {
		hash ^= key.charCodeAt(i);
		hash = Math.imul(hash, 0x01000193) >>> 0;
	}
	return hash % REPO_TILE_COLORS.length;
}

export function repoColor(id: string): string {
	return assigned.get(id) ?? REPO_TILE_COLORS[hashIndex(id)];
}
