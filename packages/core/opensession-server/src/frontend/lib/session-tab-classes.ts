/**
 * The session tab strip's vocabulary, as finished utility classes — what used
 * to be the `session-tab*` family in legacy.css.
 *
 * Two things shape everything here.
 *
 * 1. The strip has two related floating looks. On desktop, inactive tabs are
 *    quiet labels separated by short rules while the active tab sits on a
 *    filled, rounded surface. There is no underline or full-width bottom rule.
 *    On phones every tab needs its own solid pill because the bar is docked over
 *    scrolling content, so the shared pill is unprefixed and desktop resolves
 *    each state with `desktop:` overrides. Tailwind emits every breakpoint
 *    variant after every unprefixed and pseudo-class utility, which makes that
 *    responsive override reliable. Note that Tailwind's `phone:` is `width <
 *    720px`, not the `max-width: 720px` the old sheet and `useIsPhone` mean, so
 *    phone-only rules are written as overrides on a base that already reads
 *    correctly, never as one half of a split.
 *
 * 2. For the same reason, each tab state carries its WHOLE colour set. A
 *    colored tab does not layer a fill over the plain tab's fill; `tabClass`
 *    returns exactly one background, one border colour and one box-shadow per
 *    state. That is also why the states are resolved in JS: the old cascade
 *    picked a winner by rule order (colored beats waiting beats active), and a
 *    stack of utilities cannot reproduce "later rule wins" reliably.
 *
 * A few class names survive on the markup as bare hooks with no styling of
 * their own, because things OUTSIDE this file name them:
 *
 *   · `session-tabs`: app-shell-classes.ts suppresses the top bar's scroll
 *     divider while the strip overlaps that edge, and SessionSplit sizes the
 *     bar with `[&>.session-tabs]:shrink-0`;
 *   · `session-tab-view` / `session-tab-reorder`: `.app:has(.session-tab-view)
 *     .app-header-overlay` and `.detail-pane:has(.session-tab-reorder ~
 *     .session-tab-reorder)` set the phone header's fill and
 *     `--strip-clearance` on elements that belong to other components.
 *
 * The dots used to be a third pair of hooks, for base.css's reduced-motion
 * exception list; they now carry that exception themselves — see `tabDotClass`.
 */

/** 8px, the tab pill's corner. Authored the way base.css authors every corner
 *  so it tracks the squircle bump; there is no 8px step in the radius scale. */
const PILL = "rounded-[calc(8px*var(--rf))]";

/* ── The strip ──────────────────────────────────────────────────────────── */

/**
 * The bar itself. `group/strip` reveals history, which stays quiet until the
 * strip is pointed at. The new-tab + remains visible whenever the strip exists.
 *
 * The old rule painted a `linear-gradient(var(--topbar-bg), var(--bg))` here,
 * but BOTH breakpoints set `background: var(--bg)` over it, so the gradient
 * never reached a screen; the same is true of its 6px/8px padding. Neither is
 * carried over.
 */
export const TAB_STRIP =
	"session-tabs group/strip flex min-w-0 shrink-0 items-center gap-[3px] bg-surface px-2 " +
	// Desktop: a compact, line-free band. The active tab's own surface supplies
	// the selection boundary, so neither an underline nor a rule across the
	// content belongs here.
	//
	// The non-split bar takes its 11px header overlap at the call site. The
	// session header above is a fixed 48px row whose title is centred in it, and
	// the tab labels are centred in this 40px band, so the two words sit far
	// apart while neither box looks generous. Neither row can be trimmed on its
	// own because the header's height lines it up with the sidebar's brand row.
	// The strip closes the distance by climbing into the header's slack. Split
	// bars start at the top of an overflow-clipped column, so their full box stays
	// in flow instead of losing its top edge outside that column.
	"desktop:h-10 desktop:py-0 " +
	// Phone: pulled out of flow and pinned flush under the header's bottom edge,
	// so it reads as fixed chrome rather than a strip the transcript scrolls by.
	"phone:absolute phone:inset-x-0 phone:top-[var(--pane-header-h)] phone:z-[6] " +
	"phone:m-0 phone:border-b phone:border-line phone:py-[5px] " +
	"phone:shadow-[0_6px_12px_-8px_rgba(0,0,0,0.22)] " +
	// Mobile Safari can rasterize two composited layers that merely touch with a
	// hairline seam: overlap the header by 2px and add those 2px back as padding.
	"phone:[.app:has(.app-header-overlay)_&]:top-[calc(var(--pane-header-h)_-_2px)] " +
	"phone:[.app:has(.app-header-overlay)_&]:pt-[7px] " +
	// Immersive reading: SessionViewer sets body.chrome-collapsed from the
	// transcript's scroll direction and the bar slides off with the top bar.
	// `transform`, not the `translate` property, because that is what the
	// transition names — and what .app-header-overlay animates beside it.
	"phone:[transition:transform_var(--dur-lg)_var(--ease)] " +
	"phone:[body.chrome-collapsed_&]:[transform:translateY(calc(-100%_-_var(--pane-header-h)_-_8px))] " +
	// A lone session with no view tabs has nothing to switch between, so the
	// strip is pure chrome on a phone — every tab is a .session-tab-reorder
	// wrapper, so "2+ sessions" reads as two adjacent wrappers.
	"phone:[&:not(:has(.session-tab-view)):not(:has(.session-tab-reorder~.session-tab-reorder))]:hidden";

/**
 * The scrolling half of the strip. Its edge fades are driven by a CSS scroll
 * timeline — no scroll listeners, no re-renders — and are gated on the
 * `data-overflow` attribute the component writes, because a timeline that goes
 * INACTIVE holds its last value instead of reverting.
 */
export const TAB_SCROLL =
	// `flex-[1_1_auto]`, not `flex-1`: Tailwind's shorthand is `1 1 0%`, and a
	// zero basis sizes the scroll from nothing rather than from its tabs.
	"flex min-w-0 flex-[1_1_auto] items-center gap-[3px] overflow-x-auto overscroll-x-contain " +
	"[scrollbar-width:none] [&::-webkit-scrollbar]:hidden " +
	// Hug the content on desktop so the pinned "+" sits right after the last tab
	// rather than being pushed to the far right. The group keeps its intrinsic
	// height so the selected tab floats vertically inside the 40px band.
	"desktop:flex-[0_1_auto] " +
	"supports-[animation-timeline:scroll()]:[animation:session-tabs-fade-start_1ms_both,session-tabs-fade-end_1ms_both] " +
	"supports-[animation-timeline:scroll()]:[animation-timeline:scroll(self_inline),scroll(self_inline)] " +
	"supports-[animation-timeline:scroll()]:[animation-range:0_24px,calc(100%_-_24px)_100%] " +
	"supports-[animation-timeline:scroll()]:data-[overflow]:[mask-image:linear-gradient(to_right,transparent_0,#000_var(--tabs-fade-start),#000_calc(100%_-_var(--tabs-fade-end)),transparent_100%)]";

/**
 * The drag-to-reorder group wraps EVERY tab — sessions and view panes alike —
 * so a pane can be dragged in among the sessions. `flex-none` is load-bearing:
 * the tabs inside never shrink, so a group allowed to shrink would collapse
 * below its content and the last tab would paint over whatever the scroll laid
 * out after the shrunken box. Sizing to content pushes the overflow out to the
 * scroll, which is the thing that scrolls.
 */
export const TAB_GROUP = "relative inline-flex flex-none items-center gap-[3px]";

/** Each tab's Reorder.Item wrapper. `relative` lets whileDrag's z-index lift
 *  the dragged tab over its siblings. On desktop, a short rule separates quiet
 *  inactive tabs. The selected tab and the final tab need no trailing rule. */
export const TAB_ITEM =
	"session-tab-reorder relative inline-flex shrink-0 items-center " +
	"desktop:after:pointer-events-none desktop:after:absolute desktop:after:top-1/2 " +
	"desktop:after:-right-0.5 desktop:after:h-3 desktop:after:w-px desktop:after:-translate-y-1/2 " +
	"desktop:after:bg-divider desktop:after:content-[''] desktop:last:after:hidden " +
	// The active pill supplies both edges: hide this item's trailing divider
	// when either this item or its next sibling is active.
	"desktop:[&:has(>[aria-selected=true])]:after:hidden desktop:data-[next-active]:after:hidden";

/** Picked up: an inactive desktop tab has no surface of its own and would smear
 *  over every label it passes. It lifts into an opaque chip while dragging. */
export const TAB_ITEM_DRAGGING =
	`${PILL} cursor-grabbing bg-panel smooth-shadow-ring-sm desktop:rounded-control`;

/**
 * Where the dragged tab will land. Reorder already opens the gap live, but an
 * empty hole between two bare labels reads as nothing, so this paints a thin
 * insertion rule at the slot's leading edge — a caret, not a second chip
 * competing with the tab in hand. Above the dragged chip on purpose: the chip
 * follows the pointer while the slot snaps to whole positions, so a caret
 * painted underneath would vanish exactly when the order changes.
 */
export const TAB_DROP_SLOT =
	"pointer-events-none absolute inset-y-2 z-[5] " +
	"[animation:tab-drop-slot-in_var(--dur-micro)_var(--ease)] [transition:left_var(--dur)_var(--ease)] " +
	"motion-reduce:animate-none motion-reduce:transition-none " +
	"after:absolute after:inset-y-0 after:left-0 after:w-0.5 after:rounded-[1px] after:bg-accent after:content-['']";

/** Trailing controls pinned after the scroll on desktop. */
export const TAB_ACTIONS = "ml-auto flex flex-none items-center gap-[3px]";

/* ── A tab ──────────────────────────────────────────────────────────────── */

/**
 * Everything a tab is regardless of state: box, type and the interaction
 * transition. The label was 12px, which is not a step on the type scale; it is
 * interface copy, so it snaps UP to `text-label` (13px) — which is also what
 * the phone rule already set on the title, so the two viewports now agree
 * instead of differing by a pixel.
 */
const TAB_BASE =
	"relative inline-flex max-w-[200px] shrink-0 cursor-pointer items-center gap-1.5 whitespace-nowrap " +
	"px-2.5 py-1.5 text-label transition-[background-color,color] " +
	// A floating phone pill with a solid fill, so the transcript scrolling
	// underneath never shows through it. Desktop keeps the same compact box but
	// drops the ring and shadow, rounds it to the shared control corner, and lets
	// `tabClass` choose whether it has a surface.
	`border ${PILL} smooth-shadow-sm ` +
	"desktop:rounded-control desktop:border-0 desktop:shadow-none";

export type TabState = {
	active: boolean;
	waiting: boolean;
	/** A user-chosen swatch, supplied inline as `--tab-color`. */
	colored: boolean;
};

/**
 * One tab, painted for exactly one state.
 *
 * Phone keeps the established status and custom-colour pills. Desktop resolves
 * the selected surface independently: active always stays unmistakable, while
 * a waiting tab already has its live dot and needs no second coloured plate.
 */
export function tabClass(state: TabState): string {
	const { active, waiting, colored } = state;
	const ink = active || waiting ? "text-fg" : "text-dim hover:text-fg";

	// One phone fill + one ring per state, hover included. A second background
	// utility in the same variant bucket would be resolved by Tailwind's output
	// order rather than by which state is meant to win.
	const phonePill =
		colored && active
			? "border-[color-mix(in_srgb,var(--tab-color)_60%,transparent)] " +
				"bg-[color-mix(in_srgb,var(--tab-color)_26%,var(--bg-active))] " +
				"hover:bg-[color-mix(in_srgb,var(--tab-color)_26%,var(--bg-active))]"
			: colored
				? "border-[color-mix(in_srgb,var(--tab-color)_50%,transparent)] " +
					"bg-[color-mix(in_srgb,var(--tab-color)_14%,var(--bg-panel))] " +
					"hover:bg-[color-mix(in_srgb,var(--tab-color)_22%,var(--bg-panel))]"
				: waiting
					? // Same hue as the sidebar's "needs you" row and the Needs
						// action band: blocked-on-you is urgent, not informational.
						"border-red bg-red-soft hover:bg-red-soft"
					: active
						? "border-transparent bg-[color-mix(in_srgb,var(--bg-active)_94%,var(--text))] hover:bg-hover"
						: "border-transparent bg-panel hover:bg-hover";

	// The selected tab is the only ordinary desktop tab with a surface. Custom
	// colours remain visible as an explicit exception, but use a quieter mix when
	// inactive so they do not compete with the selected tab.
	const desktopPill = colored
		? active
			? "desktop:bg-[color-mix(in_srgb,var(--tab-color)_22%,var(--bg-panel))] " +
				"desktop:hover:bg-[color-mix(in_srgb,var(--tab-color)_28%,var(--bg-panel))]"
			: "desktop:bg-[color-mix(in_srgb,var(--tab-color)_9%,transparent)] " +
				"desktop:hover:bg-[color-mix(in_srgb,var(--tab-color)_16%,transparent)]"
		: active
			? "desktop:bg-panel desktop:hover:bg-hover"
			: "desktop:bg-transparent desktop:hover:bg-hover";

	return `${TAB_BASE} ${ink} ${phonePill} ${desktopPill}`;
}

/** The label. Gives up its width first so a long title truncates instead of
 *  pushing the close × out of the pill. */
export const TAB_TITLE = "max-w-[150px] overflow-hidden text-ellipsis";

/** An icon-only view tab (Staging → a globe): drop the label's text metrics so
 *  the tab sizes to the glyph. */
export const TAB_VICON = "inline-flex items-center justify-center leading-none";

/** Unsent draft in a sibling session. */
export const TAB_DRAFT = "inline-flex flex-none items-center text-dim";

/**
 * Teammates who have THIS tab open. The sidebar answers "someone is in this
 * workspace"; a workspace is a strip of tabs, so the strip is where that
 * answers "which one".
 *
 * The faces sit in a row with a small gap rather than an overlapping pile:
 * a pile needs a gap ring painted in the surface behind it, and a tab has
 * five of those (plain, hover, active, waiting, coloured, and none of them on
 * desktop, where the tab is flat on the strip). Two faces plus a count is
 * also all a 200px tab has room for.
 */
export const TAB_FACES = "flex flex-none items-center gap-0.5";

/** One face. Small enough to read as a marker beside the label, not a
 *  participant list. */
export const TAB_FACE = "shrink-0";

/** "+2" when more people are here than the strip shows faces for. */
export const TAB_FACES_MORE = "text-meta leading-none text-dim";

/** Inline rename input, sized to sit in place of the title. */
export const TAB_RENAME =
	"my-[-1px] max-w-[150px] rounded-xs border border-accent bg-surface px-[3px] font-[inherit] text-[inherit] outline-none";

/* ── Liveness dots ──────────────────────────────────────────────────────── */

/**
 * The running / needs-you dot. "Needs you" is blue throughout — the sidebar
 * already resolved it that way.
 *
 * base.css's reduced-motion block kills every animation with `!important` and
 * then hands a handful of liveness signals back BY CLASS NAME — these two dots
 * among them. That list is the one thing a migration can break silently: the
 * rule stays valid, it just stops matching, and the "still running" pulse
 * freezes for anyone with the preference set with nothing to detect it. So the
 * exception rides the element instead of the list, where it travels with the
 * component; it wins on equal specificity because the utility sheet is linked
 * last, and `!` matches the block it is arguing with.
 *
 * `pulse` is defined by BOTH legacy.css and the utility sheet, and keyframes
 * don't cascade by specificity: the later definition wins document-wide, so
 * every legacy `animation: pulse` has in fact been running the utility sheet's
 * 1 → 0.5 fade rather than the authored 1 → 0.35. Naming the same keyframes
 * here keeps exactly what ships; this is not the place to change it.
 */
const DOT_BASE = "size-1.5 shrink-0 rounded-full";

export const tabDotClass = (waiting: boolean) =>
	waiting
		? `${DOT_BASE} bg-blue shadow-[0_0_6px_var(--blue)] animate-[pulse_1.2s_ease-in-out_infinite] ` +
			"motion-reduce:[animation-duration:1.2s]! motion-reduce:[animation-iteration-count:infinite]!"
		: `${DOT_BASE} bg-yellow animate-[pulse_1.4s_ease-in-out_infinite] ` +
			"motion-reduce:[animation-duration:1.4s]! motion-reduce:[animation-iteration-count:infinite]!";

/** A view tab's status dot (PR state). Shared with the right panel's tabs,
 *  which render the same mark. The caller adds the tone's fill. */
export const PANEL_TAB_DOT = "size-[7px] rounded-full";

/**
 * What that dot means on a Review view-tab: the PR's state, plus the conflict
 * case, which is a mergeability flag rather than a state of its own.
 *
 * A lookup of literal strings because the old spelling was
 * `` `pr-dot-${prState.toLowerCase()}` `` — a class assembled at runtime, which
 * no utility can ever be (Tailwind only compiles names it can find in source).
 * Same tones the rule set, and the same ones lib/sidebar-hover gives these
 * states in the row hover cards.
 */
export const PR_DOT_TONE: Record<string, string> = {
	OPEN: "bg-green",
	MERGED: "bg-purple",
	CLOSED: "bg-red",
	CONFLICT: "bg-yellow",
};

/* ── Per-tab close, and the trailing controls ───────────────────────────── */

const CLOSE_BASE =
	"-my-0.5 -mr-[3px] inline-flex size-4 shrink-0 cursor-pointer items-center justify-center " +
	"rounded-sm border-0 bg-transparent p-0 font-[inherit] text-[15px] leading-none text-dim " +
	"hover:bg-pressed hover:text-fg [@media_(hover:none)]:size-[26px] [@media_(hover:none)]:-mr-1";

/** Revealed over the trailing edge on hover, so pointer-driven tabs reserve no
 * width for close. A focused button reveals too, preserving keyboard feedback. */
const CLOSE_OVERLAY =
	"[@media_(hover:hover)_and_(pointer:fine)]:absolute " +
	"[@media_(hover:hover)_and_(pointer:fine)]:right-1 [@media_(hover:hover)_and_(pointer:fine)]:top-1/2 " +
	"[@media_(hover:hover)_and_(pointer:fine)]:z-[1] [@media_(hover:hover)_and_(pointer:fine)]:m-0 " +
	"[@media_(hover:hover)_and_(pointer:fine)]:-translate-y-1/2 " +
	"[@media_(hover:hover)_and_(pointer:fine)]:pointer-events-none " +
	"[@media_(hover:hover)_and_(pointer:fine)]:opacity-0 " +
	"[@media_(hover:hover)_and_(pointer:fine)]:transition-opacity " +
	"[@media_(hover:hover)_and_(pointer:fine)]:group-hover/tab:pointer-events-auto " +
	"[@media_(hover:hover)_and_(pointer:fine)]:group-hover/tab:opacity-100 " +
	"[@media_(hover:hover)_and_(pointer:fine)]:focus-visible:pointer-events-auto " +
	"[@media_(hover:hover)_and_(pointer:fine)]:focus-visible:opacity-100";

/** Phones have no hover, so close stays in flow with a finger-sized hit area. */
const CLOSE_TOUCH = "size-[26px] -mr-1";

export const tabCloseClass = (phone: boolean) =>
	`${CLOSE_BASE} ${phone ? CLOSE_TOUCH : CLOSE_OVERLAY}`;

/**
 * The trailing controls use quiet chrome with no pill fill or shadow. History
 * reveals with the strip, on focus, and while its menu is open.
 */
const CTRL_REVEAL =
	"[@media_(hover:hover)_and_(pointer:fine)]:pointer-events-none " +
	"[@media_(hover:hover)_and_(pointer:fine)]:opacity-0 " +
	"[@media_(hover:hover)_and_(pointer:fine)]:transition-opacity " +
	"[@media_(hover:hover)_and_(pointer:fine)]:group-hover/strip:pointer-events-auto " +
	"[@media_(hover:hover)_and_(pointer:fine)]:group-hover/strip:opacity-100 " +
	"[@media_(hover:hover)_and_(pointer:fine)]:focus-visible:pointer-events-auto " +
	"[@media_(hover:hover)_and_(pointer:fine)]:focus-visible:opacity-100 " +
	"[@media_(hover:hover)_and_(pointer:fine)]:data-[menu-open]:pointer-events-auto " +
	"[@media_(hover:hover)_and_(pointer:fine)]:data-[menu-open]:opacity-100 " +
	"[@media_(hover:hover)_and_(pointer:fine)]:data-[popup-open]:pointer-events-auto " +
	"[@media_(hover:hover)_and_(pointer:fine)]:data-[popup-open]:opacity-100";

const CTRL_BASE =
	"inline-flex min-h-[36px] shrink-0 cursor-pointer items-center whitespace-nowrap " +
	`border border-transparent bg-transparent px-3.5 py-1.5 ${PILL} ` +
	"font-[inherit] leading-none text-dim transition-[background-color,color] " +
	"hover:bg-hover hover:text-fg";

/**
 * New-tab "+". Always visible once there is a strip, so adding a sibling does
 * not depend on discovering a hover state. It keeps a comfortable square hit
 * area on touch and matches the header's ⋯ control on desktop.
 */
export const TAB_NEW =
	`${CTRL_BASE} justify-center text-[15px] ` +
	"desktop:min-h-auto desktop:self-center desktop:rounded-control " +
	"desktop:px-[5px] desktop:py-[3px] desktop:text-[22px]";

/**
 * Archived-sessions menu. Same desktop footprint as the "+" it sits beside:
 * the two are one pair of quiet square controls after the last tab, and a
 * taller plate here read as a control stretched to fill the 40px band. Stays
 * lit while its menu is open (`data-popup-open`).
 */
export const TAB_HISTORY =
	`${CTRL_BASE} justify-center ` +
	"desktop:min-h-auto desktop:self-center desktop:rounded-control " +
	"desktop:px-[5px] desktop:py-[3px] " +
	"data-[popup-open]:bg-hover data-[popup-open]:text-fg " +
	CTRL_REVEAL;

/** The + tab's right-click mode menu (share / stacked / ask): a fixed popup
 *  anchored at the cursor, so it escapes the tab strip's overflow clipping.
 *  This carries the surface too — it used to come from `.tab-color-menu`, a
 *  rule named after the swatch row it no longer dresses (those chips live in the
 *  tab context menu now). Above every other popup on the pane at z-1000. */
export const NEW_MENU =
	"fixed z-[1000] flex min-w-[250px] flex-col gap-px rounded-popup bg-popup-glass [backdrop-filter:var(--popup-blur)] [--smooth-ring-color:var(--popup-ring)] p-1 " +
	"smooth-shadow-ring-md";
export const NEW_MENU_ITEM =
	"block w-full cursor-pointer whitespace-nowrap rounded-[calc(6px*var(--rf))] border-0 " +
	"bg-transparent px-2 py-1.5 text-left text-label text-fg hover:bg-hover";

/* ── Tab colour swatches ─────────────────────────────────────────────────────
   The row of colour chips in a tab's context menu. Each chip carries its colour
   as an inline style (the palette is data, see lib/tab-colors), so what's left
   here is the ring, the box and the grow-on-hover.

   `rounded-full` is right on these and only these: the rule spelled a bare
   `border-radius: 50%` with no `corner-shape`, so a chip is a true circle
   rather than one of the app's squircles. The hairline stays the untokenized
   15% white it has always been — it reads as a highlight on a saturated chip,
   not as a chrome border, so `border-line` would be a visual change rather
   than a translation. */
export const TAB_SWATCH =
	"size-[22px] rounded-full border border-[rgba(255,255,255,0.15)] transition-transform hover:scale-[1.18]";

/** The chip for the colour the tab currently wears: a ring in the page ink,
 *  gapped off the chip by the panel it sits on. */
export const TAB_SWATCH_ON = "shadow-[0_0_0_2px_var(--bg-panel),0_0_0_3px_var(--text)]";

/** The "no colour" chip: an empty ring with a diagonal strike. */
export const TAB_SWATCH_NONE =
	"relative bg-active after:absolute after:inset-[3px] after:rotate-45 after:border-t " +
	"after:border-t-faint after:content-['']";
