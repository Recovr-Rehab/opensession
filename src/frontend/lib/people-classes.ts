/**
 * The People grid.
 *
 * A person is a tile, not a row. The page answers "who is around, and what are
 * they on", which is a glance across the team rather than a list read top to
 * bottom. A face, a name and a line of status also want to stack, and a row
 * spends its width fighting that.
 *
 * The tile is a fill, not a frame: panel surface with translucent hover ink
 * over it, and no hairline. A card that already sits a step above the page
 * does not need an edge drawn round it, and eight framed boxes read as a form
 * rather than as people.
 */

/** Three across at the page's full width. Two lines of the card are text that
 *  truncates, and a fourth column spends the width the status line needs to
 *  say anything more than the first two words of a session title. */
export const PEOPLE_GRID = "grid grid-cols-[repeat(auto-fill,minmax(244px,1fr))] gap-2";

/** One person, or the lens that clears the filter. Padding is the page's one
 *  inset (12px), which is also what the headers are indented by, so a heading
 *  lines up with the faces under it rather than with the card's edge. */
export const PEOPLE_CARD =
	"group focus-ring flex w-full min-w-0 cursor-pointer items-center gap-2.5 rounded-xl " +
	"bg-panel p-3 text-left transition-colors " +
	"duration-[var(--dur-micro)] ease-[var(--ease)] hover:bg-hover";

/** Whose work the app is showing. Without a hairline to firm up, the state is
 *  carried by the fill stepping past what a hovered neighbour can reach, plus
 *  the check at the end of the row. */
export const PEOPLE_CARD_SELECTED = "bg-pressed";

/** The page's own inset. Headings sit at the same x as the content inside a
 *  card, not at the card's edge, so a section reads as a label over its rows
 *  the way a grouped list does. Every list page in the app lines these two up;
 *  the row pages get there by outdenting the list instead. */
export const PEOPLE_INSET = "px-3";

/** "Organizations" — the one heading on the page. */
export const PEOPLE_SECTION_LABEL = `m-0 mt-7 mb-2 ${PEOPLE_INSET} text-label font-semibold text-fg`;

/**
 * An organization is a card of people rather than a target of its own: the
 * sidebar's lens holds one person, so a team has nothing to switch to. It
 * carries its members instead, and those are the buttons.
 */
export const PEOPLE_ORG_CARD = "rounded-2xl bg-panel p-3";

/** A member inside an organization card: the face, with the name under it. */
export const PEOPLE_ORG_MEMBER =
	"focus-ring flex w-[62px] cursor-pointer flex-col items-center gap-1.5 rounded-lg " +
	"border-0 bg-transparent p-1 text-center transition-colors " +
	"duration-[var(--dur-micro)] ease-[var(--ease)] hover:bg-hover";
