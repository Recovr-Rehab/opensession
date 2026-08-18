/**
 * The workspace summary: the session's standing column of where the work
 * stands, and the Workspace panel's smaller sibling.
 *
 * It is a list of quiet rows, not a dashboard. One glyph, one label, and a
 * value or an action parked at the right edge. Everything is muted by default
 * and only the values that carry a verdict (a diff's +/−, a failing check)
 * take colour, so the column reads as one calm block and the one row that
 * needs attention is the only thing that jumps.
 *
 * Rows are full-width buttons rather than text with a link inside: the whole
 * row is the target, which is what makes a narrow column usable without
 * aiming.
 *
 * The grammar is the left sidebar's, deliberately. A 29px leading rail, a band
 * label over its own rows, and the same `rounded-row` pill under the pointer.
 * This is the sidebar's shape at the other edge of the window, so it should
 * not need learning twice.
 */

/**
 * The column. It sits where the Workspace panel sits and is the same kind of
 * thing, so it takes the panel's seam and surface. Not its width, its resize
 * handle or its `--bg-panel` remap: the panel earns those by holding stacked
 * sections, and this holds a short list.
 *
 * 272px is what the rows need and no more. The panel opens at 32% of the pane
 * (about 370px at 1440) and can be dragged wider, so keeping this well under
 * its minimum is what makes the pair read as two sizes of one column rather
 * than two columns.
 */
export const WS_SUMMARY_SHELL =
	"flex min-h-0 w-[272px] shrink-0 flex-col border-l border-divider bg-panel-surface " +
	// From 920px down the Workspace panel stops being a column and becomes an
	// overlay over the session. A standing column has nowhere to stand at that
	// width, so it steps out and leaves the panel toggle to carry the narrow
	// layouts.
	"max-[920px]:hidden";

/** The column's scrolling content. A session with many sources outgrows the
 *  window; everything above the sources is short and stays put in practice. */
export const WS_SUMMARY_BODY = "min-h-0 flex-1 overflow-y-auto py-2";

/** Band label ("Workspace", "Sources"), taken from the sidebar so the two
 *  columns head their lists the same way. It shares the rows' 16px content
 *  rail and their 31px pitch, so it does not sit tighter than the list it
 *  heads. */
export const WS_SUMMARY_SECTION =
	"flex h-[31px] items-center px-4 text-label font-semibold text-dim";

/**
 * A row. 31px tall, which is the proportion a dense list needs before it stops
 * reading as a cramped menu. Anything under about 28 and the glyph column and
 * the labels start to crowd.
 *
 * `group/ws` lets a trailing action fade in on hover without reserving its own
 * hover state.
 */
export const WS_SUMMARY_ROW =
	"group/ws mx-2 flex h-[31px] w-[calc(100%_-_16px)] min-w-0 cursor-pointer items-center gap-3.5 " +
	"rounded-row border-none bg-transparent px-2 text-left text-item-title text-fg " +
	"hover:bg-hover focus-ring";

/** The leading glyph column. Faint: the label is the content, the icon only
 *  says which kind of thing the row is. */
export const WS_SUMMARY_ICON = "shrink-0 text-faint";

/** The label. It truncates, because a PR title or a worktree path is routinely
 *  longer than the column. */
export const WS_SUMMARY_LABEL = "min-w-0 flex-1 truncate";

/** Right-edge action word ("Fix", "Pull", "Commit"). Reads as text until the
 *  row is hovered, then takes the accent, because the row itself is the
 *  button. */
export const WS_SUMMARY_ACTION =
	"shrink-0 text-meta font-medium text-dim group-hover/ws:text-accent";

/** Hairline between the workspace rows and the sources list. Inset to the
 *  rows' own gutter, so it divides the list rather than cutting the column. */
export const WS_SUMMARY_DIVIDER = "mx-4 my-2 h-px shrink-0 bg-line";

/** The PR row's trailing state word ("Draft", "Merged", "Changes requested").
 *  Tone comes from the caller; this is only the shape. */
export const WS_SUMMARY_STATE = "shrink-0 text-meta font-medium";

/** A source's thumbnail box: a 16px tile that holds an image preview or a file
 *  glyph, so the list has one left edge whatever the file is. */
export const WS_SUMMARY_THUMB =
	"size-4 shrink-0 overflow-hidden rounded-sm border border-line bg-panel object-cover";
