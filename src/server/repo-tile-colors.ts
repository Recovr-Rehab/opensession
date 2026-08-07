/**
 * The color a repo's fallback tile wears.
 *
 * A repo with no icon of its own shows a colored letter tile, so the color is
 * the only thing separating two repos whose names start with the same letter —
 * and same-letter families are the norm (`tella-fusion`/`tella-mac`/
 * `tella-windows`, `gitops`/`gstreamer`/`gst-plugins-rs`). A plain hash can't
 * promise anything there: over this palette it puts `tella-fusion` and
 * `tella-windows` on neighbouring hues and `opensession` and `os1-chrome` on
 * the identical swatch.
 *
 * So the color is assigned across the whole registered set instead of derived
 * per id: hash for a starting point, then take the next free entry. Every
 * registered repo gets a different color until the palette runs out, which is
 * what lets a tile identify a repo on its own (the phone's Inbox rows lean on
 * exactly that). The server owns the assignment so the web UI, the phone and
 * the Mac app can't disagree about what color a repo is.
 *
 * Clients keep `repoTileColor` as their fallback for ids the server never
 * listed — an unregistered or local repo — which is why the hash lives here
 * too and is mirrored verbatim in the web tile (RepoTile.tsx) and the native
 * one (OS1VisualStyle.swift).
 */

/**
 * Sixteen tile colors: the eight the product already used, plus one more in
 * each of the gaps between them. All sit at roughly the same saturation and
 * lightness, so no repo's tile reads louder than its neighbours, and white
 * bold letters sit on all of them at the same weight.
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

/**
 * FNV-1a over the lowercased id. Mirrored in both clients — change it here and
 * a repo's fallback color moves on every surface at once, so don't, unless you
 * change it in all three.
 */
export function repoTileColorIndex(id: string): number {
	let hash = 0x811c9dc5;
	const key = id.toLowerCase();
	for (let i = 0; i < key.length; i++) {
		hash ^= key.charCodeAt(i);
		hash = Math.imul(hash, 0x01000193) >>> 0;
	}
	return hash % REPO_TILE_COLORS.length;
}

/** The hashed color, for a repo that isn't in the registered set. */
export function repoTileColor(id: string): string {
	return REPO_TILE_COLORS[repoTileColorIndex(id)];
}

/**
 * One color per id, distinct while the palette holds out.
 *
 * Ids are walked in sorted order rather than config order so the assignment
 * depends on the set alone: two instances registering the same repos agree,
 * and reordering the config moves nothing. Adding a repo can still displace a
 * later one that wanted the same slot — the tiles are cosmetic, and the fix
 * for a repo whose color matters is to give it a real icon.
 */
export function assignRepoTileColors(ids: string[]): Record<string, string> {
	const assigned: Record<string, string> = {};
	const taken = new Set<number>();
	for (const id of [...ids].sort()) {
		const start = repoTileColorIndex(id);
		let index = start;
		for (let step = 0; step < REPO_TILE_COLORS.length; step++) {
			const candidate = (start + step) % REPO_TILE_COLORS.length;
			if (!taken.has(candidate)) {
				index = candidate;
				break;
			}
		}
		// Past sixteen repos the palette repeats: every entry is taken, so the
		// probe finds nothing and the hashed slot stands.
		taken.add(index);
		assigned[id] = REPO_TILE_COLORS[index];
	}
	return assigned;
}
