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
 * Ten jewel-toned tile colors.
 *
 * Ten, not the sixteen this had, because the palette is also the picker: every
 * entry is a choice someone reads through, and sixteen near-neighbours asked
 * them to tell ochre from olive for no gain. Ten still covers the wheel and is
 * more colors than most instances have repos.
 *
 * Generated in OKLCH — ten hues at even 36° steps, chroma 0.18 (clipped to the
 * sRGB boundary where a hue can't hold it), lightness alternating 0.56/0.50 so
 * neighbouring hues separate on brightness as well as hue. Deep and saturated
 * rather than bright: the letter is white (REPO_TILE_INK), and these run
 * 4.4–6.7:1 against it. That is the whole constraint on this palette — lighten
 * it and the letter goes with it, so check the contrast before touching either.
 *
 * The hues sit 18° off where earlier versions put them, which is what makes
 * this a different set rather than a dimmer one: vermilion and true green
 * where there used to be a soft red and a leaf.
 *
 * The order is deliberately NOT the hue wheel: entries are laid out in strides
 * around it, so two repos whose colors collide — the assignment below takes
 * the next free slot — land on plainly different colors rather than
 * neighbouring hues.
 */
export const REPO_TILE_COLORS = [
	"#c73f15", // vermilion
	"#007914", // green
	"#0075d2", // azure
	"#ad215f", // raspberry
	"#7c7900", // olive
	"#006f83", // petrol
	"#a546af", // orchid
	"#885700", // bronze
	"#008877", // emerald
	"#6349c1", // violet
];

/**
 * The letter a tile carries, on every one of those colors — see the note
 * above about what that costs the palette. Mirrored in the web tile
 * (RepoTile.tsx) and the native one, like the colors.
 */
export const REPO_TILE_INK = "#ffffff";

/**
 * How far apart consecutive slots sit on the hue wheel, and the stride that
 * undoes it (3 × 7 ≡ 1 mod 10) so a slot can be mapped back to its wheel
 * position. Change one and the other has to follow.
 */
const HUE_STRIDE_INVERSE = 7;

/**
 * The two palettes this replaced, and where each of their slots lands now.
 *
 * A color someone PICKED is stored as a hex in the config, so a new palette
 * would otherwise leave exactly those repos — the ones somebody cared enough
 * about to choose for — wearing a color no swatch in the picker matches.
 * Both old palettes were sixteen entries on one hue layout (the second was the
 * first, brightened), so one table maps either: slot i of the old sixteen goes
 * to the closest hue among the ten in use. Old configs aren't rewritten; the
 * mapping happens on the way out.
 */
const LEGACY_PALETTES: Array<{ colors: string[]; toCurrent: number[] }> = [
	// The original muted earth tones, and the same sixteen hues brightened.
	// Sixteen slots onto ten: nearest hue.
	{
		colors: ["#ad6b6d", "#247967", "#9f6d96", "#58733d", "#7d78b0", "#7f6528",
			"#5186af", "#925742", "#349092", "#8f536b", "#568f68", "#785b8d",
			"#858445", "#51679a", "#a47548", "#1f748b"],
		toCurrent: [0, 8, 3, 1, 9, 4, 2, 7, 5, 3, 8, 6, 1, 9, 7, 2],
	},
	{
		colors: ["#d86069", "#008b74", "#c066b3", "#58880d", "#897ae1", "#967100",
			"#1394df", "#be5227", "#00a0a4", "#b84b7b", "#29a55e", "#935ab8",
			"#959100", "#4c72cf", "#c97500", "#0085a2"],
		toCurrent: [0, 8, 3, 1, 9, 4, 2, 7, 5, 3, 8, 6, 1, 9, 7, 2],
	},
	// The two ten-color palettes this replaced. Both were laid out slot for
	// slot the way this one is, so a choice keeps its position in the picker —
	// which is what someone picked, more than the exact hue.
	{
		colors: ["#d86069", "#628500", "#0098d0", "#b04e90", "#ab8700", "#00888c",
			"#a371d3", "#b65b00", "#00a671", "#566fcf"],
		toCurrent: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
	},
	{
		colors: ["#ff6f7a", "#79a300", "#00b2f4", "#df55b4", "#c89f00", "#00a7ab",
			"#c281ff", "#dd7000", "#00c285", "#6887ff"],
		toCurrent: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
	},
];

/** A stored color as it should be shown today. */
export function currentTileColor(color: string): string {
	const hex = color.toLowerCase();
	for (const { colors, toCurrent } of LEGACY_PALETTES) {
		const slot = colors.indexOf(hex);
		if (slot >= 0) return REPO_TILE_COLORS[toCurrent[slot]];
	}
	return color;
}

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
		// Through currentTileColor, so a choice made against the old palette
		// still holds its slot (and still shows as chosen in the picker).
		assigned[id] = currentTileColor(color);
		const slot = REPO_TILE_COLORS.indexOf(assigned[id]);
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
			// Distinct isn't enough between two `T`s: a color a step or two
			// from a sibling's still reads as "the other blue-green one". Keep
			// probing for one that doesn't.
			if (siblings.every((s) => tileHueDistance(candidate, s) >= 3)) {
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
 * How far apart two slots sit on the hue wheel, counted in palette steps
 * (36° each). Exported because the tests hold the palette to it.
 */
export function tileHueDistance(a: number, b: number): number {
	const size = REPO_TILE_COLORS.length;
	const wheel = (index: number) => (index * HUE_STRIDE_INVERSE) % size;
	const gap = Math.abs(wheel(a) - wheel(b));
	return Math.min(gap, size - gap);
}
