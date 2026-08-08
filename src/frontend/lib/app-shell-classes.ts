/**
 * The application shell, as finished utility classes — what used to be
 * `.app-body`, `.workspace-shell`, `.detail-pane` and `.detail-topbar` in
 * legacy.css.
 *
 * These four are one object, not four components, and they had to move
 * together: every interesting rule in the family was keyed off an ancestor
 * (`.app-body.sidebar-collapsed .workspace-shell`,
 * `.app:not(:has(.app-header-overlay)) .detail-pane`,
 * `.detail-topbar:has(+ .session-tabs) .detail-topbar-title`), and a compound
 * legacy selector outranks a single utility — so migrating any one of them
 * alone would have left the others quietly winning their old values.
 *
 * The shell also has two complete layouts rather than one with tweaks. On
 * desktop it is an inset rounded card: the sidebar is a column beside it and
 * only a narrow strip of the raised app surface shows around the workspace. On
 * phones the whole card DISSOLVES — `.workspace-shell` was `display: contents`
 * — and the pane becomes an iOS-style page stack, absolutely positioned and
 * slid in from the right over the sidebar. The desktop form is unprefixed and
 * the phone form overrides it, because Tailwind emits every breakpoint variant
 * after every unprefixed utility.
 *
 * Three class names stay on the markup as bare hooks with no styling of their
 * own, because things outside this file name them:
 *
 *   · `app-body` + `sidebar-collapsed` — base.css hides the WCO nav pane with
 *     `.app-body.sidebar-collapsed .detail-pane .wco-nav-pane`, and
 *     lib/session-viewer-classes.ts insets the session header from the
 *     floating re-open control with `[.app-body.sidebar-collapsed_&]`;
 *   · `detail-pane` — the same base.css rule, and lib/session-tab-classes.ts
 *     reads `--strip-clearance` off `.detail-pane:has(.session-tab-reorder ~
 *     .session-tab-reorder)`;
 *   · `detail-topbar` / `detail-topbar-title` — base.css makes the row a
 *     native titlebar drag region in the desktop shell (`html.wco
 *     .detail-topbar-title`), which is a rule about an element in a platform
 *     state and cannot be a utility.
 *
 * `workspace-shell`, `right-panel-slot`, `turn-spacer` and `reviews` named
 * nothing outside their own rules, so those names are gone from the markup
 * entirely.
 */

/**
 * The row under the top bar: sidebar + workspace. Desktop paints the shared
 * chrome material here, so the sidebar and the gutter around the workspace are
 * one continuous surface and an opaque sticky header scrolls over the same
 * colour instead of revealing a seam. Phones get the page stack's positioning
 * context instead, and the plain page colour.
 */
export const APP_BODY =
	"app-body flex min-h-0 flex-1 bg-raised " +
	"desktop:[background:linear-gradient(var(--sidebar-material),var(--sidebar-material)),var(--bg-raised)] " +
	"phone:relative phone:overflow-hidden phone:bg-surface";

/**
 * The detail pane and its optional right panel as one inset object. Its corner
 * follows the host window language through `--workspace-shell-radius` (a token
 * in base.css, 8px on mac and Windows), still spent through `--rf`/`--cs` so
 * the app's round-vs-squircle treatment applies.
 *
 * `display: contents` on phones is load-bearing rather than tidy: dissolving
 * the box restores `.detail-pane` and the fixed panel portal to the layout
 * relationship their mobile positioning rules expect.
 */
export const WORKSPACE_SHELL =
	"relative z-[1] m-1 flex min-h-0 min-w-0 flex-1 overflow-hidden border border-line bg-surface " +
	"rounded-[calc(var(--workspace-shell-radius)*var(--rf))] [corner-shape:var(--cs)] " +
	"shadow-[-2px_1px_5px_-1px_rgba(0,0,0,0.1)] " +
	// Collapsed sidebar: the column is gone, so the workspace keeps only a
	// hairline of gutter on that side instead of the full 4px.
	"[.app-body.sidebar-collapsed_&]:ml-[3px] " +
	"phone:contents";

/**
 * The pane itself. `relative` anchors the floating re-open control that appears
 * when the desktop sidebar collapses.
 *
 * On phones it is a page pushed over the sidebar. `--pane-header-h` is how much
 * room the pane's OWN chrome (the docked tab strip, the transcript's top
 * padding) has to leave for the top bar: the pane is `inset: 0` inside
 * `.app-body`, so it starts wherever the bar leaves off. Under a floating
 * `.app-header-overlay` (home, a session) the bar covers the pane's first
 * `--header-h` pixels and pane-relative offsets must clear it; on every other
 * route the bar stays in flow ABOVE `.app-body`, the pane already starts below
 * it, and counting `--header-h` again would push the strip a full bar-height
 * down the screen. Only for pane-RELATIVE offsets — `position: fixed` chrome
 * inside the pane is viewport-relative and keeps using `--header-h`.
 */
export const DETAIL_PANE =
	"detail-pane relative flex min-h-0 min-w-0 flex-1 flex-col " +
	"phone:absolute phone:inset-0 phone:z-10 phone:bg-surface " +
	"phone:[--pane-header-h:var(--header-h)] " +
	"phone:[.app:not(:has(.app-header-overlay))_&]:[--pane-header-h:0px] " +
	// `transform`, not Tailwind's `translate` property, because that is what
	// the transition beside it names — and what the header animates with.
	"phone:[transform:translateX(100%)] " +
	"phone:[transition:transform_var(--dur-lg)_var(--ease)] " +
	// Pushed on top. The shadow rides the pushed state rather than the pane,
	// or its left-side shadow bleeds back onto the sidebar while it rests just
	// off the right edge.
	"phone:[.app-body.mobile-detail_&]:[transform:translateX(0)] " +
	"phone:[.app-body.mobile-detail_&]:shadow-[-10px_0_28px_rgba(0,0,0,0.35)]";

/** Top bar above the tab strip: the session's header portals in here on
 *  session routes, other views render a plain title. `empty:hidden` collapses
 *  it where there is neither (Home), so it costs no vertical space. */
export const DETAIL_TOPBAR = "detail-topbar flex min-w-0 shrink-0 flex-col empty:hidden";

/**
 * The plain title. Matches `.viewer-header` and the sidebar brand row's height
 * so the three line up across the top of the app.
 *
 * The bottom hairline drops when the tab strip follows, because the strip
 * carries BOTH dividers as inset shadows on one element — same element, same
 * sub-pixel rounding, so they stay identical at fractional display scales
 * where a border and an inset shadow round to different opacities.
 */
export const DETAIL_TOPBAR_TITLE =
	"detail-topbar-title flex h-[var(--desktop-header-h)] items-center px-4 " +
	"border-b border-b-[var(--top-divider)] bg-[var(--topbar-bg)] " +
	"text-body font-semibold text-fg " +
	"[.detail-topbar:has(+_.session-tabs)_&]:border-b-0 " +
	// Collapsed desktop sidebar: clear the floating re-open control and the
	// fallback nav/search cluster beside it.
	"desktop:[.app-body.sidebar-collapsed_&]:pl-[148px] " +
	"phone:hidden";

/**
 * The right panel portals into this slot. `contents` dissolves it so the panel
 * (and its overlay) become direct flex children of the shell — a full-height
 * right column at the same level as the pane, rather than a box confined below
 * the session header.
 */
export const RIGHT_PANEL_SLOT = "contents";

/** Bottom spacer that lets the latest turn reach the top of the viewport. The
 *  scroll hook sets its height imperatively; no transition, so it tracks a
 *  streaming reply exactly. */
export const TURN_SPACER = "pointer-events-none h-0 shrink-0 [overflow-anchor:none]";
