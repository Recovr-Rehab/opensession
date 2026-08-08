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
 * ── Containers ──────────────────────────────────────────────────────────────
 * The boxes the row families sit in. Written phone-first with a `min-[721px]:`
 * desktop override, which is the exact complement of the `max-width: 720px`
 * these rules came from — `max-[720px]:` compiles to `< 720` and would leave a
 * viewport exactly 720px wide wearing neither value.
 */

/**
 * The workspace list. Horizontal padding is tight on desktop so the
 * active/hover pill sits close to the sidebar edges (it "overflows" past the
 * content inset, Conductor-style) and row content lands on the shared columns:
 * leading icons under the group-header icons, trailing times/numbers
 * flush-right under the header's filter/＋ buttons. On phones the surfaces
 * breathe past their content rail instead, while the content stays aligned
 * with the tool cards' 16px edge (12px outer + 4px inner below).
 *
 * `data-sidebar-list` rides alongside it: the ArrowUp/ArrowDown row navigation
 * queries this box for its candidate rows, and an attribute says "hook" where a
 * class name would read as styling.
 */
export const SIDEBAR_LIST =
	"flex-none overflow-y-visible px-3 pt-px pb-0 min-[721px]:px-1.5";

/**
 * Bands that are siblings of the workspace list (Automations, People) but
 * participate in the sidebar's single scroll flow rather than creating nested
 * scroll panes.
 */
export const SIDEBAR_INDEPENDENT_SECTION =
	"block min-w-0 flex-none mx-3 min-[721px]:mx-1.5";

/** The scroll flow inside one of those bands — visible, not a nested pane. */
export const SIDEBAR_INDEPENDENT_SCROLL = "min-w-0 overflow-y-visible pb-1.5";

/** A top-level group in the workspace list, and the gap after it. */
export const SIDEBAR_GROUP = "mb-[14px]";

/**
 * A status lane. Consecutive lanes open with 8px of their own, which was an
 * adjacent-sibling rule and stays one: `data-status-group` is what the variant
 * matches, because the margin depends on what precedes the element and no
 * amount of `:not(:first-child)` says the same thing when other kinds of
 * sibling can sit between two lanes.
 */
export const SIDEBAR_STATUS_GROUP = "[[data-status-group]+&]:mt-2";

/**
 * A lane acting as a drop target while a Pinned row is mid-drag: the one under
 * the pointer wears a pill + accent ring, and lanes that only materialized for
 * the drag (they were empty) sit dimmed.
 */
export const SIDEBAR_LANE_EMPTY = "opacity-55";
export const SIDEBAR_LANE_DROP_HOVER =
	"rounded-row bg-pressed opacity-100 shadow-[inset_0_0_0_1px_var(--accent,#6b8afd)]";

/** The drag-to-reorder wrapper around each Pinned row (Motion Reorder.Item). */
export const SIDEBAR_PIN_ENTRY = "relative";

/**
 * While a row is being dragged it floats over its neighbours, so it needs a
 * solid background (rows are transparent over the app bg) and to win the
 * stacking order; the radius matches the row's own so the backdrop doesn't poke
 * out. `[&>*]:pointer-events-none` is the other half of the same state and used
 * to key off the LIST (`.sidebar-pin-list.is-drag-active`): rows sliding under
 * the pointer would otherwise fire mouseenter and pop their hover preview
 * cards, so the row content is muted and only the drag gesture sees the
 * pointer. Every entry wears it while any drag is in flight, which is what the
 * list-level selector did — so the list needs no class of its own.
 */
export const SIDEBAR_PIN_ENTRY_DRAGGING =
	"z-[5] rounded-row bg-bg shadow-[0_4px_14px_rgba(0,0,0,0.25)]";
export const SIDEBAR_PIN_DRAG_ACTIVE = "[&>*]:pointer-events-none";

/**
 * The RepoTile a repo/feed band header leads with. It fills the 22px leading
 * slot rather than riding centred inside it at its 18px default: centred, the
 * tile's ink started 2px right of every other mark in the sidebar (the nav
 * icons and the Pinned/Needs-review glyphs are 22px and start at the slot's own
 * edge), which read as the repo band being indented under headers that aren't.
 * At full size its left AND right edges land on theirs, and the letter scales
 * with it.
 *
 * Passed as RepoTile's `className`, NOT as its `size`: `size` also recomputes
 * the tile's radius (round(22 * 0.28) = 6px) as inline style, where the band
 * header's tile keeps the `.repo-tile` base radius of 4px. The type size is
 * arbitrary rather than `text-xs` because it is the tile's geometry — it tracks
 * the 22px box, not the sidebar's type scale.
 */
export const SIDEBAR_REPO_TILE = "size-[22px] shrink-0 text-[13px]";

/**
 * ── Group headers ───────────────────────────────────────────────────────────
 * The collapsible headings INSIDE the workspace list: Needs review, Pinned,
 * Archived, the repo bands, the automation groups. `group/gh` is what the
 * chevron and the automation cog key their reveal off, so it has to ride on
 * every one of them.
 *
 * Padding is deliberately not here — the Archived heading wears its own,
 * and two utilities from the same group in one string would leave the winner
 * to Tailwind's internal ordering rather than to the call site.
 */
export const SIDEBAR_GROUP_HEADER =
	"group/gh flex w-full items-center gap-[9px] rounded-[calc(10px*var(--rf))] border-none bg-transparent text-[16px] font-medium tracking-[0px] text-dim min-[721px]:text-[14px] hover:bg-hover hover:text-fg";

/** Left pad aligns the icon with a base row (list 6 + header 10 = 16). */
export const SIDEBAR_GROUP_HEADER_INSET =
	"pt-[11px] pr-1 pb-[11px] pl-1 min-[721px]:pt-1 min-[721px]:pr-1.5 min-[721px]:pb-1 min-[721px]:pl-2.5";

/**
 * Status lanes, inbox bands and Snoozed — the groups nested inside a list or a
 * project band. They label the rows rather than lead anywhere, so they read as
 * captions: a size down from the rows, semibold to hold their own at that size,
 * and no leading glyph at all (the rows under them already carry the status
 * marks, and the lane's own name says what it is). Size and weight are what
 * separate a caption from a title, not a third left edge. The phone size is one
 * step up from the desktop caption so it survives arm's-length reading.
 */
export const SIDEBAR_LANE_HEADER =
	"pt-[9px] pb-[5px] text-[13px] font-semibold min-[721px]:pt-1 min-[721px]:pb-1 min-[721px]:text-[12px]";

/**
 * The heading's own name. `truncate` before any width utility: it is the pair
 * of overflow rules that makes the ellipsis, and a min-width of 0 is what lets
 * a flex child shrink far enough to need one.
 */
export const SIDEBAR_GROUP_NAME = "min-w-0 truncate text-left";

/**
 * A glyph's 22px slot carries ~4px of its own padding before the ink starts, so
 * a bare lane caption at the slot's box edge still sat 4px LEFT of every mark
 * around it — the repo tile above read as indented against its own lanes. The
 * pad goes on the label rather than the header, so it holds at both
 * breakpoints and the hover pill keeps running the sidebar's full width.
 */
export const SIDEBAR_LANE_NAME = "pl-1";

/**
 * The collapse chevron. Revealed by the header's hover, and rotated to mark the
 * collapsed state by the call site's inline transform.
 */
export const SIDEBAR_GROUP_CHEVRON =
	"shrink-0 text-faint opacity-0 transition-[transform,opacity] group-hover/gh:text-fg group-hover/gh:opacity-100";

/**
 * The count on a group or band heading. Written phone-first for the same
 * reason the containers above are: the rule this replaces bumped to 13px under
 * `max-width: 720px`, and `max-[720px]:` compiles to `< 720`.
 *
 * Horizontal spacing is deliberately NOT here. The old rule pinned every count
 * to the right with `margin-left: auto` and a 4px inset, and then all but one
 * call site turned both back off — so the pin belongs to the one heading that
 * actually wants it, not to the shared string.
 */
export const SIDEBAR_GROUP_COUNT =
	"text-[13px] font-medium text-faint min-[721px]:text-[12px]";

/**
 * The same count on a status-lane heading, which pins 12px at both widths.
 * That is what the shipped build renders: the lane headings already carried a
 * `text-[12px]` utility, and a utility out-ranks the phone rule in legacy.css,
 * so their counts never took the bump their neighbours' did. Spelled as its
 * own constant rather than reproduced by stacking a second `text-*` on
 * {@link SIDEBAR_GROUP_COUNT}, where the winner would be Tailwind's ordering.
 */
export const SIDEBAR_LANE_COUNT = "text-[12px] font-medium text-faint";

/** The 7px liveness dot a lane or automation heading leads with. */
export const SIDEBAR_GROUP_DOT = "size-[7px] shrink-0 rounded-full opacity-85";

/** The 22px glyph a top-level heading (Needs review, Pinned) leads with. */
export const SIDEBAR_GROUP_ICON = "size-[22px] shrink-0 opacity-90";

/**
 * Automation headings swap their run count for a cog that jumps to that
 * automation's settings. Hover-device only, like the row action clusters — on
 * touch the count stays, because there is no hover to reveal the cog with.
 */
export const SIDEBAR_AUTO_COG =
	"mt-[-4px] mr-0 mb-[-4px] ml-auto hidden size-6 shrink-0 cursor-pointer items-center justify-center rounded-[calc(6px*var(--rf))] text-dim group-hover/gh:inline-flex hover:bg-pressed hover:text-fg";

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
/**
 * ── Band headings ───────────────────────────────────────────────────────────
 * The top-level bands (Tools / Automations / People) — small quiet labels that
 * read like section kickers but behave like Notion's: the whole heading is a
 * full-width hover row that toggles the band, the collapse chevron sits by the
 * label (revealed on hover), and the count / any actions live on the right.
 *
 * Written phone-first with a `min-[721px]:` desktop override, which is the
 * exact complement of the `max-width: 720px` these rules came from —
 * `max-[720px]:` would be `< 720` and leave a one-pixel viewport wearing
 * neither value.
 */
export const SIDEBAR_BAND_LABEL =
	"text-[15px] font-semibold tracking-[-0.01em] text-faint min-[721px]:text-[12px]";

/**
 * The heading's toggle button. Horizontal padding is NOT here: each band sits
 * at a different inset, and two utilities from the same group in one string
 * would leave the winner to Tailwind's internal ordering rather than to the
 * call site. Give it `group/band` so the chevron can key off its hover.
 */
export const SIDEBAR_BAND_TOGGLE =
	// `border-none`, not `border-0`: the latter zeroes the width but leaves the
	// style at Tailwind's `solid` default, which is not what the `border: none`
	// this replaced computed to. Width resolves to 0 under either.
	"group/band m-0 flex min-h-[30px] w-full cursor-pointer items-center gap-[5px] rounded-[calc(8px*var(--rf))] border-none bg-transparent py-1.5 text-left text-inherit [font:inherit] hover:bg-hover hover:text-dim";

/**
 * The inset the Automations and People headings take. 14px on the left, not 8:
 * it lands the label's ink on the one column every leading mark below it
 * already uses, because a 22px glyph carries ~4px of its own padding before its
 * ink starts, so a text label at the same box edge reads 4px further left than
 * the icons and tiles it heads. The phone layout measures the same step from a
 * tighter base inset.
 */
export const SIDEBAR_BAND_TOGGLE_INSET =
	"pr-1 pl-2 min-[721px]:pr-2 min-[721px]:pl-[14px]";

/**
 * The chevron reveals on hover but stays IN LAYOUT at all times (visibility,
 * not display), so it always reserves its box — otherwise its 18px height,
 * taller than the 12px label line, would grow the row the moment it appears
 * and nudge the whole list below. Reserved-but-hidden costs only trailing
 * space at the row's right edge, which is invisible.
 */
export const SIDEBAR_BAND_CHEVRON = "invisible shrink-0 text-faint";

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

/**
 * ── Workspace rows: the trailing cluster ────────────────────────────────────
 * The metadata a workspace / PR / support / feed / archived row carries at its
 * right edge — count, time, run ticker, snooze countdown, draft pencil — and
 * the pin/archive actions that take their place under the pointer.
 *
 * Which of those is visible was decided by a stack of competing `display`
 * rules, three of which carried a comment about the SOURCE ORDER they depended
 * on ("must be @media-gated … it sits after the mobile override blocks",
 * "Three classes so it outranks …", "it must stay below it to win"). Utilities
 * cannot reproduce that: two utilities setting one property are settled by
 * Tailwind's internal output order, not by the order they are written on the
 * element. So the state is resolved in the components instead — every element
 * is handed exactly one `display` per variant level, and nothing needs to
 * out-rank anything. The same rule applies to the action colours below.
 */

/**
 * A workspace row: {@link SIDEBAR_ROW} laid out as one flex line, so the rail,
 * the title and the trailing cluster sit on the sidebar's shared columns. The
 * gap matches {@link SIDEBAR_GROUP_HEADER} — see {@link SIDEBAR_RAIL}.
 */
export const SIDEBAR_WS_ROW = "flex items-center gap-[9px]";

/**
 * Pin + archive, floated over the row's right edge so revealing them can never
 * change the row's height. Long titles run under them, so the cluster wears an
 * opaque row-hover plate with a soft left feather, swapped for the selected
 * fill on the selected row.
 *
 * Resting `display` is the CALL SITE's, because it is the one thing that
 * differs between a live row (hover only), a row whose swipe action is open
 * (never) and an archived row on touch (always).
 */
export const SIDEBAR_WS_ACTIONS =
	"absolute top-1/2 right-[7px] -translate-y-1/2 items-center gap-1 rounded-sm bg-[var(--bg-hover)] shadow-[-6px_0_5px_-2px_var(--bg-hover)] group-data-[selected]:bg-active group-data-[selected]:shadow-[-6px_0_5px_-2px_var(--bg-active)]";

/**
 * The hover-only reveal. `group-hover` is gated to real hover devices by
 * Tailwind, which is exactly what the `@media (hover: hover)` around the old
 * rule was for: on touch a sticky first-tap `:hover` would otherwise expose
 * actions that live behind the swipe gesture there.
 */
export const SIDEBAR_WS_ACTIONS_HOVER = "hidden group-hover:inline-flex";

/**
 * An archived row carries no swipe gesture — that is a live-row affordance —
 * so its unarchive/pin pair is the only way back from the band and has to stay
 * visible on touch. Resting rather than hover-revealed, so it drops the plate
 * (which would read as a chip on every row) and the title reserves the space
 * instead.
 */
export const SIDEBAR_WS_ACTIONS_TOUCH =
	"[@media(hover:none)]:inline-flex [@media(hover:none)]:bg-transparent [@media(hover:none)]:shadow-none";

/**
 * One icon button in that cluster. Its colour is the call site's: a pinned
 * action stays accent even under the pointer, and a Support row's "mark done"
 * tints green rather than plain — three `color` declarations that used to be
 * settled by where their rules sat in the sheet relative to each other.
 */
export const SIDEBAR_WS_ACTION =
	"inline-flex size-8 cursor-pointer items-center justify-center rounded-md hover:bg-hover";

/**
 * Compact last-activity time. It has no `display` of its own on purpose: as a
 * flex item it blockifies, and `text-right` is what right-aligns the digits at
 * rest, while `justify-end` is what right-aligns them once a reveal turns it
 * into a flex box. When something precedes it, that element's own
 * `margin-left: auto` has already pushed the pair right — a second auto margin
 * would split the free space and strand one of them mid-row.
 */
export const SIDEBAR_WS_TIME =
	"ml-auto min-w-[28px] flex-[0_0_auto] justify-end pr-1.5 text-right text-meta text-faint min-[721px]:min-w-[34px] min-[721px]:pr-0";

/** Revealed on row hover, clearing the absolutely-positioned action cluster. */
export const SIDEBAR_WS_TIME_HOVER = "group-hover:inline-flex group-hover:mr-20";

/**
 * Live "in progress" elapsed ticker — it sits where the time badge would, in
 * the in-progress colour, with tabular figures so the digits don't jitter as
 * they tick, and yields the slot to the hover actions.
 *
 * The phone size is its own: the run clock is text, not a glyph, so a hard
 * 28px box with centred digits overflowed on both sides as a run crossed the
 * hour. It sizes to its digits and pins them to the gutter's inner edge, 6px
 * short of the column like every glyph above it.
 */
export const SIDEBAR_WS_TICKER =
	"ml-auto min-w-[28px] flex-[0_0_auto] justify-end pr-1.5 text-right text-meta tabular-nums text-yellow group-hover:hidden min-[721px]:min-w-[34px] min-[721px]:pr-0";

/**
 * Slack-style unsent-draft pencil. Its left margin is the call site's: on a
 * workspace row it pins itself to the right edge, unless a ticker or a snooze
 * countdown already did that pushing.
 */
export const SIDEBAR_WS_DRAFT = "inline-flex flex-[0_0_auto] items-center text-dim";

/**
 * Wake countdown on a snoozed workspace row (moon + "1h"). It stands in for
 * the idle time badge, so it rests in that same right-edge slot, matches its
 * type, and yields to the pin/archive actions like every other trailing badge.
 */
export const SIDEBAR_WS_SNOOZE =
	"ml-auto inline-flex flex-[0_0_auto] items-center gap-1 text-meta tabular-nums text-faint group-hover:hidden";

/**
 * ── Swipe rows ──────────────────────────────────────────────────────────────
 * The phone swipe shell around a workspace or session row: swipe left reveals
 * Archive, swipe right reveals Star; a long press still opens the full action
 * sheet. The wrapper carries the 2px gap between rows, so the row inside it
 * must not add its own or wrapped rows would gap twice.
 *
 * `rounded-row` is what clips the revealed actions to the row's own corner —
 * and, because base.css grants `corner-shape: squircle` to every `rounded-*`
 * class, it is also what lets this name drop out of the hand-written list of
 * legacy classes base.css squircles there.
 */
export const SIDEBAR_SWIPE_ROW = "relative mt-0.5 overflow-hidden rounded-row";

/**
 * One revealed action behind the row. Hidden until the gesture opens its side,
 * and only on touch — on a hover device the same two jobs are the row's hover
 * actions, and a mouse can never open this. Its width tracks the drag through
 * `--swipe-action-w`, written straight onto the wrapper per frame.
 */
export const SIDEBAR_SWIPE_ACTION =
	// `border-none`, not `border-0`: the latter zeroes the width but leaves
	// the style at Tailwind's `solid` default, where the `border: 0` this
	// replaced computed to `none`. Width resolves to 0 under either.
	"absolute top-0 bottom-0 z-0 hidden w-[var(--swipe-action-w,82px)] flex-col items-center justify-center gap-0.5 border-none text-meta font-semibold will-change-[width] [&>svg]:shrink-0";

/** Revealed because the gesture opened this side. Touch only, as above. */
export const SIDEBAR_SWIPE_ACTION_OPEN = "[@media(hover:none)]:flex";

/** The action grows and shrinks with the finger, except while the finger is
 *  actually down — a transition there would lag the drag by a frame. */
export const SIDEBAR_SWIPE_ACTION_TRANSITION =
	"transition-[width] duration-(--dur) ease-(--ease)";

/**
 * Each side carries its own fill AND its own ink, so exactly one `text-*` ever
 * lands on the button. Kept off {@link SIDEBAR_SWIPE_ACTION}: a shared
 * `text-white` there plus a per-side override is two colour utilities on one
 * element, and which of those wins is Tailwind's output order, not the order
 * they are written.
 */

/** Destructive, and on the trailing edge because the swipe travels left. */
export const SIDEBAR_SWIPE_ACTION_ARCHIVE = "right-0 bg-red text-white";

/** Pin, on the leading edge. Dark ink: the yellow is too light for white. */
export const SIDEBAR_SWIPE_ACTION_STAR = "left-0 bg-yellow text-[#17130a]";

/** Already pinned — the same action in the accent, so the swipe reads as a
 *  toggle rather than as a second way to pin. */
export const SIDEBAR_SWIPE_ACTION_STAR_ON = "left-0 bg-accent text-on-accent";

export const SIDEBAR_STATUS_DOT = {
	/** Yellow to match the "In progress" lane — green means "In review". */
	running:
		"bg-yellow animate-[pulse_1.4s_ease-in-out_infinite] motion-reduce:[animation-duration:1.4s]! motion-reduce:[animation-iteration-count:infinite]!",
	waiting:
		"bg-blue shadow-[0_0_6px_var(--blue)] animate-[pulse_1.2s_ease-in-out_infinite] motion-reduce:[animation-duration:1.2s]! motion-reduce:[animation-iteration-count:infinite]!",
	idle: "bg-faint",
} as const;
