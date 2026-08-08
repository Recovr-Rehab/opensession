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
