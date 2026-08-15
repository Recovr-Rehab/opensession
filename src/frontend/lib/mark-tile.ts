/**
 * The mark a thing is led by: the small tile at the head of a library entry, a
 * connection row, a setup card. It carries either a service's real logo or, for
 * the things that are ours, a glyph on a coloured plate.
 *
 * Two decisions live here rather than at the call sites.
 *
 * **The corner keys off the box.** A tile is rendered anywhere from 20px (a
 * chip in the new-session sheet) to 40px (a setup card), and one radius across
 * that range cannot be right twice: the step that is a soft corner at 40 is a
 * circle at 20. The scale in styles/tailwind.css multiplies every radius by
 * `--rf` (1.35 where the browser can draw squircles), so the numbers here are
 * larger than they look. `rounded-lg` is ~19px, which a 30px tile clamps to a
 * blob. Picking the step by size is also why this cannot be an inline
 * `border-radius`: base.css grants `corner-shape: squircle` to elements
 * carrying a `rounded-*` CLASS, so a computed radius would quietly opt the tile
 * out of the app's corner.
 *
 * **The house palette.** These are marks, not chrome, so they are raw values in
 * a table rather than semantic tokens, the same reason `BRANDS` in
 * brand-logos.ts holds GitHub's black and Slack's aubergine. A mark sits beside
 * real logos and has to hold its own there: the chrome tokens are picked to
 * read as INK on the page (light mode's `--blue` is #0969da, a dark navy), and
 * a 36px square filled with reading ink reads as a muted swatch next to
 * Stripe's violet. Each tone is a pair, lit from the top left, so the plate has
 * somewhere to go.
 */

/** Sizes are px, and the boundaries are where a step stops being a corner and
 *  starts being a circle. Proportions land at ~25% / ~31% / ~45% of the box. */
export function markTileClass(size: number): string {
	const radius =
		size <= 24 ? "rounded-sm" : size <= 32 ? "rounded-md" : "rounded-control";
	return `flex shrink-0 items-center justify-center overflow-hidden font-semibold ${radius}`;
}

/**
 * A tile's lift: a hairline contact shadow plus a wider glow in the tile's own
 * colour. The tinted half is what makes a mark read as lit rather than as a
 * sticker. A neutral drop shadow under a saturated plate greys the air around
 * it. Kept under 30% so a grid of marks does not haze.
 */
export function markTileShadow(color: string): string {
	return [
		"0 1px 2px rgba(0, 0, 0, 0.09)",
		`0 5px 14px -6px color-mix(in srgb, ${color} 65%, transparent)`,
	].join(", ");
}

/** Lit from the top left, so the pair runs along the same diagonal the sheen
 *  on every other plate in the app does. */
export function markTileGradient(tone: MarkTone): string {
	const [from, to] = MARK_TONES[tone];
	return `linear-gradient(155deg, ${from}, ${to})`;
}

export type MarkTone = keyof typeof MARK_TONES;

/**
 * Eight hues, because the thing they distinguish is a grid of otherwise
 * identical rows. Two tones would put the same plate on half the catalog and
 * give a person nothing to aim at. Each is [top-left, bottom-right]; the
 * second is the one to hand `markTileShadow`, since the glow belongs under the
 * darker end.
 */
export const MARK_TONES = {
	blue: ["#4c8dff", "#2563e8"],
	indigo: ["#7c6bff", "#4f3ddb"],
	teal: ["#2ed3c0", "#0e9c8e"],
	green: ["#42cf6a", "#12a150"],
	orange: ["#ffa53a", "#f2700d"],
	red: ["#ff6f5e", "#e8342a"],
	pink: ["#ff6fae", "#e0357f"],
	purple: ["#a95cf7", "#7c2fe0"],
} as const satisfies Record<string, readonly [string, string]>;
