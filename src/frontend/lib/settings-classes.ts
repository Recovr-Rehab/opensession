/**
 * The Settings shell — what used to be the `settings-page` / `settings-back` /
 * `settings-content` / `settings-panel-frame` rules in legacy.css.
 *
 * Settings renders twice from one component file: a full-window page with a
 * side nav (desktop) and a bottom sheet with an iOS-style paged header
 * (phones, `MobileSettings`). The old sheet expressed the second as three
 * descendant overrides under `.settings-sheet`; here each surface names its
 * own finished string, because a descendant override is exactly the shape
 * that breaks when half a subtree migrates.
 *
 * `.settings-sheet` itself is NOT migrated and stays on the BottomSheet: it is
 * a hook, not styling — ui/settings.tsx reads it as `[.settings-sheet_&]:hidden`
 * to drop the page heading the sheet's own header already carries.
 *
 * One inherited quirk is preserved deliberately. A tool section (Automations,
 * Goals, Actions, Security) goes edge-to-edge on desktop, because those panels
 * bring their own padding and scrolling. Inside the sheet it does NOT: the old
 * `.settings-sheet .settings-content` was two class selectors and outranked
 * the single `.settings-content-tool`, so a tool section kept the sheet's 16px
 * gutter. That is almost certainly not what the override intended, but it is
 * what phones have been rendering, so SETTINGS_CONTENT_SHEET is the same
 * string either way rather than quietly re-cutting a layout this change is not
 * about.
 *
 * The desktop nav is not a cousin of the app's sidebar, it is the same design:
 * it takes that rail's surface, vertical scale, 22px glyph rail, hover layer
 * and selected wash from lib/sidebar-classes rather than re-deriving them
 * here. Anything below that reads as a settings-only number is a number the
 * two navs genuinely differ on, and says why.
 */

import type { CSSProperties } from "react";

import {
	SIDEBAR_DENSITY_VARS,
	SIDEBAR_GROUP,
	SIDEBAR_HOVER_LAYER,
	SIDEBAR_RAIL,
	SIDEBAR_RAIL_GAP,
} from "./sidebar-classes";

/**
 * The full-window page: side nav + content, filling the app body.
 *
 * It paints the SIDEBAR's surface rather than the page's, which is what
 * APP_BODY does and the first half of why the two navs read as one design. A
 * nav is a column of chrome; what separates it from the content is the seam
 * and the shadow on the content's left edge (see SETTINGS_CONTENT), so the
 * column itself needs no fill and no border of its own.
 *
 * It clips, because the content column enters from wherever the app's seam was
 * (`settingsSeamStyle`, `settings-paper-in`). Without the clip that overhang
 * gives the window a horizontal scrollbar for the length of the entrance, and
 * a scrollbar appearing and vanishing is louder than the motion it belongs to.
 * Nothing here needs to escape the page: both columns scroll themselves, and
 * the menus in the nav footer portal to the body.
 */
export const SETTINGS_PAGE = "flex min-h-0 flex-1 overflow-hidden bg-sidebar";

/**
 * The nav's width in px, mirroring `w-58` on SETTINGS_NAV below. It is written
 * out because the entrance measures against it and Tailwind only compiles
 * class names it can read in the source, so the utility cannot be built from
 * this constant. Change one, change the other.
 */
export const SETTINGS_NAV_WIDTH = 232;

/**
 * The one number the entrance needs: how far the seam between chrome and
 * content has to travel to become the settings seam.
 *
 * The app's rail is resizable and can be collapsed, so this is measured rather
 * than assumed. At the default 280px rail it is 48px, and the content column
 * starts 48px right of where it rests, which is exactly where its edge already
 * was a frame earlier. That is what makes the page arrive instead of appear:
 * the rail you clicked in narrows into the settings nav, and nothing on screen
 * jumps to a new position.
 *
 * Clamped, because past about 96px a settling seam starts reading as a panel
 * flying in, and the truthful distance then costs more than it buys. The rail
 * drags between 200px and 480px, so the clamp is idle across most of that
 * range and only engages at the two ends: a rail dragged past ~330px, and a
 * collapsed rail (0px), where the paper starts over the nav and retreats right
 * to uncover it.
 */
export function settingsSeamStyle(railWidth: number): CSSProperties {
	const seam = Math.round(railWidth - SETTINGS_NAV_WIDTH);
	return {
		"--settings-seam": `${Math.max(-96, Math.min(96, seam))}px`,
	} as CSSProperties;
}

/**
 * The nav column. No fill, no edge: the page under it is already the sidebar
 * surface, exactly as the app's own sidebar sits on APP_BODY's.
 *
 * It also sets the sidebar's vertical scale, so a settings row, its caption
 * and the app's rows run on one set of numbers instead of two copies that
 * drift. The compact overrides in that string key off a `data-density`
 * attribute this element deliberately does not carry: the preference is named
 * "Compact sidebar" and retunes the rail you work in, not a nav you visit.
 *
 * It deliberately has no entrance of its own when Settings opens (see
 * `settings-paper-in` in base.css). The column it replaces was the app's own
 * sidebar, on this same surface at this same edge, so it is the half of the
 * page that did not change, and it is what the content column arrives over.
 * Fading it in as well only empties the window for a frame. Its width is the
 * one number the entrance needs; see SETTINGS_NAV_WIDTH above.
 */
export const SETTINGS_NAV =
	`flex w-58 shrink-0 flex-col px-3 py-4 [html.wco_&]:pt-(--desktop-header-h) ${SIDEBAR_DENSITY_VARS}`;

/**
 * The scrolling section list, and one group inside it.
 *
 * The list is outdented past the nav's gutter so a row's pill sits 6px from
 * the column edge and its content lands on the app sidebar's 16px rail
 * (6 + the row's own 10px). That overflow is what gives the rail its
 * Conductor-style pill; see SIDEBAR_LIST, which is the same move from the
 * other direction. Its scrollbar is hidden for the reason the app's is: a
 * track down the middle of the window cuts the nav off from the content.
 */
export const SETTINGS_NAV_LIST =
	"-mx-1.5 flex min-h-0 flex-1 flex-col overflow-x-hidden overflow-y-auto pt-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden";

export const SETTINGS_NAV_GROUP = `flex flex-col ${SIDEBAR_GROUP}`;

/**
 * A group's caption: Personal, Workspace. The app's band headings in every
 * respect that shows: the caption height, 13px semibold, and dim ink rather
 * than faint. It was 11px bold with letterspacing, which is a different
 * typographic idea (a small-caps label) from the one the sidebar uses.
 */
export const SETTINGS_NAV_CAPTION =
	"flex h-[var(--sidebar-cap-h)] shrink-0 items-center px-2.5 text-label font-semibold text-dim";

/**
 * "Back to app" is the first row of the nav, and now a member of the row family
 * below rather than a smaller control above it: same box, same rail, so its
 * chevron and the section glyphs share a centre line.
 *
 * No `w-full`. It is outdented like the list, and a stretched flex child
 * already measures its container plus those two negative margins; `w-full`
 * would size it to the container alone and pull the pill back in on the right.
 */
export const SETTINGS_BACK =
	`group -mx-1.5 mb-2 flex cursor-pointer items-center ${SIDEBAR_RAIL_GAP} rounded-row border-none bg-transparent py-[var(--sidebar-row-pad)] pr-2 pl-2.5 text-left text-item-title font-medium text-dim hover:text-fg ${SIDEBAR_HOVER_LAYER}`;

/**
 * The scrolling content column beside the nav. `tool` sections fill it
 * edge-to-edge; pass the flag through `cn()` so tailwind-merge drops the
 * padding rather than leaving two padding utilities to fight by output order.
 *
 * The seam and the shadow are DETAIL_PANE's, the other half of the pair
 * SETTINGS_PAGE opens: the content is paper laid over the chrome, and the only
 * thing between them is that hairline plus, in light, a little depth. The
 * shadow rides `--content-edge-shadow`, which is `none` in dark.
 *
 * It is also the only thing that moves when Settings opens, starting at the
 * app seam's old position and gliding to this one (`settingsSeamStyle`,
 * `settings-paper-in`). It travels a short, anchored distance rather than
 * crossing the page, so it takes the default duration, not the spatial one,
 * and it animates alone: the nav is already there to receive it. Nothing
 * fades, so the page you asked for is legible in the first frame.
 */
export const SETTINGS_CONTENT =
	"flex min-w-0 flex-1 justify-center overflow-y-auto border-l border-divider bg-surface px-8 pt-11 desktop:[box-shadow:var(--content-edge-shadow)] animate-[settings-paper-in_var(--dur)_var(--ease)] motion-reduce:animate-none";
export const SETTINGS_CONTENT_TOOL = "min-h-0 p-0";

/** Same column inside the phone sheet — a phone gutter instead of the desktop one. */
export const SETTINGS_CONTENT_SHEET =
	"flex min-h-0 min-w-0 flex-1 justify-center overflow-y-auto px-4 pt-4";

/** The reading column a settings panel sits in, and its bottom air. */
export const SETTINGS_PANEL_FRAME = "w-full max-w-[720px] self-start pb-22";

/**
 * The column a settings panel that BROWSES sits in. The Library is a catalog
 * rather than a form: its cards go two up, and at the reading column's 720px
 * a card is narrow enough that the sentence saying what it does gets cut off
 * mid-word. The measure that matters here is the card's, not the paragraph's.
 */
export const SETTINGS_PANEL_FRAME_GALLERY = "w-full max-w-[980px] self-start pb-22";
export const SETTINGS_PANEL_FRAME_SHEET = "w-full max-w-[720px] self-start pb-12";

/**
 * The phone sheet's section list and the search bar floating over its bottom
 * edge, where iOS 26 puts a list's search.
 *
 * The bar is glass, in the same terms the phone app header uses (APP_HEADER):
 * a `before:` layer that blurs what passes behind it, tinted with a gradient
 * of the page colour and masked so the blur ends softly instead of on a line.
 * That only reads as glass if there IS something behind it, so the list scrolls
 * the full height of the page and reserves the bar's height as bottom padding —
 * the last row can still be scrolled clear of it.
 *
 * The `before:z-[-1]` needs the bar's own `z-1`: without a stacking context of
 * its own, a negative-z pseudo drops behind the list rather than sitting under
 * its parent's content.
 */
export const SETTINGS_SHEET_LIST = "h-full overflow-y-auto px-4 pb-[72px]";

export const SETTINGS_SHEET_SEARCH_BAR =
	"absolute inset-x-0 bottom-0 z-1 px-4 pb-2.5 pt-2 " +
	"before:pointer-events-none before:absolute before:inset-x-0 before:bottom-0 " +
	"before:top-auto before:z-[-1] before:h-[calc(100%+30px)] before:content-[''] " +
	// Translucent all the way down, not opaque at the base: glass that admits
	// nothing is just a panel. It only firms up (88%) at the very bottom edge,
	// where a row would otherwise read THROUGH the field rather than behind it.
	"before:[background:linear-gradient(to_top,color-mix(in_srgb,var(--bg)_88%,transparent)_0%,color-mix(in_srgb,var(--bg)_76%,transparent)_55%,color-mix(in_srgb,var(--bg)_45%,transparent)_78%,transparent_100%)] " +
	"before:backdrop-blur-[16px] before:backdrop-saturate-[1.35] " +
	"before:[-webkit-mask-image:linear-gradient(to_top,#000_0%,#000_62%,transparent_100%)] " +
	"before:[mask-image:linear-gradient(to_top,#000_0%,#000_62%,transparent_100%)]";

/**
 * A row in the settings navigation: the section list and the account block
 * under it, which are one list visually and were two copies of this string.
 *
 * This is SIDEBAR_ROW: the same 2px gap between rows, the same
 * `--sidebar-row-pad` box around a 22px rail, the same 7px to the title, the
 * same asymmetric 10/8 gutters.
 *
 * The two fills are the point of the exercise. Selected was `bg-active`
 * (#e0e0e0 in light), an opaque surface from the top of the elevation ramp,
 * which put a grey plate on the one row you are already reading. It takes
 * `--selected` now, the translucent ink the app marks an open session with,
 * and hover is the sidebar's LAYER rather than a colour, so pointing at the
 * selected row lifts it instead of swapping one wash for a lighter one. See
 * SIDEBAR_HOVER_LAYER, which explains why that has to be a layer.
 */
export const SETTINGS_NAV_ROW =
	`group mt-0.5 flex w-full cursor-pointer items-center ${SIDEBAR_RAIL_GAP} rounded-row border-none bg-transparent py-[var(--sidebar-row-pad)] pr-2 pl-2.5 text-left text-item-title font-medium text-dim hover:text-fg data-active:bg-selected data-active:text-fg ${SIDEBAR_HOVER_LAYER}`;

/**
 * The row's glyph well: the sidebar's 22px rail, not an 18px box. The glyphs
 * themselves are still 18px. The rail is what puts every settings label on
 * the same left edge as every sidebar title, and it centres a mark of any size
 * on that column.
 */
export const SETTINGS_NAV_ICON =
	`${SIDEBAR_RAIL} text-faint group-hover:text-fg group-data-active:text-fg`;
