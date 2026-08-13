/**
 * The writing surface for an input that is not in its ordinary state: a flat
 * tint plus a 45° hatch that fades out downwards, so the box settles into its
 * toolbar instead of hatching all the way to the edge.
 *
 * One shape for every such state. The states differ only in ink, in strength,
 * and in what they are painted on. Ask mode is ambient, on for the session's
 * whole life, so it is painted lighter than the transient modes; note mode is
 * one message, so it is the loudest of them.
 *
 * Two callers, two shapes of the same recipe:
 *
 * · The session composer sits on an opaque control surface, so its flat tint
 *   mixes into that and is painted OVER the hatch — which is what makes the
 *   texture fade out downwards, and why `tintedSurface` returns one style bag.
 * · The new-session palette is glass over a dimmed page. Its tint has to mix
 *   into `transparent` or it would paint the blur out, and a translucent flat
 *   cannot cover anything, so the hatch has to be its own layer with its own
 *   mask. That caller composes from `tintedSurfaceParts` instead.
 *
 * Returned as inline style / raw strings rather than utilities because both
 * callers hand the values to a pseudo-element through custom properties, and
 * Tailwind cannot compile a colour it only sees at runtime.
 */

export interface TintedSurfaceParts {
	/** The flat tint: `background-color` of the surface. */
	flat: string;
	/** The 1px edge, a stronger mix of the same ink. */
	border: string;
	/** The 45° hatch alone, as a `background-image`. */
	hatch: string;
	/** The wash that buries the hatch towards the bottom. Only does anything
	 *  over an opaque `base` — see the note about the palette above. */
	fade: string;
}

export function tintedSurfaceParts(
	ink: string,
	tint: number,
	hatch: number,
	edge: number,
	base = "var(--control-surface)",
): TintedSurfaceParts {
	const flat = `color-mix(in srgb, ${ink} ${tint}%, ${base})`;
	const stripe = `color-mix(in srgb, ${ink} ${hatch}%, transparent)`;
	return {
		flat,
		border: `color-mix(in srgb, ${ink} ${edge}%, transparent)`,
		hatch: `repeating-linear-gradient(45deg, ${stripe} 0, ${stripe} 12px, transparent 12px, transparent 24px)`,
		fade: `linear-gradient(to bottom, transparent 15%, ${flat} 72%)`,
	};
}

export function tintedSurface(
	ink: string,
	tint: number,
	hatch: number,
	edge: number,
	base = "var(--control-surface)",
): React.CSSProperties {
	const parts = tintedSurfaceParts(ink, tint, hatch, edge, base);
	return {
		borderColor: parts.border,
		backgroundColor: parts.flat,
		backgroundImage: `${parts.fade}, ${parts.hatch}`,
	};
}
