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
 * desktop it is two flush columns: the sidebar, then the workspace filling the
 * rest of the window, with a hairline seam and, in light, a soft shadow falling
 * back onto the sidebar. On phones the
 * outer box DISSOLVES — `.workspace-shell` was `display: contents`
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
 *   · `detail-topbar` / `detail-topbar-title` — base.css insets the title past
 *     the traffic lights and the floating nav cluster when the desktop sidebar
 *     is collapsed, a rule about an element in a platform state that cannot be
 *     a utility. The title row also wears `wco-chrome`, the one name that makes
 *     a top-of-pane row draggable in the desktop shell.
 *
 * `workspace-shell`, `right-panel-slot`, `turn-spacer` and `reviews` named
 * nothing outside their own rules, so those names are gone from the markup
 * entirely.
 */

/**
 * The row under the top bar: sidebar + workspace. Desktop paints the shared
 * chrome material here so the sidebar sits on it, and an opaque sticky header
 * scrolls over the same colour instead of revealing a seam. Phones get the
 * page stack's positioning context instead, and the plain page colour.
 */
export const APP_BODY =
	"app-body flex min-h-0 flex-1 bg-sidebar " +
	"desktop:[background:linear-gradient(var(--sidebar-material),var(--sidebar-material)),var(--sidebar-bg)] " +
	"phone:relative phone:overflow-hidden phone:bg-surface";

/**
 * The detail pane and its optional right panel as one object, flush to the
 * window: the workspace takes every pixel the sidebar leaves, and the only
 * thing between the two is the seam and, in light, a subtle shadow on its left
 * edge. No gutter and no corner: the shadow only gives the sidebar a little
 * depth against the workspace without turning the seam into a raised card
 * edge. `--content-edge-shadow` is `none` in dark, where a black cast on a
 * near-black column reads as a smudge rather than depth.
 *
 * `display: contents` on phones is load-bearing rather than tidy: dissolving
 * the box restores `.detail-pane` and the fixed panel portal to the layout
 * relationship their mobile positioning rules expect.
 */
export const WORKSPACE_SHELL =
	// Above the sidebar's pinned labels (z 20), so their scroll-under washes
	// cannot cut the shadow. The resize grabber stays above both at z 30.
	"relative z-[25] flex min-h-0 min-w-0 flex-1 overflow-hidden border-l border-divider bg-surface desktop:[box-shadow:var(--content-edge-shadow)] " +
	// Collapsed sidebar: nothing to divide from or cast depth onto.
	"[.app-body.sidebar-collapsed_&]:border-l-0 [.app-body.sidebar-collapsed_&]:[box-shadow:none] " +
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
	"phone:[.app-body.mobile-detail_&]:shadow-[-10px_0_28px_rgba(0,0,0,0.35)] " +
	// How much extra top room the phone's DOCKED tab bar takes, published to
	// everything inside the pane that has to start below it — the transcript
	// (VIEWER_MESSAGES), the view-tab panes, the review host. It is only set
	// when a strip is really shown: a lone session with no view tabs hides the
	// strip, and then the default 0 is the right answer. Two selectors because
	// "a strip is shown" is either a view tab or a second session tab.
	"phone:[&:has(.session-tab-view)]:[--strip-clearance:46px] " +
	"phone:[&:has(.session-tab-reorder~.session-tab-reorder)]:[--strip-clearance:46px]";

/**
 * The drop target outlined while a tab is dragged to the pane's edge to split
 * it. Absolutely placed inside the pane, below the header and the tab strip,
 * and inert — it is a hint, never a hit target.
 *
 * The width is the share the dropped column would take. Half the pane is right
 * only for the drop that CREATES a split; once one exists App.tsx overrides
 * `--split-preview-share` with the target column's real ratio. The 12px it
 * subtracts is the 8px inset on its own side plus the gutter to the divider.
 *
 * The 36px is where the desktop tab strip ends (a 40px band pulled 8px up into
 * the header, see `TAB_STRIP`) plus the same 4px gutter the other edges keep;
 * it moves with the band.
 */
export const tabSplitDropPreviewClass = (side: "left" | "right") =>
	"pointer-events-none absolute top-[calc(var(--desktop-header-h)+36px)] bottom-2 z-[25] " +
	"w-[calc(var(--split-preview-share,50%)-12px)] " +
	"rounded-[calc(10px*var(--rf))] [corner-shape:var(--cs)] border-2 border-accent " +
	"bg-[color-mix(in_srgb,var(--accent)_18%,transparent)] " +
	// A hairline of white inside the accent edge, so the outline still reads
	// against a light screenshot or a pale diff behind it.
	"shadow-[inset_0_0_0_1px_color-mix(in_srgb,white_16%,transparent)] " +
	(side === "left" ? "left-2" : "right-2");

/**
 * The hairline a chrome row grows once content has scrolled underneath it.
 *
 * At rest a bar and the content below it share one fill, so there is no seam
 * to mark and no line is drawn — that is the resting top row the app settled
 * on. Content that has scrolled up under the row IS a seam, and this closes it
 * off for as long as it lasts. The sidebar's chrome strip and the pane's title
 * bar both take it, so the two halves of the top row answer their own scroller
 * on the same terms.
 *
 * `data-scrolled` is set by `hooks/useScrollEdge.ts`; the module doc there
 * says why it is an attribute rather than a scroll timeline.
 *
 * A pseudo-element rather than a border: a border that appears would jog
 * everything below it down a pixel, and a permanently-present transparent one
 * would grow `.detail-topbar` — which has no fixed height — past the 48px the
 * bars align on. It also keeps `empty:hidden` working, which a real child
 * would defeat. The flip is `desktop:` only; on phones the bar floats over the
 * content and dissolves it with a mask instead (see `appHeader`).
 */
export const SCROLL_EDGE_DIVIDER =
	"relative after:pointer-events-none after:absolute after:inset-x-0 " +
	"after:bottom-0 after:h-px after:bg-divider after:opacity-0 " +
	"after:transition-opacity after:content-[''] " +
	"desktop:data-[scrolled]:after:opacity-100";

/** Top bar above the tab strip: the session's header portals in here on
 *  session routes, other views render a plain title. `empty:hidden` collapses
 *  it where there is neither (Home), so it costs no vertical space.
 *
 *  A tab strip below the bar already draws the one rule the active tab's
 *  underline rests on, so the scroll hairline stands down rather than putting
 *  a second line across the same top block. Written against the pane rather
 *  than as `:has(+ .session-tabs)`: a split gives each column its own strip,
 *  nested a level down from this row. */
export const DETAIL_TOPBAR =
	`detail-topbar flex min-w-0 shrink-0 flex-col empty:hidden ${SCROLL_EDGE_DIVIDER} ` +
	"[.detail-pane:has(.session-tabs)_&]:after:content-none";

/**
 * The plain title. Matches `.viewer-header` and the sidebar brand row's height
 * so the three line up across the top of the app — at every width, including
 * under a tab strip.
 *
 * The bottom hairline drops when the tab strip follows, leaving the strip's
 * own bottom inset as the single divider above the content.
 */
export const DETAIL_TOPBAR_TITLE =
	// `m-0`: it is an `h1`, and the app ships no preflight, so the UA margin is
	// still there to clear.
	"detail-topbar-title wco-chrome m-0 flex h-[var(--desktop-header-h)] items-center px-4 " +
	"border-b border-b-divider bg-[var(--topbar-bg)] " +
	"text-item-title font-semibold text-fg " +
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
