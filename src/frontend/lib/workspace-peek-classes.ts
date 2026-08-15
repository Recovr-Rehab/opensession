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

/**
 * The popup body. Fixed width — the rows truncate rather than reflow, so a
 * long branch name can't make the card wider than the header it hangs from.
 *
 * The radius is the card's own, one step rounder than the chrome corner the
 * popover primitive defaults to: at this size `rounded-control` reads tight,
 * and the corner is the main thing carrying "this is a card floating above the
 * page" now that the shadow has been softened.
 */
export const PEEK_CARD =
	"flex w-[300px] flex-col rounded-[calc(16px*var(--rf))] py-2 smooth-shadow-ring-soft";

/** Section label ("Workspace", "Sources"). Shares the rows' 16px gutter so the
 *  whole card reads on one left edge, and their 31px pitch so it doesn't sit
 *  tighter than the list it heads. */
export const PEEK_SECTION =
	"flex h-[31px] items-center gap-2 px-4 text-meta font-medium text-faint";

/**
 * A row. 31px tall on a 300px card — the proportion a dense list needs before
 * it stops reading as a cramped menu; anything under ~28 and the glyph column
 * and the labels start to crowd.
 *
 * `group/peek` lets a trailing action fade in on hover without reserving its
 * own hover state.
 */
export const PEEK_ROW =
	"group/peek mx-2 flex h-[31px] w-[calc(100%_-_16px)] min-w-0 cursor-pointer items-center gap-3.5 " +
	"rounded-md border-none bg-transparent px-2 text-left text-item-title text-fg " +
	"hover:bg-hover focus-ring";

/** The leading glyph column. Faint: the label is the content, the icon only
 *  says which kind of thing the row is. */
export const PEEK_ICON = "shrink-0 text-faint";

/** The label. Truncates — a PR title or a worktree path is routinely longer
 *  than the card. */
export const PEEK_LABEL = "min-w-0 flex-1 truncate";

/** Right-edge action word ("Fix", "Pull", "Merge"). Reads as text until the
 *  row is hovered, then takes the accent — the row itself is the button. */
export const PEEK_ACTION =
	"shrink-0 text-meta font-medium text-dim group-hover/peek:text-accent";

/** Hairline between the workspace rows and the sources list. Inset to the
 *  rows' own gutter, so it divides the list rather than cutting the card. */
export const PEEK_DIVIDER = "mx-4 my-2 h-px shrink-0 bg-line";

/** The PR row's trailing state word ("Draft", "Merged", "Changes requested").
 *  Tone comes from the caller — this is only the shape. */
export const PEEK_STATE = "shrink-0 text-meta font-medium";

/** A source's thumbnail box: a 16px tile that holds an image preview or a
 *  file glyph, so the list has one left edge whatever the file is. */
export const PEEK_THUMB =
	"size-4 shrink-0 overflow-hidden rounded-sm border border-line bg-panel object-cover";
