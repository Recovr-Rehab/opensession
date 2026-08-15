/**
 * The pull request list's geometry.
 *
 * Deliberately the archived list's idiom (lib/archived-classes.ts): one
 * page-wide list rather than a bordered card, inset hairlines carrying the
 * structure, and a rounded hover wash that the separators clear out of the way
 * for. This page lists the same kind of thing those pages do — a session's
 * work, one row at a time — so it should not invent a second row look.
 */

/** Labels and row contents share the page's content edge; the list itself runs
 *  12px past it so a hovered row's wash has room to breathe. */
export const PR_LIST = "-mx-3";

/** The state a block of rows is in: Open, Merged, Closed. */
export const PR_SECTION_LABEL =
	"m-0 mb-1.5 flex items-baseline gap-2 px-3 text-label font-semibold text-fg";

/** A date group inside a state — the same quiet label the archived list gives
 *  its own date groups. The `px-3` pays back the list's outdent, so the label
 *  starts on the same x as the row content under it. */
const GROUP_LABEL =
	"m-0 flex items-baseline gap-2 px-3 pb-1.5 font-semibold text-faint";

export const PR_GROUP_LABEL = `${GROUP_LABEL} text-meta`;

/** The same label in the feed, one step up the scale. The feed is grouped by
 *  day and nothing else, so the day is the heading a reader navigates by; on
 *  the pull request list a date sits under Open or Merged, which is the heading
 *  there, and stays the quieter of the two. */
export const PR_FEED_GROUP_LABEL = `${GROUP_LABEL} text-label`;

/**
 * A pull request row.
 *
 * `relative` is for the separator: the row's own `::after`, inset past the
 * state glyph and the tile so it starts at the title, and gone on the last row.
 * It also clears out around the highlight — the hovered row hides its own and
 * `:has(+ button:hover)` hides the one above it — so a lit row reads as a clean
 * slab instead of a strip with a line cutting its corner.
 */
/**
 * The same row, in the People page's shipped feed.
 *
 * One column narrower: everything in the feed has merged, so the state glyph
 * would be the same mark on every line. The face takes its place, because who
 * shipped it is the one thing the feed is sorted around.
 */
export const PR_FEED_ROW =
	"group focus-ring relative grid w-full grid-cols-[24px_minmax(0,1fr)_130px_44px] " +
	"cursor-pointer items-center gap-2 rounded-control border-0 bg-transparent px-3 py-2.5 " +
	"text-left transition-colors duration-[var(--dur-micro)] ease-[var(--ease)] hover:bg-hover " +
	"after:pointer-events-none after:absolute after:right-3 after:bottom-0 after:left-[50px] " +
	"after:h-px after:bg-line after:transition-opacity after:duration-[var(--dur-micro)] " +
	"last:after:opacity-0 hover:after:opacity-0 " +
	"[&:has(+button:hover)]:after:opacity-0 " +
	"phone:grid-cols-[24px_minmax(0,1fr)_44px]";

export const PR_ROW =
	"group focus-ring relative grid w-full grid-cols-[22px_24px_minmax(0,1fr)_130px_44px] " +
	"cursor-pointer items-center gap-2 rounded-control border-0 bg-transparent px-3 py-2.5 " +
	"text-left transition-colors duration-[var(--dur-micro)] ease-[var(--ease)] hover:bg-hover " +
	"after:pointer-events-none after:absolute after:right-3 after:bottom-0 after:left-[74px] " +
	"after:h-px after:bg-line after:transition-opacity after:duration-[var(--dur-micro)] " +
	"last:after:opacity-0 hover:after:opacity-0 " +
	"[&:has(+button:hover)]:after:opacity-0 " +
	"phone:grid-cols-[22px_24px_minmax(0,1fr)_44px]";
