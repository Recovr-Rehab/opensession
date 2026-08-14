/**
 * The Feed page's scope row: the team and its organizations, as chips.
 *
 * They were cards in a grid when this page was called People and the roster
 * was the point. The feed is the point now, so the roster shrinks to what it
 * always was in practice — a row you pick from — and gets out of the way of
 * the thing you came to read.
 */

/** The row itself. It wraps rather than scrolling sideways: a hidden teammate
 *  is a teammate you never pick, and there are not enough of them to justify
 *  a scroll affordance. */
export const PEOPLE_CHIP_ROW = "mb-6 flex flex-wrap items-center gap-1.5";

/** One scope: everyone, a person, or an organization. */
export const PEOPLE_CHIP =
	"focus-ring inline-flex min-w-0 cursor-pointer items-center gap-2 rounded-[999px] " +
	"border-0 bg-panel py-1 pr-3 pl-1 text-control-label font-medium text-dim " +
	"transition-colors duration-[var(--dur-micro)] ease-[var(--ease)] " +
	"hover:bg-hover hover:text-fg";

/** The scope the feed is on. */
export const PEOPLE_CHIP_SELECTED = "bg-pressed text-fg";

/** The glyph slot in a chip that has no face of its own (Everyone). */
export const PEOPLE_CHIP_GLYPH =
	"flex size-[26px] shrink-0 items-center justify-center rounded-full bg-hover text-dim";

/** "Shipped" and any other heading on the page. */
export const PEOPLE_SECTION_LABEL = "m-0 mb-2 text-label font-semibold text-fg";
