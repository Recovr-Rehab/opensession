import { getAccentThemeOption, type AccentTheme } from "./accent-theme";

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
 * **The palette is the accent palette.** The tones are not a colour set of
 * their own: each one names an entry in `ACCENT_THEME_OPTIONS` and reads its
 * value at render. That table is tuned as a family, every fill at one lightness
 * band and at 80% of the chroma its hue can physically reach, which is exactly
 * what a categorical palette needs and what a hand-picked set does not give
 * you: seven tiles in a grid then carry equal weight instead of one shouting.
 *
 * Reading it also means these follow when it is retuned. This file held copied
 * hex for about an hour, and the app's green and red moved underneath it in
 * that time.
 *
 * Every tone takes the accent's LIGHT value in both appearances. That is the
 * one picked to carry white text (measured 3.8:1 to 5.0:1 against white across
 * the seven), and a mark does not answer to the theme in any case: the plate
 * stays a saturated colour on both, exactly as `BRANDS` in brand-logos.ts holds
 * GitHub's black and Slack's aubergine. Re-toning per appearance would take the
 * dark side pale, where white ink needs it not to be.
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
 * plate in the app runs. The light is a sixth of white, mixed in oklab so it
 * raises lightness without dragging the hue toward grey: the tile has to read
 * as one colour with a light on it, and a wider ramp reads as two colours and
 * pulls the hue apart. The accent's own light/dark pair cannot supply this,
 * since the two sit a few percent apart by design.
 */
export function markTileGradient(tone: MarkTone): string {
	const deep = markTileInk(tone);
	return `linear-gradient(155deg, color-mix(in oklab, #ffffff 15%, ${deep}), ${deep})`;
}

/** The colour a tone is painted and lit by. It is also what `markTileShadow`
 *  wants: the glow belongs under the weight, not under the light. */
export function markTileInk(tone: MarkTone): string {
	return getAccentThemeOption(tone).light;
}

export type MarkTone = (typeof MARK_TONES)[number];

/**
 * Seven hues, because the thing they distinguish is a grid of otherwise
 * identical rows. Two tones would put the same plate on half the catalog and
 * give a person nothing to aim at.
 *
 * Every id here is an accent, so `satisfies` is the guard: retire one from the
 * palette and this stops compiling rather than falling back to a colour nobody
 * chose. Three accents are deliberately left out. `mono` is not a hue, `lime`
 * is a yellow that only exists above the lightness where white ink works, and
 * an id that is not in the palette yet cannot be named here.
 */
export const MARK_TONES = [
	"sky",
	"teal",
	"green",
	"orange",
	"coral",
	"pink",
	"purple",
] as const satisfies readonly AccentTheme[];
