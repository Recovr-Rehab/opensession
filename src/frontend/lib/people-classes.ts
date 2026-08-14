/**
 * The People grid.
 *
 * A person is a tile, not a row. The page answers "who is around, and what are
 * they on", which is a glance across the team rather than a list read top to
 * bottom. A face, a name and a line of status also want to stack, and a row
 * spends its width fighting that.
 *
 * The tile takes the sidebar's phone tool card as its box (hairline, panel
 * fill, translucent hover ink over the fill), so a person you can click here
 * reads as the same kind of target a tool does.
 */

/** Three across at the page's full width. Two lines of the card are text that
 *  truncates, and a fourth column spends the width the status line needs to
 *  say anything more than the first two words of a session title. */
export const PEOPLE_GRID = "grid grid-cols-[repeat(auto-fill,minmax(244px,1fr))] gap-2";

/** One person, or the lens that clears the filter. */
export const PEOPLE_CARD =
	"group focus-ring flex w-full min-w-0 cursor-pointer items-center gap-2.5 rounded-lg " +
	"border border-line bg-panel p-2.5 text-left transition-colors " +
	"duration-[var(--dur-micro)] ease-[var(--ease)] hover:bg-hover";

/** Whose work the app is showing. The border firms up as well as the fill:
 *  on a panel the hover ink alone is a small step, and this state has to
 *  survive being read past a hovered neighbour. */
export const PEOPLE_CARD_SELECTED = "border-line-strong bg-pressed";

/** "Organizations" — the one heading on the page. */
export const PEOPLE_SECTION_LABEL = "m-0 mt-7 mb-2 text-label font-semibold text-fg";

/**
 * An organization is a card of people rather than a target of its own: the
 * sidebar's lens holds one person, so a team has nothing to switch to. It
 * carries its members instead, and those are the buttons.
 */
export const PEOPLE_ORG_CARD = "rounded-lg border border-line bg-panel p-3";

/** A member inside an organization card: the face, with the name under it. */
export const PEOPLE_ORG_MEMBER =
	"focus-ring flex w-[62px] cursor-pointer flex-col items-center gap-1.5 rounded-control " +
	"border-0 bg-transparent p-1 text-center transition-colors " +
	"duration-[var(--dur-micro)] ease-[var(--ease)] hover:bg-hover";
