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
 * **The house palette.** Eight hues, and every one of them is a hue the app
 * already owns: each entry names the two values base.css gives that colour, its
 * light-theme ink and its dark-theme ink. A tile is painted with the DEEP one,
 * which is the value picked to carry white text, and lifted toward the lighter
 * one across the diagonal. So the gradient never leaves the hue, and the set as
 * a whole is the same palette the transcript's tool icons and the app's status
 * colours are drawn from rather than a second, brighter one sitting beside it.
 *
 * They are raw values in a table rather than `var(--blue)` because a mark does
 * not answer to the theme: the plate is a saturated colour on both, exactly as
 * `BRANDS` in brand-logos.ts holds GitHub's black and Slack's aubergine, and a
 * tile that re-toned per theme would go pale on the dark canvas where white
 * ink needs it not to.
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
		"0 1px 2px rgba(0, 0, 0, 0.08)",
		`0 5px 14px -6px color-mix(in srgb, ${color} 50%, transparent)`,
	].join(", ");
}

/**
 * Lit from the top left, along the same diagonal the sheen on every other
 * plate in the app runs. A third of the lighter ink, no more: the tile has to
 * read as one colour with a light on it, and a full ramp between the two
 * values would read as two colours and pull the hue apart.
 */
export function markTileGradient(tone: MarkTone): string {
	const [deep, lift] = MARK_TONES[tone];
	return `linear-gradient(155deg, color-mix(in srgb, ${lift} 32%, ${deep}), ${deep})`;
}

/** The colour a tone is painted and lit by. Pass the deep one to
 *  `markTileShadow`: the glow belongs under the weight, not under the light. */
export function markTileInk(tone: MarkTone): string {
	return MARK_TONES[tone][0];
}

export type MarkTone = keyof typeof MARK_TONES;

/**
 * Eight hues, because the thing they distinguish is a grid of otherwise
 * identical rows. Two tones would put the same plate on half the catalog and
 * give a person nothing to aim at, and eight is what the app's own palette
 * offers before it starts repeating itself.
 *
 * Each is [deep, lift], and both are base.css values for that hue: the deep one
 * is its light-theme ink (the value chosen to carry white text), the lift its
 * dark-theme ink. Named beside each is the token they belong to, so a palette
 * change there has a visible list of what follows.
 */
export const MARK_TONES = {
	blue: ["#0969da", "#58a6ff"], // --blue, --tool-file
	teal: ["#1b7c83", "#39c5cf"], // --tool-web
	green: ["#1a7f37", "#3fb950"], // --green, --tool-run
	amber: ["#9a6700", "#e3b341"], // --yellow, --tool-edit
	orange: ["#bc4c00", "#f0883e"], // --tool-find
	red: ["#cf222e", "#f85149"], // --red
	pink: ["#bf3989", "#f778ba"], // --tool-agent
	purple: ["#8250df", "#a371f7"], // --purple, --tool-mcp
} as const satisfies Record<string, readonly [string, string]>;
