/**
 * The session viewer's own chrome, as finished utility classes — what used to
 * be the `viewer-*` family in legacy.css, plus the banner row and the
 * delete-in-flight label that sit with it.
 *
 * Everything that used to be keyed off an ancestor is an arbitrary variant on
 * the element itself, so the whole subtree moves in one step: a compound
 * legacy selector (`.app-header-actions .viewer-header`) outranks a single
 * utility, and a half-migrated element quietly keeps its old styling.
 *
 * Three class names stay on the markup as bare hooks with no styling of their
 * own, because things outside this family name them:
 *
 *   · `viewer-header` — base.css makes the row a native titlebar drag region
 *     in the desktop shell (`html.wco .viewer-header`), with no-drag carve-outs
 *     for everything interactive inside it. That is a rule about descendants of
 *     an element in a platform state; it cannot be a utility;
 *   · `viewer-header-actions` — lib/pr-tone-classes.ts spaces the PR chip off
 *     the row with `[.viewer-header-actions_&]:mx-1.5`;
 *   · `viewer-messages` — base.css's selection policy opts the whole transcript
 *     in, and MarkdownBody, VirtualTranscriptBlock and CodeHighlight all find
 *     their scroll container with `closest(".viewer-messages")`.
 */

/* ── Top bar ────────────────────────────────────────────────────────────── */

/**
 * Fixed height so the bar lines up with the sidebar's brand row instead of
 * growing with its tallest button, and the session body's colour rather than
 * the lifted topbar tint, so the whole top region reads as one surface the
 * transcript dissolves into under the floating pills.
 *
 * There is deliberately no hairline: at the top of a transcript nothing passes
 * under the bar and there is nothing to divide, and once there IS content up
 * there the scroll-edge wash below does the separating. It comes back for
 * engines without scroll-driven animations, which never get the wash — and
 * drops again when the tab strip follows the bar, because the strip carries
 * both dividers as inset shadows on one element.
 */
export const VIEWER_HEADER =
	"viewer-header flex h-[var(--desktop-header-h)] min-w-0 shrink-0 items-center justify-between gap-3 " +
	"bg-surface px-4 " +
	"[@supports_not_(animation-timeline:scroll())]:border-b " +
	"[@supports_not_(animation-timeline:scroll())]:border-b-[var(--top-divider)] " +
	"[.detail-topbar:has(+_.session-tabs)_&]:border-b-0 " +
	// Collapsed desktop sidebar: the floating re-open + nav cluster overlays the
	// pane's left edge, so the row's text starts past it.
	"min-[721px]:[.app-body.sidebar-collapsed_&]:pl-[148px] " +
	// On phones the bar is a set of floating pills inside the app header, not a
	// row of its own.
	"max-[720px]:[.app-header-actions_&]:h-auto max-[720px]:[.app-header-actions_&]:gap-1.5 " +
	"max-[720px]:[.app-header-actions_&]:border-0 max-[720px]:[.app-header-actions_&]:bg-transparent " +
	"max-[720px]:[.app-header-actions_&]:p-0";

/** Workspace name + origin chip + status. Hidden on phones, where the ⋯ menu
 *  carries what it holds. */
export const VIEWER_TITLE =
	"flex min-w-0 items-center gap-2.5 font-medium max-[720px]:hidden";

/**
 * The workspace name. Capped so a long one truncates instead of eating the
 * whole bar; it still shrinks below that when the row runs out of room. The
 * shell makes the surrounding header a native window drag region, so this opts
 * out — its text stays selectable and copyable.
 */
export const VIEWER_BRANCH =
	"min-w-0 max-w-[420px] select-text overflow-hidden text-ellipsis whitespace-nowrap text-body " +
	"[-webkit-touch-callout:default] " +
	"[html.wco_&]:[-webkit-app-region:no-drag] [html.wco_&]:[app-region:no-drag]";

/** Double-clickable to rename — hinted on hover without shifting the row. */
export const VIEWER_BRANCH_EDITABLE =
	"-mx-2 -my-[5px] cursor-text rounded-[calc(6px*var(--rf))] px-2 py-[5px] hover:bg-hover";

/** Inline rename input, sized to sit in place of the name. */
export const VIEWER_BRANCH_RENAME =
	"my-[-2px] min-w-0 max-w-[280px] rounded-[calc(8px*var(--rf))] border border-accent bg-surface " +
	"px-1 py-px font-[inherit] text-body text-[inherit] outline-none";

/**
 * The trailing controls. Icon buttons sit in a tight cluster so they read as
 * one group; the labelled items in the row (the Linear/Plain links, the
 * presence facepile, the PR chip) space themselves.
 */
export const VIEWER_HEADER_ACTIONS =
	"viewer-header-actions flex shrink-0 items-center gap-0.5 max-[720px]:justify-end";

/** ⋯ overflow: the secondary actions collapse into the shared Menu popup when
 *  they would otherwise crowd the title. */
export const VIEWER_OVERFLOW = "relative inline-flex";

export const VIEWER_DELETE_CONFIRM = "flex gap-1.5";

/* ── Panes ──────────────────────────────────────────────────────────────── */

/**
 * Full-width review host: a flex child of the session column that stretches, so
 * the PrPanel (whose split is `height: 100%`) fills the whole area. Unlike the
 * transcript it doesn't self-pad for the phone's fixed header and docked tab
 * bar, so it is pushed below them instead.
 */
export const VIEWER_REVIEW_MAIN =
	"flex min-h-0 flex-1 flex-col " +
	"max-[720px]:pt-[calc(var(--pane-header-h)+var(--strip-clearance,0px))]";

/* ── Transcript ─────────────────────────────────────────────────────────── */

/**
 * Holds the scroll area plus the floating "Jump to latest" pill, and — on
 * desktop — the top scroll-edge wash.
 *
 * Content scrolled past the top dissolves into the header, and the wash appears
 * only when there IS content up there: it is driven entirely by a CSS scroll
 * timeline, so there are no scroll listeners and no re-renders. This is what
 * replaces the header's hairline. Because it tracks scroll position rather than
 * animating over time it stays active under reduced motion — nothing moves that
 * wouldn't move anyway. Phones fade the transcript under their floating pills
 * with a mask instead (see VIEWER_MESSAGES).
 */
export const VIEWER_MESSAGES_REGION =
	"relative flex min-h-0 flex-1 flex-col " +
	"min-[721px]:supports-[animation-timeline:scroll()]:[timeline-scope:--viewer-session-scroll] " +
	"min-[721px]:supports-[animation-timeline:scroll()]:before:absolute " +
	"min-[721px]:supports-[animation-timeline:scroll()]:before:inset-x-0 " +
	"min-[721px]:supports-[animation-timeline:scroll()]:before:top-0 " +
	"min-[721px]:supports-[animation-timeline:scroll()]:before:h-[var(--wash-depth)] " +
	// Above the transcript's flow content, but below the composer (z 1, a later
	// sibling) and the jump-latest pill (z 5).
	"min-[721px]:supports-[animation-timeline:scroll()]:before:z-[1] " +
	"min-[721px]:supports-[animation-timeline:scroll()]:before:pointer-events-none " +
	"min-[721px]:supports-[animation-timeline:scroll()]:before:opacity-0 " +
	// `background`, not `bg-[…]`: --wash-up is a gradient, and Tailwind would
	// read a bare var() as a colour and emit background-color.
	"min-[721px]:supports-[animation-timeline:scroll()]:before:[background:var(--wash-up)] " +
	"min-[721px]:supports-[animation-timeline:scroll()]:before:[animation:session-edge-fade-in_1ms_both] " +
	"min-[721px]:supports-[animation-timeline:scroll()]:before:[animation-timeline:--viewer-session-scroll] " +
	// Fully in after a couple of lines of scroll-back.
	"min-[721px]:supports-[animation-timeline:scroll()]:before:[animation-range:0_56px] " +
	"min-[721px]:supports-[animation-timeline:scroll()]:before:content-['']";

/**
 * The scroll container.
 *
 * Never a sideways-pannable session: anything internally wide (code, tables)
 * scrolls inside its own pane. A flex column rather than block flow, because
 * WebKit paints cross-block selection as full-width bands across a block
 * container — it skips flex containers, so selection hugs the text. That is
 * also why the children need an explicit width: auto side margins centre them,
 * and in a flex container auto cross-axis margins disable `align-items:
 * stretch`, so they would size to their content and overflow sideways.
 *
 * The bottom inset is the WASH's depth, not the composer's overlap: clearing
 * the whole ramp is what makes a soft edge affordable, and it is what the
 * native app's bar does too.
 */
export const VIEWER_MESSAGES =
	"viewer-messages flex min-h-0 flex-1 flex-col overflow-x-hidden overflow-y-auto overscroll-contain " +
	// Keep the reader's place when content loads or expands above them.
	"[overflow-anchor:auto] px-5 pt-[18px] pb-[var(--wash-depth)] " +
	"[&>*]:w-full [&>*]:shrink-0 " +
	"min-[721px]:supports-[animation-timeline:scroll()]:[scroll-timeline:--viewer-session-scroll_y] " +
	// Phone: clear the floating pills at rest, then scroll under them.
	// --strip-clearance is 0 by default and the docked tab bar's height on a
	// multi-session workspace.
	"max-[720px]:px-3 " +
	"max-[720px]:pt-[calc(var(--pane-header-h)+var(--strip-clearance,0px)+8px)] " +
	// Dissolve the transcript into the header as it scrolls up under the pills.
	// Same non-linear distribution as --wash-down mirrored into mask alpha:
	// hidden for the first fifth, 45% by three fifths, full at the bar height.
	"max-[720px]:[-webkit-mask-image:linear-gradient(to_bottom,transparent_0,transparent_calc(var(--pane-header-h)*0.2),rgba(0,0,0,0.45)_calc(var(--pane-header-h)*0.6),#000_var(--pane-header-h))] " +
	"max-[720px]:[mask-image:linear-gradient(to_bottom,transparent_0,transparent_calc(var(--pane-header-h)*0.2),rgba(0,0,0,0.45)_calc(var(--pane-header-h)*0.6),#000_var(--pane-header-h))] " +
	// With the header slid away, the revealed rows read at full strength rather
	// than dissolving into an absent bar.
	"max-[720px]:[body.chrome-collapsed_&]:[-webkit-mask-image:none] " +
	"max-[720px]:[body.chrome-collapsed_&]:[mask-image:none]";

/**
 * The composer floats up over the transcript so the session scrolls UNDER it,
 * in normal flow — a negative top margin only shifts it visually, which is what
 * keeps the iOS keyboard handling untouched. Its top padding is deliberately
 * smaller than that margin, so the box rises a few px above where the
 * transcript ends and the last row tucks slightly under it.
 *
 * The transcript's bottom scroll edge hangs off the COMPOSER rather than the
 * scroll container, for the same reason the native app hangs its wash off the
 * bar: an overlay inside the scroll box is laid out inside the inset the
 * composer already took, so it paints in the wrong place — and the composer is
 * the thing content actually disappears behind.
 */
export const VIEWER_INPUT =
	"relative z-[1] mt-[calc(-1*var(--session-under))] shrink-0 bg-surface px-5 pt-1 pb-3.5 " +
	"before:absolute before:inset-x-0 before:bottom-full before:h-[var(--wash-depth)] " +
	"before:pointer-events-none before:[background:var(--wash-down)] before:content-[''] " +
	// Phone: clear the home indicator rather than jamming the composer against
	// the very bottom edge — that gap is also all the room the composer's
	// shadow gets in mobile Safari, where there is no safe-area inset.
	"max-[720px]:px-3 max-[720px]:pb-[max(16px,env(safe-area-inset-bottom,0px))] " +
	// Keyboard up: iOS keeps reporting the inset even though the keyboard now
	// covers that area. Scoped to the EXPANDED composer — the resting pill only
	// shows while the field is unfocused, so it must keep the full gap.
	"max-[720px]:[body.kb-open_&:has(.composer:not(.composer-min))]:pb-0";

/* ── Banners and the delete overlay ─────────────────────────────────────── */

export const SESSION_BANNERS =
	"flex flex-wrap gap-2 border-b border-line bg-raised px-4 py-[7px]";

/** A single notice pill. It carries no ink of its own: the caller supplies the
 *  tone, because two text-colour utilities on one element are resolved by
 *  Tailwind's output order rather than the order they are written. 12px in the
 *  old sheet; it is interface copy, so it snaps to `text-label`. */
export const SESSION_BANNER =
	"inline-flex max-w-full items-center gap-1.5 overflow-hidden text-ellipsis whitespace-nowrap " +
	"rounded-full border border-line bg-panel px-3 py-[3px] text-label";

/** Shown while a delete (optionally + worktree) is in flight — worktree
 *  cleanup can take a few seconds, so the view shows progress instead of
 *  looking frozen. */
export const SESSION_DELETE_LABEL = "text-label text-dim";
