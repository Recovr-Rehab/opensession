/**
 * The session's right-hand workspace panel, as finished utility classes — what
 * used to be the `panel-*` family in legacy.css.
 *
 * The panel is one surface with two shapes: a resizable column beside the
 * transcript on desktop, and a fixed overlay column from 920px down. Both the
 * shell (PANEL_SHELL, shared with WorkspacePane's standing info panel) and the
 * contents — drag handle, tab strip, body, sheet head — live here.
 *
 * It had a third shape, a full-width bottom sheet on phones, and that is gone
 * rather than migrated: neither call site renders below 720px. See PANEL_SHELL
 * for what was measured before dropping it.
 *
 * Two conventions carried over from lib/pr-tone-classes.ts, for the same
 * reasons: a state carries its whole colour set rather than layering one over
 * another (Tailwind resolves same-property collisions by its own output order),
 * and anything that used to be an ancestor-keyed override is an arbitrary
 * variant on the element itself.
 */

/** 8px, the tab pill's corner — no step in the radius scale lands there, and
 *  it is authored the way base.css authors corners so it tracks the squircle
 *  bump on its own. */
const PILL = "rounded-[calc(8px*var(--rf))]";

/**
 * The panel shell itself — a resizable column beside the transcript, and a
 * fixed overlay column from 920px down. Both of its call sites (SessionViewer's
 * workspace panel and WorkspacePane's standing info panel) render it.
 *
 * `viewer-panel` stays on the markup as a bare hook: lib/pr-tone-classes.ts
 * reaches into it with `[.viewer-panel_&]` to size the PR strip inside the
 * panel, which is a rule about a descendant of an element this file doesn't
 * own.
 *
 * The width is the drag handle's to set — PANEL_RESIZE writes `--panel-w` — so
 * the shell only names the fallback and the bounds. The cap reserves the left
 * sidebar plus a readable session column rather than a fixed pixel width:
 * reviewing code wants real width on a wide display.
 *
 * It paints `bg-surface`, the same fill as the transcript beside it, and is
 * divided from it by the left hairline alone. It used to be `bg-raised`, which
 * in light is #f6f6f6 against a white page: a full-height column of grey next
 * to the content, and the largest flat area in the window whenever the Info tab
 * is short. The panel is a second column of the same page rather than chrome
 * over it, so it takes the page's own surface and lets the cards inside it (the
 * media strip, the diff wells) be the things that step off white.
 *
 * There is deliberately no phone shape here, though the old sheet had one (a
 * full-width bottom sheet: rounded top, `sheet-up` animation, its own shadow).
 * Neither call site renders on a phone — both are gated on `!isPhone`, and the
 * content is reached there as a full-width view tab instead (`session-tab-view`
 * → VIEWER_REVIEW_MAIN). Measured before removing it: at 390px no
 * `.viewer-panel` element exists on either a session or a workspace route, and
 * the toggle that would open one isn't rendered either. Reviving the phone
 * sheet means reviving that JSX first; its styling is not carried here as
 * decoration.
 */
export const PANEL_SHELL =
	"viewer-panel relative flex min-h-0 w-[var(--panel-w,40%)] min-w-[320px] shrink-0 flex-col " +
	"max-w-[max(480px,calc(100vw-620px))] border-l border-divider bg-surface " +
	// From 920px down it stops being a column in the layout and becomes an
	// overlay over the session, anchored under the top bar (--header-h is 0 on
	// desktop, the bar's height on a phone) with PANEL_OVERLAY dimming behind it.
	"max-[920px]:fixed max-[920px]:top-[var(--header-h)] max-[920px]:right-0 max-[920px]:bottom-0 " +
	"max-[920px]:z-30 max-[920px]:w-[min(480px,94vw)] max-[920px]:max-w-none max-[920px]:min-w-0 " +
	"max-[920px]:shadow-[-12px_0_32px_rgba(0,0,0,0.5)]";

/**
 * Left-edge drag handle — the mirror of the sidebar's. The hairline it paints
 * is a ::after inset from the handle's own box, so the grab area is wider than
 * the line without taking layout width. Hidden on phones, where the panel is a
 * sheet with nothing to drag.
 *
 * The hover paint is scoped to `body:not(.resizing-panel)` rather than left to
 * compete with the dragging paint: during a drag the pointer is also hovering,
 * and which of two same-property utilities wins is Tailwind's output order,
 * not the order they are written. The old sheet resolved it by specificity
 * (0,3,0 over 0,2,0); this makes the two states mutually exclusive instead.
 */
export const PANEL_RESIZE =
	"absolute top-0 left-[-3px] z-[6] h-full w-[7px] cursor-col-resize phone:hidden " +
	"after:absolute after:inset-y-0 after:left-[3px] after:w-0.5 after:bg-transparent " +
	"after:transition-[background-color] after:content-[''] " +
	"[body:not(.resizing-panel)_&]:hover:after:bg-line-strong " +
	"[body.resizing-panel_&]:after:bg-faint";

/**
 * Floating pill nav with no bottom divider: the active tab is a filled pill
 * rather than an underline, so the strip reads as a free-standing control group
 * over the panel body. The left inset lands the first pill's label on the panel
 * body's 22px content edge (10px strip + 12px pill padding). When the tabs
 * don't fit it scrolls — on phones behind a soft edge fade rather than a clip.
 */
export const PANEL_TABS =
	"flex items-center gap-0.5 overflow-x-auto px-2.5 pt-[13px] pb-2 " +
	"[scrollbar-width:none] [&::-webkit-scrollbar]:hidden " +
	"phone:gap-1.5 phone:px-3.5 phone:pt-1.5 phone:pb-2.5 " +
	"phone:[-webkit-mask-image:linear-gradient(to_right,transparent_0,#000_10px,#000_calc(100%_-_28px),transparent)] " +
	"phone:[mask-image:linear-gradient(to_right,transparent_0,#000_10px,#000_calc(100%_-_28px),transparent)]";

/** `group/ptab` is what dims the count with its tab. `shrink-0`: tabs never
 *  squish when the strip overflows — it scrolls instead. */
const PANEL_TAB_BASE =
	"group/ptab inline-flex shrink-0 cursor-pointer items-center gap-1.5 whitespace-nowrap " +
	`border-0 px-3 py-[5px] ${PILL} text-label font-medium ` +
	"transition-[background-color,color] " +
	// Phone: a full-round pill with a real touch target. `rounded-[999px]`
	// rather than `rounded-full`: base.css gives squircle corners to
	// `[class*="rounded-"]:not([class*="rounded-full"])`, so the literal string
	// "rounded-full" anywhere in this list would square off the DESKTOP corner
	// too — measured, it did.
	"phone:rounded-[999px] phone:px-[15px] phone:py-2 phone:text-body";

/** Selected and unselected each carry their whole colour set: two background
 *  utilities in one variant bucket are resolved by Tailwind's output order, and
 *  a shared `bg-transparent` base won that race and erased the selected fill. */
export const panelTabClass = (active: boolean) =>
	`${PANEL_TAB_BASE} ` +
	(active
		? "bg-panel text-fg"
		: "bg-transparent text-dim hover:bg-hover hover:text-fg");

/** Count suffix on a tab ("Changes 10"): dimmer than the label, and tabular so
 *  the strip doesn't jitter as the number changes. */
export const panelTabCountClass = (active: boolean) =>
	`tabular-nums ${active ? "text-dim" : "text-faint group-hover/ptab:text-dim"}`;

/** A status dot on a tab. The caller adds the tone's fill. */
export const PANEL_TAB_DOT = "size-[7px] rounded-full";

/** The panel's scrolling content. */
export const PANEL_BODY = "min-h-0 flex-1 overflow-y-auto";

/**
 * The scrim behind the panel once it stops being a column and starts being an
 * overlay. It only exists from 920px down; above that the panel sits in the
 * layout and dims nothing.
 */
export const PANEL_OVERLAY =
	"hidden " +
	"max-[920px]:fixed max-[920px]:inset-[var(--header-h)_0_0_0] max-[920px]:z-[25] " +
	"max-[920px]:block max-[920px]:bg-[rgba(0,0,0,0.45)] " +
	"phone:inset-0 phone:z-[45] phone:bg-[rgba(0,0,0,0.5)]";

/**
 * Chevron-back at the top of the panel on phones — the panel is a deeper page
 * reached from the ⋯ menu, so it carries its own way back to the session,
 * matching the top-bar back chevron (no "Back" word). The old sheet gave it a
 * `6px 0 0 6px` margin that both of its call sites immediately zeroed; it
 * isn't carried over.
 */
export const PANEL_BACK =
	"inline-flex size-10 cursor-pointer items-center justify-center border-0 bg-transparent p-0 " +
	"text-accent touch-manipulation [-webkit-tap-highlight-color:transparent] " +
	"active:opacity-40 [&_svg]:-ml-px";

/** One clean header row at the top of the sheet: back chevron on the left, the
 *  test-this-change actions (Preview / staging globe) on the right. */
export const PANEL_SHEET_HEAD = "flex items-center gap-2 pt-2 pr-3.5 pb-0.5 pl-2";
export const PANEL_SHEET_ACTIONS = "ml-auto flex min-w-0 items-center gap-2";
