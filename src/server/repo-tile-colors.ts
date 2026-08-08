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
 * Sixteen tile colors: saturated mid-tones, bright enough to read as color at
 * 18px without becoming the pastels this started as (those sat near 2:1
 * against white and lost their letter).
 *
 * Generated in OKLCH — sixteen hues at even 22.5° steps, chroma 0.15 (clipped
 * to the sRGB boundary where a hue can't hold it), lightness alternating
 * 0.64/0.57 so neighbouring hues separate on brightness as well as hue. That
 * lands every entry at 3.2–4.9:1 against white, which is what keeps the white
 * letter legible on all of them; raising either number further starts eating
 * into that, so don't without checking the contrast.
 *
 * The order is deliberately NOT the hue wheel: entries are laid out in steps of
 * seven around it, so two repos whose colors collide — the assignment below
 * takes the next free slot — land on plainly different colors rather than
 * neighbouring hues (ΔE 0.185 between adjacent slots, against 0.065 in wheel
 * order).
 */
export const REPO_TILE_COLORS = [
	"#d86069", // coral
	"#008b74", // emerald
	"#c066b3", // orchid
	"#58880d", // moss
	"#897ae1", // iris
	"#967100", // ochre
	"#1394df", // azure
	"#be5227", // rust
	"#00a0a4", // teal
	"#b84b7b", // raspberry
	"#29a55e", // jade
	"#935ab8", // violet
	"#959100", // olive
	"#4c72cf", // indigo
	"#c97500", // amber
	"#0085a2", // cerulean
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
export function assignRepoTileColors(
	ids: string[],
	chosen: Record<string, string> = {},
): Record<string, string> {
	const assigned: Record<string, string> = {};
	const taken = new Set<number>();
	// A repo whose color someone picked keeps it, and holds that slot against
	// the automatic ones — otherwise choosing a color could hand the same one
	// to a repo that hadn't asked for anything.
	for (const [id, color] of Object.entries(chosen)) {
		if (!ids.includes(id)) continue;
		assigned[id] = color;
		const slot = REPO_TILE_COLORS.indexOf(color);
		if (slot >= 0) taken.add(slot);
	}
	// Slots already spoken for by repos starting with the same letter. Those
	// are the tiles a person has to tell apart on color alone.
	const byLetter = new Map<string, number[]>();
	for (const id of [...ids].sort()) {
		const letter = tileLetter(id);
		const siblings = byLetter.get(letter) ?? [];
		// A chosen color is final. It still counts as a sibling, so the repos
		// sharing its letter are steered away from it.
		if (assigned[id]) {
			const slot = REPO_TILE_COLORS.indexOf(assigned[id]);
			if (slot >= 0) byLetter.set(letter, [...siblings, slot]);
			continue;
		}
		const start = repoTileColorIndex(id);
		let index = start;
		let fallback: number | null = null;
		for (let step = 0; step < REPO_TILE_COLORS.length; step++) {
			const candidate = (start + step) % REPO_TILE_COLORS.length;
			if (taken.has(candidate)) continue;
			if (fallback === null) fallback = candidate;
			// Distinct isn't enough between two `T`s: a color three hue steps
			// from a sibling's still reads as "the other blue-green one". Keep
			// probing for one that doesn't.
			if (siblings.every((s) => hueSteps(candidate, s) >= 3)) {
				index = candidate;
				fallback = null;
				break;
			}
		}
		// Nothing far enough — or, past sixteen repos, nothing free at all.
		// Take whatever's left rather than handing two repos one color.
		if (fallback !== null) index = fallback;
		taken.add(index);
		byLetter.set(letter, [...siblings, index]);
		assigned[id] = REPO_TILE_COLORS[index];
	}
	return assigned;
}

/** The glyph the tile shows — the same rule the clients apply. */
function tileLetter(id: string): string {
	if (id === "opensession" || id === "backstage") return "O";
	return (id[0] || "?").toUpperCase();
}

/**
 * How far apart two slots sit on the hue wheel, in 22.5° steps.
 *
 * The palette is laid out in strides of seven around the wheel, and seven is
 * its own inverse modulo sixteen — so the same stride maps a slot back to its
 * wheel position.
 */
function hueSteps(a: number, b: number): number {
	const size = REPO_TILE_COLORS.length;
	const wheel = (index: number) => (index * 7) % size;
	const gap = Math.abs(wheel(a) - wheel(b));
	return Math.min(gap, size - gap);
}
