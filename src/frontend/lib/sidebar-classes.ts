/**
 * Class strings shared by the sidebar's row families, kept out of the
 * components so Sidebar, SidebarItem, FeedRows and PrRow can all wear the same
 * geometry without one of them drifting.
 *
 * Everything here is written out in full on purpose. Tailwind scans source
 * TEXT, so a class assembled at runtime — `` `sidebar-status-${tone}` `` and
 * its Tailwind equivalent alike — compiles to nothing at all. A lookup of
 * complete literals is the only shape that survives.
 */

/**
 * The sidebar's leading column. Every row and group header opens with one of
 * these, whatever it holds — a 22px glyph, a 20px one, a 7px status dot, a
 * repo tile — so the marks share a centre line AND the text after them shares
 * a left rail. Before this the slot was whatever its content measured
 * (7 / 17 / 20 / 22), which fanned the titles out across seven different left
 * edges in the same list. Wrap shared marks at the call site rather than
 * resizing them: the group dot and RepoTile are also dropdown option icons,
 * where a 22px box would be wrong.
 */
export const SIDEBAR_RAIL =
	"relative flex size-[22px] flex-[0_0_22px] items-center justify-center";

/**
 * ── Sticky machinery ────────────────────────────────────────────────────────
 * The desktop sidebar is ONE scroll rail, and two tiers of heading pin inside
 * it: a band heading (Tools / Workspaces / Automations / People) holds the top
 * slot, and the lane, repo and status headers under it pin one row lower.
 * Every pinning element also carries `data-sticky-head`, which is what
 * Sidebar's scroll listener queries — CSS has no interoperable `:stuck`, so
 * `is-stuck` is toggled from JS and only then does a header paint its backing.
 *
 * Everything here is gated on `min-[721px]`: on phones the whole sidebar is a
 * page that scrolls as one, and nothing pins.
 */

/** Tier 1 — a band heading pinned at the top of the rail. */
export const SIDEBAR_STICKY_BAND =
	"min-[721px]:sticky min-[721px]:top-0 min-[721px]:z-20";

/**
 * One invariant row height for the tier-1 headings, which is what stops the
 * outgoing and incoming labels peeking around each other while one section
 * pushes the next away. It overrides whatever vertical padding/margin the
 * heading wears in the phone layout, so it is written at the same `min-[721px]`
 * breakpoint the pinning is.
 */
export const SIDEBAR_STICKY_BAND_ROW =
	"min-[721px]:mt-0 min-[721px]:flex min-[721px]:h-[44px] min-[721px]:min-h-[44px] min-[721px]:items-center min-[721px]:py-[7px]";

/** Tier 2 — a lane / repo / status header, pinned one band-row lower. */
export const SIDEBAR_STICKY_LANE =
	"min-[721px]:sticky min-[721px]:top-[44px] min-[721px]:z-[15] min-[721px]:h-[30px] min-[721px]:min-h-[30px]";

/**
 * A status lane nested inside a repo band sits one row lower again — its repo
 * header already occupies the first sub-header slot — and must pass UNDER that
 * header, hence the lower z-index. Pass it after {@link SIDEBAR_STICKY_LANE}
 * through `cn()`, which resolves the pair to this one.
 */
export const SIDEBAR_STICKY_LANE_NESTED =
	"min-[721px]:top-[74px] min-[721px]:z-[14]";

/**
 * The surface a header paints once it is actually pinned. A full-width backing
 * pseudo-element in the sidebar's OWN material layered over the opaque sidebar
 * base, so a stuck header matches the sidebar colour exactly instead of
 * stacking a second darker layer, and spans edge to edge regardless of how deep
 * the header is inset (the ±400px overhang is clipped by the sidebar's
 * overflow-x). The bottom overhang covers the host's translucent bottom border,
 * which text passing underneath would otherwise show through.
 *
 * Opaque on purpose — this used to backdrop-blur the rows sliding beneath, but
 * toggling a blur from the scroll listener re-rasterized the whole sidebar
 * mid-scroll (visible flashing on loaded machines).
 */
export const SIDEBAR_STUCK_BACKING =
	"min-[721px]:[&.is-stuck::before]:absolute min-[721px]:[&.is-stuck::before]:top-0 min-[721px]:[&.is-stuck::before]:bottom-[-1px] min-[721px]:[&.is-stuck::before]:left-[-400px] min-[721px]:[&.is-stuck::before]:right-[-400px] min-[721px]:[&.is-stuck::before]:z-[-1] min-[721px]:[&.is-stuck::before]:content-[''] min-[721px]:[&.is-stuck::before]:[background:linear-gradient(var(--sidebar-material),var(--sidebar-material)),var(--bg-raised)]";

/**
 * The live-state dot a row, group header or hover card carries, minus the
 * `size-2 shrink-0 rounded-full` box the call sites already give it.
 *
 * The reduced-motion exceptions ride on the element rather than on a class
 * name listed in base.css: that block kills every animation with `!important`
 * and then hands the genuine liveness signals back BY CLASS NAME, so dropping
 * a legacy class name silently freezes the indicator with nothing to catch it.
 * These durations match what base.css grants `.sidebar-status-running` (1.4s)
 * and `.sidebar-status-waiting` (1.2s).
 *
 * `pulse` resolves to Tailwind's keyframes, not the stylesheet's: both define
 * one, keyframes don't cascade by specificity, and Tailwind's sheet is linked
 * second — which is already what these dots animate with today.
 */
/**
 * The sidebar's collapse toggle, and the floating re-open control that stands
 * in for it once the sidebar is hidden. They share a look on purpose: the
 * affordance has to read the same whether the sidebar is open or gone.
 *
 * Size and `display` are deliberately NOT here. The in-row toggle is a padding
 * box matching `.viewer-code-icon`, so the two top bars read as one system,
 * while the floating re-open control keeps a fixed 34x34 square (what centers
 * it on the collapsed header row) and starts out `hidden`. Two utilities from
 * the same group in one string would leave the winner to Tailwind's internal
 * ordering rather than to the call site.
 */
export const SIDEBAR_CHROME_BTN =
	"shrink-0 items-center justify-center rounded-control text-faint transition-[color,background] hover:bg-hover hover:text-fg";

/**
 * The square icon buttons in the workspace header — the filter and the new
 * session "+". 20px glyph type on a 34px box, stepped up to 22 on 38 at phone
 * widths, where the whole sidebar is a tap surface. The hover wash is applied
 * by the call site rather than baked in, because the filter button's `active`
 * state paints a stronger wash that hovering must NOT wash back out.
 */
export const SIDEBAR_HEADER_BTN = "shrink-0 rounded-control font-medium";
/**
 * Size and type step together, so each viewport carries its whole pair rather
 * than overriding half of the other's. `leading-none` has to sit AFTER the
 * `text-*` in the same string: cn() is tailwind-merge, which files `leading`
 * as a conflict of `font-size`, so a later type size silently drops an earlier
 * line-height and the glyph starts riding on `normal`.
 */
export const SIDEBAR_HEADER_BTN_PHONE = "size-[38px] text-[22px] leading-none";
export const SIDEBAR_HEADER_BTN_DESKTOP = "size-[34px] text-[20px] leading-none";

/**
 * The trailing icon button on a band heading (the feed filter). Carries no
 * resting colour of its own: the call site picks exactly one, because two
 * `text-*` utilities on one element are decided by Tailwind's internal order,
 * not by which one you wrote last.
 */
export const SIDEBAR_BAND_ACTION =
	"ml-auto inline-flex size-7 shrink-0 items-center justify-center rounded-control hover:bg-hover hover:text-fg";

/**
 * The dot a filter button wears while a non-default filter is applied — the
 * mark only; its accent TEXT colour is the call site's, for the reason above.
 * A bare `border-radius: 50%` with no corner-shape of its own, so
 * `rounded-full` — the one radius spelling base.css does NOT squircle — is the
 * correct spelling here.
 */
export const SIDEBAR_FILTER_DOT =
	"relative after:absolute after:top-[5px] after:right-[5px] after:size-1.5 after:rounded-full after:bg-accent after:content-['']";

/**
 * The needs-input count on a COLLAPSED repo band — urgent rows must not vanish
 * inside a closed group, so the band keeps a badge in the needs-input lane's
 * colour. `rounded-full`, not `rounded-[999px]`: the old rule set no
 * corner-shape, and rounded-full is the one radius spelling base.css leaves
 * un-squircled.
 */
export const SIDEBAR_ATTN_COUNT =
	"min-w-4 flex-[0_0_auto] rounded-full bg-blue px-1 text-center text-[10px] leading-4 font-semibold text-white";

export const SIDEBAR_STATUS_DOT = {
	/** Yellow to match the "In progress" lane — green means "In review". */
	running:
		"bg-yellow animate-[pulse_1.4s_ease-in-out_infinite] motion-reduce:[animation-duration:1.4s]! motion-reduce:[animation-iteration-count:infinite]!",
	waiting:
		"bg-blue shadow-[0_0_6px_var(--blue)] animate-[pulse_1.2s_ease-in-out_infinite] motion-reduce:[animation-duration:1.2s]! motion-reduce:[animation-iteration-count:infinite]!",
	idle: "bg-faint",
} as const;
