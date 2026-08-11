/**
 * The workspace peek card — the session header's compact, floating stand-in
 * for the right Workspace panel.
 *
 * It is a list of quiet rows, not a dashboard: one glyph, one label, and a
 * value or an action parked at the right edge. Everything is muted by default
 * and only the values that carry a verdict (a diff's +/−, a failing check)
 * take colour, so the card reads as one calm block and the one row that needs
 * attention is the only thing that jumps.
 *
 * Rows are full-width buttons rather than text with a link inside: the whole
 * row is the target, which is what makes a 300px card usable without aiming.
 */

/** The popup body. Fixed width — the rows truncate rather than reflow, so a
 *  long branch name can't make the card wider than the header it hangs from. */
export const PEEK_CARD = "flex w-[300px] flex-col py-1.5";

/** Section label ("Workspace", "Sources"). Sits in the same 12px gutter as the
 *  rows' glyphs so the whole card reads on one left edge. */
export const PEEK_SECTION =
	"flex items-center gap-2 px-3 pt-1.5 pb-1 text-meta font-medium text-faint";

/** A row. `group/peek` lets a trailing action fade in on hover without
 *  reserving its own hover state. */
export const PEEK_ROW =
	"group/peek flex w-full min-w-0 cursor-pointer items-center gap-2.5 rounded-md " +
	"border-none bg-transparent px-3 py-[5px] text-left text-label text-fg " +
	"hover:bg-hover focus-ring";

/** Same geometry, for a row that is only ever read (no target). */
export const PEEK_ROW_STATIC =
	"flex w-full min-w-0 items-center gap-2.5 px-3 py-[5px] text-left text-label text-fg";

/** The leading glyph column. Faint: the label is the content, the icon only
 *  says which kind of thing the row is. */
export const PEEK_ICON = "shrink-0 text-faint";

/** The label. Truncates — a PR title or a worktree path is routinely longer
 *  than the card. */
export const PEEK_LABEL = "min-w-0 flex-1 truncate";

/** Right-edge value (a count, a branch's ahead/behind, a size). Tabular so a
 *  column of numbers doesn't wobble as they tick. */
export const PEEK_VALUE = "shrink-0 text-meta text-dim tabular-nums";

/** Right-edge action word ("Fix", "Pull", "Merge"). Reads as text until the
 *  row is hovered, then takes the accent — the row itself is the button. */
export const PEEK_ACTION =
	"shrink-0 text-meta font-medium text-dim group-hover/peek:text-accent";

/** Hairline between the workspace rows and the sources list. */
export const PEEK_DIVIDER = "my-1.5 h-px shrink-0 bg-line";

/** A source's thumbnail box: a 16px tile that holds an image preview or a
 *  file glyph, so the list has one left edge whatever the file is. */
export const PEEK_THUMB =
	"size-4 shrink-0 overflow-hidden rounded-sm border border-line bg-panel object-cover";

/** Placeholder line while the first fetch is in flight. Holding the card's
 *  height stops it from snapping taller a beat after it opens. */
export const PEEK_SKELETON =
	"mx-3 my-[7px] h-3 animate-pulse rounded-sm bg-[var(--hover)]";
