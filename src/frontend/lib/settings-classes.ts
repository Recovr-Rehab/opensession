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
 */

/** The full-window page: side nav + content, filling the app body. */
export const SETTINGS_PAGE = "flex min-h-0 flex-1 bg-surface";

/** "Back to app" — a full-width quiet row at the top of the side nav. */
export const SETTINGS_BACK =
	"mb-3 flex w-full cursor-pointer items-center gap-2 rounded-[calc(8px*var(--rf))] border-none bg-transparent px-2.5 py-1.5 text-left text-control-label font-medium text-dim hover:bg-hover hover:text-fg";

/**
 * The scrolling content column beside the nav. `tool` sections fill it
 * edge-to-edge; pass the flag through `cn()` so tailwind-merge drops the
 * padding rather than leaving two padding utilities to fight by output order.
 */
export const SETTINGS_CONTENT = "flex min-w-0 flex-1 justify-center overflow-y-auto px-8 pt-11";
export const SETTINGS_CONTENT_TOOL = "min-h-0 p-0";

/** Same column inside the phone sheet — a phone gutter instead of the desktop one. */
export const SETTINGS_CONTENT_SHEET =
	"flex min-h-0 min-w-0 flex-1 justify-center overflow-y-auto px-4 pt-4";

/** The reading column a settings panel sits in, and its bottom air. */
export const SETTINGS_PANEL_FRAME = "w-full max-w-[720px] self-start pb-22";
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
 * A row in the settings navigation — the desktop sidebar's list and the
 * account block under it, which are one list visually and were two copies of
 * this string.
 *
 * The gap is `gap-2` rather than the 11px it carried: measured on the rendered
 * pixels, an 18px glyph leaves ~2.5px of whitespace inside its own box, so 11
 * put 13.5 to 16px of air between icon and label while every button in the app
 * sits near 9.5. A nav row can read a little looser than a control, but not
 * half again as loose.
 */
export const SETTINGS_NAV_ROW =
	"group flex w-full cursor-pointer items-center gap-2 rounded-row border-none bg-transparent px-2.5 py-2 text-left text-body font-medium text-dim hover:bg-hover hover:text-fg data-active:bg-active data-active:text-fg";

/** The row's glyph well: fixed 18px so labels align whatever the icon draws. */
export const SETTINGS_NAV_ICON =
	"inline-flex size-[18px] flex-none items-center justify-center text-faint group-hover:text-fg group-data-active:text-fg";
