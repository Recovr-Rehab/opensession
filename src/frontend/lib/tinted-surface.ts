/**
 * The writing surface for an input that is not in its ordinary state.
 *
 * It is a wash of the mode's ink and nothing else, the shape a team note
 * already takes in the transcript (components/NoteBubble.tsx). No hatch, no
 * coloured edge: a surface you read and write over all day cannot carry a
 * texture, which at that duty cycle lands as damage to the box rather than as
 * a state.
 *
 * Read "not in its ordinary state" strictly. A wash marks an ACT that differs
 * from the default: this one message is a note, this session is being created
 * read-only. It is not for a condition that holds for a surface's whole life,
 * and the session composer in ask mode was exactly that. Painting it anyway
 * spent the box's loudest signal on something that never changes, and left the
 * two washes one faint tint apart (7% green under note's 10% yellow, 8.6 dE in
 * light and less in dark) on the only surface where both can appear. Worse,
 * the transition that has to be unmistakable, ⌘N inside an ask session, was a
 * crossfade from green to yellow instead of from plain to yellow. Ask mode
 * names itself with a chip and a placeholder in the composer instead, so a
 * washed composer means a team note and nothing else.
 *
 * The base is the surface the wash actually covers, and it matters:
 *
 * · The composer and the Plain reply box pass `--composer-surface`, which is
 *   white in light mode. `--control-surface` is a grey there, so mixing into it
 *   sank the box a step darker than its resting state and the tint read as
 *   dirt rather than as colour.
 * · The new-session palette is glass over a dimmed page, so it mixes into
 *   `transparent` — an opaque tint would paint the blur out.
 * · A note bubble in the transcript is also `transparent`: it tints the page it
 *   sits on.
 *
 * Returned as a raw colour rather than a utility because every caller hands the
 * value to inline style or a custom property, and Tailwind cannot compile a
 * colour it only sees at runtime.
 */

function tint(ink: string, percent: number, base: string): string {
	return `color-mix(in srgb, ${ink} ${percent}%, ${base})`;
}

/** Read-only as a choice being made: the new-session palette, where ask is
 *  picked against a default with the mode control right beside it and the
 *  surface is on screen for seconds. Not the session composer, which lives in
 *  the mode rather than choosing it. */
export function askSurface(base: string): string {
	return tint("var(--green)", 7, base);
}

/** A message the agent never sees: the note bubble, the composer in note mode,
 *  a Plain internal note. `--yellow-tint`, not `--yellow` — the ink is a dark
 *  ochre in light mode and turns warm grey at these percentages (base.css). */
export function noteSurface(base: string): string {
	return tint("var(--yellow-tint)", 10, base);
}
