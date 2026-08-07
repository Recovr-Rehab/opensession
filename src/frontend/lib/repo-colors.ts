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
	"#ad6b6d", // brick
	"#247967", // sage
	"#9f6d96", // rose
	"#58733d", // moss
	"#7d78b0", // plum
	"#7f6528", // ochre
	"#5186af", // denim
	"#925742", // rust
	"#349092", // teal
	"#8f536b", // clay
	"#568f68", // fern
	"#785b8d", // mauve
	"#858445", // olive
	"#51679a", // indigo
	"#a47548", // umber
	"#1f748b", // slate
];

/** Colors the server assigned, by repo id. */
const assigned = new Map<string, string>();
/** When each repo's icon last changed, so a new one isn't served from cache. */
const revisions = new Map<string, number>();

/** Record the assignment that came down with the repo list. */
export function rememberRepoColors(
	repos: Array<{ id: string; color?: string; iconRev?: number | null }>,
): void {
	for (const repo of repos) {
		if (repo.color) assigned.set(repo.id, repo.color);
		if (repo.iconRev) revisions.set(repo.id, repo.iconRev);
		else revisions.delete(repo.id);
	}
}

/**
 * The revision to hang off a tile's icon URL. Icons are cacheable, and one
 * fetched from Settings replaces art the browser may already hold — without
 * this the tile keeps painting the old picture until the cache lets go.
 */
export function repoIconRevision(id: string): number | null {
	return revisions.get(id) ?? null;
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
