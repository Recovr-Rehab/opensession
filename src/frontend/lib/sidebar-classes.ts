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

export const SIDEBAR_STATUS_DOT = {
	/** Yellow to match the "In progress" lane — green means "In review". */
	running:
		"bg-yellow animate-[pulse_1.4s_ease-in-out_infinite] motion-reduce:[animation-duration:1.4s]! motion-reduce:[animation-iteration-count:infinite]!",
	waiting:
		"bg-blue shadow-[0_0_6px_var(--blue)] animate-[pulse_1.2s_ease-in-out_infinite] motion-reduce:[animation-duration:1.2s]! motion-reduce:[animation-iteration-count:infinite]!",
	idle: "bg-faint",
} as const;
