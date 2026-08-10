/**
 * The Archived list's row optics.
 *
 * The page used to render a bordered `bg-panel` card per session, stacked with
 * gaps — thirteen grey slabs to a screen for a list that is 600 rows long, each
 * one carrying an always-on outlined "Unarchive" pill across ~500px of empty
 * gutter. That is a lot of chrome for a page whose whole job is "find the thing
 * I closed". So: one card, hairline rows, and the secondary action stays out of
 * sight until the row is under the cursor (or focused, or on a touch device,
 * where there is no hover to reveal it).
 */

/**
 * A row. `relative` positions two things: the open-button's full-bleed overlay
 * (see ROW_OPEN) and the action that has to sit above it.
 *
 * `focus-within:bg-hover` matters as much as the hover: with the whole row
 * clickable through an overlay, keyboard focus lands on a button whose visible
 * text is only the title — lighting the row is what says how far the target
 * reaches.
 */
export const ARCHIVED_ROW =
	"group relative flex items-center gap-3 px-3.5 py-2.5 transition-colors " +
	"duration-[var(--dur-micro)] ease-[var(--ease)] hover:bg-hover focus-within:bg-hover " +
	"phone:gap-2.5 phone:py-3 phone:pr-[54px]";

/**
 * The open action, stretched over the whole row by its own `::after` so a click
 * anywhere opens the session — including on the repo tile and the timestamp,
 * which are not themselves interactive. The ring stays on the title (the thing
 * a reader is aiming at); the row's `focus-within` wash carries the rest.
 */
export const ARCHIVED_ROW_OPEN =
	"focus-ring min-w-0 flex-1 cursor-pointer rounded-sm border-none bg-transparent p-0 " +
	"text-left after:absolute after:inset-0 after:content-['']";

export const ARCHIVED_ROW_TITLE =
	"block truncate text-label text-fg phone:text-[15px]";

/** The line under the title, and only when it has something to say — see the
 *  meta rules in the component: a field the current filter already fixes is
 *  the same word on every row. */
export const ARCHIVED_ROW_META =
	"mt-1 flex min-w-0 items-center gap-2.5 text-meta text-faint phone:text-[12px]";

/**
 * The timestamp column. Fixed width so the right edge lines up down the list
 * (a ragged column of "34m ago" / "2d ago" is the thing that reads as untidy),
 * and it steps aside for the action rather than reserving a second column of
 * air beside it. On phones the time joins the meta line instead, where the
 * action is always visible and there is no room for both.
 */
export const ARCHIVED_ROW_TIME =
	"w-[62px] shrink-0 text-right text-meta tabular-nums text-faint transition-opacity " +
	"duration-[var(--dur-micro)] ease-[var(--ease)] group-hover:opacity-0 " +
	"group-focus-within:opacity-0 phone:hidden";

/**
 * Unarchive: absolutely placed over the timestamp it replaces, so a row costs
 * no width for an action that is usually not wanted. Revealed by hover, by
 * focus, and unconditionally where hover can't reveal it — a control that only
 * exists on `:hover` does not exist on a phone.
 *
 * Both the width query and the pointer query, and deliberately: `phone:` is
 * the one a narrow window can be checked against (a hover-capable browser
 * never matches `hover: none`, so a rig that emulates a phone by size alone
 * would show the row reserving space for a button it never draws), and the
 * pointer query is what catches a touch device that isn't phone-width.
 *
 * The label collapses to its glyph on phones — spelled out it costs a quarter
 * of a 390px row, and the row is mostly title.
 */
export const ARCHIVED_ROW_ACTION =
	"absolute right-3 top-1/2 z-[1] -translate-y-1/2 opacity-0 transition-opacity " +
	"duration-[var(--dur-micro)] ease-[var(--ease)] group-hover:opacity-100 " +
	"focus-visible:opacity-100 phone:min-h-11 phone:w-11 phone:gap-0 phone:px-0 phone:opacity-100 " +
	"[@media(hover:none)]:opacity-100";
