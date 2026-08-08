import type { GitDotTone } from "./pr-git-tasks";
import type { PrTone } from "./pr-refs";
import type { checkClass } from "./pr-status-derive";

/**
 * The shared vocabulary of the PR surfaces, as finished utility classes.
 *
 * Two things live here rather than on the markup.
 *
 * The tone lookups replace classes the `pr-*` markup used to assemble at
 * render time — `pr-git-dot-${tone}`, `pr-bar-state-${tone}`,
 * `pr-num-chip-${tone}`, `pr-sib-dot-${tone}`. A class built from a fragment
 * can never be proven unused by scripts/css-audit.ts, so those rules were
 * pinned in legacy.css permanently; a lookup that returns the whole class
 * cannot be. Same pattern as TONE_TEXT in lib/sidebar-hover.ts.
 *
 * The row strings are here because two surfaces render the same git-status
 * row from different components — the review canvas (pr/GitStatus.tsx) and the
 * workspace panel (WorkspaceInfo.tsx). They were one legacy class each; a
 * shared constant keeps them one thing rather than two copies that drift.
 */

/** Fill for the small state dot on a git-status row. `muted` keeps the dot's
 *  own default (faint), which is what "no tone class" used to mean. */
export const GIT_DOT_BG: Record<GitDotTone, string> = {
	green: "bg-green",
	yellow: "bg-yellow",
	red: "bg-red",
	blue: "bg-blue",
	purple: "bg-purple",
	muted: "bg-faint",
};

/** A state dot, not a step marker: small and filled with the row's own state
 *  colour, so a stack of them doesn't read as a checklist that never
 *  completes. Pair with a GIT_DOT_BG entry. */
export const GIT_DOT = "mx-0.5 size-1.5 shrink-0 rounded-full";
export const GIT_ROW = "flex items-center gap-2 px-2 py-1 text-label text-fg";
export const GIT_LABEL = "flex-1 overflow-hidden text-ellipsis";
/** The one action that clears the row, quiet on the right. 12px in the old
 *  sheet; it is a control label, so it snaps to text-label. */
export const GIT_ACTION =
	"whitespace-nowrap py-0.5 pl-2 text-label font-semibold text-dim enabled:hover:text-fg disabled:cursor-default disabled:opacity-60";
/** Follow-up line under the rows. Carries no colour: the caller adds
 *  `text-faint` ("Asked … ✓") or `text-red` (an error), because two colour
 *  utilities on one element resolve by Tailwind output order, not by the
 *  order they are written. */
export const GIT_NOTE = "pt-0.5 pb-1.5 pl-5 text-meta";

/** Ink for a check's mark and its rollup count. Replaces `${checkClass(…)}-text`,
 *  which was built from the rank string at render time. `check-neutral` had no
 *  rule of its own and keeps inheriting the row's colour. */
/** pr-status-derive.ts keeps its rank union private; read it off the function. */
type CheckRank = ReturnType<typeof checkClass>;

export const CHECK_TEXT: Record<CheckRank, string> = {
	"check-success": "text-green",
	"check-failure": "text-red",
	"check-pending": "text-yellow",
	"check-neutral": "",
};

/** The "Deployments" / "Checks" divider inside the checks card. */
export const CHECKS_GROUP =
	"pb-1.5 text-label font-semibold tracking-[-0.01em] text-faint";

/* ── PR status strip ─────────────────────────────────────────────────────
 *
 * The strip (PrStatusBar) and the series rows under it (PrSeriesRows) are one
 * subtree rendered from two components, so their vocabulary lives here rather
 * than in either file.
 *
 * Two ancestors reach into the strip from SessionViewer — the phone bottom
 * sheet (`.viewer-panel`) and the info page's status card
 * (`.session-info-status`). Those classes belong to a component this family
 * doesn't own, so their overrides stay selectors, as arbitrary variants on the
 * strip itself, instead of becoming props on a component two callers away.
 */

/** The strip: one row of status atop the workspace panel, with a border that
 *  lines up with the session header's. */
export const PR_BAR =
	"flex min-h-[var(--desktop-header-h)] items-center gap-2.5 border-b border-[var(--top-divider)] px-3 py-2 " +
	// The globe (staging) icon rides inside the strip, flush to its padding.
	"[&>.staging-icon]:-ml-0.5 [&>.staging-icon]:shrink-0 " +
	// Phone: a row of the bottom sheet, and a row of the info card.
	"max-[720px]:[.viewer-panel_&]:min-h-[50px] max-[720px]:[.viewer-panel_&]:px-3.5 " +
	"max-[720px]:[.session-info-status_&]:min-h-[46px] max-[720px]:[.session-info-status_&]:px-2.5 " +
	"max-[720px]:[.session-info-status_&]:last:border-b-0";

/** Inside the info card the strip (or the stack of strips) is the card's
 *  content, so it takes the card's corner and clips to it. */
export const PR_BAR_IN_CARD =
	"max-[720px]:[.session-info-status>&]:overflow-hidden max-[720px]:[.session-info-status>&]:rounded-control";

/** The strip's tone band. Purple and yellow had no soft token and were frozen
 *  as dark-theme rgba() literals, so both themes got the dark hue; mixing from
 *  the token re-themes them. */
export const PR_BAR_BG: Record<PrTone, string> = {
	green: "bg-green-soft",
	purple: "bg-[color-mix(in_srgb,var(--purple)_10%,transparent)]",
	red: "bg-red-soft",
	yellow: "bg-[color-mix(in_srgb,var(--yellow)_9%,transparent)]",
	// The session's own top bar surface, so header + strip read as one band —
	// except in the info card, which supplies its own surface.
	muted:
		"bg-[var(--topbar-bg)] max-[720px]:[.session-info-status_&]:bg-transparent",
};

/** A session that shipped one feature as several PRs: the primary strip plus a
 *  row per sibling, as one continuous block of status. */
export const PR_BAR_STACK = `flex min-w-0 flex-col ${PR_BAR_IN_CARD}`;

/** First-load placeholder ("Checking status…") so the strip holds its place
 *  instead of popping in once /pr and /git-status resolve. */
export const PR_BAR_CHECKING =
	"text-label font-semibold text-dim animate-[pulse_1.6s_ease-in-out_infinite]";

/** The headline — the one derived line the strip is for. */
export const PR_BAR_STATE =
	"cursor-pointer overflow-hidden text-ellipsis whitespace-nowrap text-label font-semibold hover:underline";

/** Ink for the headline and for a series row's state. */
export const PR_STATE_TEXT: Record<PrTone, string> = {
	green: "text-green",
	purple: "text-purple",
	red: "text-red",
	yellow: "text-yellow",
	muted: "text-dim",
};

export const PR_BAR_ERROR = "max-w-[180px] truncate text-meta text-red";
export const PR_BAR_PROMPTED = "whitespace-nowrap text-label text-dim";

/** Compact chip + primary action in the session header, shown while the
 *  workspace panel is closed. */
export const PR_HEAD =
	"flex min-w-0 items-center gap-2 [.viewer-header-actions_&]:mx-1.5";
/** The header's error/prompted lines are tighter than the strip's — the header
 *  has a title to leave room for. */
export const PR_HEAD_ERROR = "max-w-[120px] truncate text-meta text-red";
export const PR_HEAD_PROMPTED =
	"max-w-[180px] truncate whitespace-nowrap text-label text-dim";
/** Sized to the header chip so the pair reads as one control. */
export const PR_HEAD_BTN = "min-h-[32px] px-[11px]";

/** Where a PR chip is rendered. `bar`/`head` are the primary chip (half of the
 *  split button, hence the squared end); `sib` is a sibling chip in the header,
 *  `row` a sibling chip inside a series row. */
type ChipSize = "bar" | "head" | "sib" | "row";

const CHIP_BASE =
	"inline-flex items-center gap-0.5 whitespace-nowrap border font-semibold tabular-nums no-underline transition-[background-color]";

const CHIP_SIZE: Record<ChipSize, string> = {
	bar: "min-h-[30px] cursor-pointer rounded-s-control rounded-e-none px-2.5 text-label",
	head: "min-h-[32px] cursor-pointer rounded-s-control rounded-e-none px-[11px] text-label",
	// A sibling chip in the header was authored as a smaller pill, but the
	// header's own `.pr-head .pr-num-chip` override sat later in the stylesheet
	// and won the tie, so what ships is the primary chip's size minus its
	// shadow. Kept as it ships; making it genuinely smaller is a visual change,
	// not a migration.
	sib: "min-h-[32px] cursor-pointer rounded-control px-[11px] text-label",
	// Inert markup inside the row button — the whole row is the target.
	row: "min-h-[22px] cursor-[inherit] rounded-md px-[7px] text-label",
};

/** Toned chips take a soft tinted fill rather than the neutral control
 *  surface, so a green "Ready to merge" chip sits as a green pill on the green
 *  strip. Each entry carries its whole colour set — ink, edge, fill and hover
 *  — because two colour utilities on one element resolve by Tailwind's output
 *  order, not by the order they are written. */
const CHIP_TONE: Record<PrTone, string> = {
	muted:
		"border-line bg-control text-dim hover:bg-[color-mix(in_srgb,currentColor_12%,transparent)] active:bg-[color-mix(in_srgb,currentColor_18%,transparent)]",
	green:
		"border-[color-mix(in_srgb,var(--green)_22%,transparent)] bg-[color-mix(in_srgb,var(--green)_24%,var(--control-surface))] text-green hover:bg-[color-mix(in_srgb,currentColor_32%,var(--control-surface))]",
	purple:
		"border-[color-mix(in_srgb,var(--purple)_22%,transparent)] bg-[color-mix(in_srgb,var(--purple)_24%,var(--control-surface))] text-purple hover:bg-[color-mix(in_srgb,currentColor_32%,var(--control-surface))]",
	red: "border-[color-mix(in_srgb,var(--red)_22%,transparent)] bg-[color-mix(in_srgb,var(--red)_24%,var(--control-surface))] text-red hover:bg-[color-mix(in_srgb,currentColor_32%,var(--control-surface))]",
	yellow:
		"border-[color-mix(in_srgb,var(--yellow)_22%,transparent)] bg-[color-mix(in_srgb,var(--yellow)_24%,var(--control-surface))] text-yellow hover:bg-[color-mix(in_srgb,currentColor_32%,var(--control-surface))]",
};

/** The same chip on a plain row: the primary chip fills with its tone because
 *  it sits on a matching band, and on a bare row that fill reads as a badge and
 *  out-shouts the strip. Toned ink and edge, no fill, no hover — the state on
 *  the right is where the colour carries. */
const CHIP_TONE_FLAT: Record<PrTone, string> = {
	muted: "border-line bg-control text-dim",
	green: "border-[color-mix(in_srgb,var(--green)_22%,transparent)] bg-control text-green",
	purple:
		"border-[color-mix(in_srgb,var(--purple)_22%,transparent)] bg-control text-purple",
	red: "border-[color-mix(in_srgb,var(--red)_22%,transparent)] bg-control text-red",
	yellow:
		"border-[color-mix(in_srgb,var(--yellow)_22%,transparent)] bg-control text-yellow",
};

export function prChipClass(tone: PrTone, size: ChipSize): string {
	const flat = size === "row";
	// Only the neutral chip keeps the control shadow: a toned pill is already
	// separated from the strip by its fill, and a sibling chip is too small to
	// carry one.
	const shadow = tone === "muted" && (size === "bar" || size === "head");
	return `${CHIP_BASE} ${CHIP_SIZE[size]} ${flat ? CHIP_TONE_FLAT[tone] : CHIP_TONE[tone]}${shadow ? " shadow-control" : ""}`;
}

/** The outbound half of the split button: same tone, square inner corner, and
 *  it presses rather than washes. */
export function prChipExternalClass(tone: PrTone, size: "bar" | "head"): string {
	const geometry =
		// -ml-px collapses the shared seam to a single hairline.
		"-ml-px inline-flex items-center justify-center rounded-e-control rounded-s-none border no-underline transition-[background-color,scale] active:scale-[0.96]";
	const colour =
		tone === "muted"
			? // No ink of its own: the neutral half is an <a>, so its arrow takes
				// the link colour, and the hover wash mixes from it.
				"border-line bg-control shadow-control hover:bg-[color-mix(in_srgb,currentColor_12%,transparent)]"
			: CHIP_TONE[tone];
	return `${geometry} ${size === "head" ? "size-[32px]" : "size-[30px]"} ${colour}`;
}

/** The split button's two halves lift over each other on hover/focus so the
 *  shared seam doesn't clip the active one's edge. */
export const PR_CHIP_SEAM =
	"hover:relative hover:z-[1] focus-visible:relative focus-visible:z-[1]";

/** Sibling PRs in the header's overflow menu: a dot in each PR's own tone. */
export const PR_SIB_DOT = "size-[7px] shrink-0 rounded-full";
export const PR_SIB_DOT_BG: Record<PrTone, string> = {
	green: "bg-green",
	purple: "bg-purple",
	red: "bg-red",
	yellow: "bg-yellow",
	muted: "bg-dim",
};

/** A series row: repo · number · title · state. No surface of its own — it
 *  carries the strip's divider so primary + series read as one block. */
export const PR_ROW =
	"flex min-h-[32px] items-center gap-0.5 border-b border-[var(--top-divider)] pr-2 hover:bg-hover " +
	"max-[720px]:[.session-info-status_&]:last:border-b-0";
export const PR_ROW_MAIN =
	"flex min-w-0 flex-1 cursor-pointer items-center gap-2 px-3 py-1 text-left text-label";
/** The title takes what's left and gives it up first — the state on the right
 *  is the part you scan for. */
export const PR_ROW_TITLE = "min-w-0 truncate text-dim";
export const PR_ROW_STATE =
	"ml-auto shrink-0 whitespace-nowrap text-label font-semibold";
/* ── Per-repo tabs (a multi-repo session's PR panel) ─────────────────────
 *
 * Selected and unselected each carry their whole colour set. Layering the
 * selected one over a default would leave two border-color utilities on one
 * element, and which wins is Tailwind's output order rather than the order
 * they are written. Phone keeps the bigger tap target it already had.
 */
export const PR_REPO_TABS =
	"flex gap-1 overflow-x-auto border-b border-line px-3 py-2";
const PR_REPO_TAB =
	"inline-flex cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-md border px-2.5 py-[3px] text-label max-[720px]:px-3 max-[720px]:py-2";
export const prRepoTabClass = (selected: boolean) =>
	`${PR_REPO_TAB} ${selected ? "border-line bg-panel text-fg" : "border-transparent bg-transparent text-dim hover:text-fg"}`;
/** Unlink (×) inside the selected linked-PR tab. */
export const PR_REPO_TAB_X = "-mr-1 inline-flex items-center text-dim hover:text-fg";

/* ── Review guide ────────────────────────────────────────────────────────
 *
 * The generated walk through a PR: numbered sections, each a title, an
 * explanation and the patch it is about.
 */
export const PR_GUIDE_SECTION = "mb-7";
export const PR_GUIDE_COUNT = "mb-1.5 text-meta font-semibold tabular-nums text-faint";
export const PR_GUIDE_TITLE = "mb-1.5 text-item-title font-bold text-fg";
/** Capped at 60ch: an explanation is prose, and prose stops being readable
 *  when it runs the full width of a review canvas. */
export const PR_GUIDE_EXPL = "mb-3 max-w-[60ch] text-label leading-[1.55] text-dim";

/* ── Review comments ─────────────────────────────────────────────────────
 *
 * One row per comment: a marker, the author, the comment clamped to a line,
 * the outbound link, and "Add to session" — which only appears once the row is
 * hovered or the button takes focus, hence the group.
 */
export const PR_COMMENT_ROW =
	"group grid grid-cols-[16px_minmax(78px,auto)_minmax(0,1fr)_auto_auto] items-center gap-2 rounded-control border border-transparent px-1.5 py-[7px] hover:border-line-strong";
export const PR_COMMENT_SELECT =
	"size-[11px] justify-self-center rounded-full border border-faint";
export const PR_COMMENT_META =
	"flex min-w-0 items-center gap-[5px] text-label text-fg";
export const PR_COMMENT_AUTHOR = "truncate font-semibold";
export const PR_COMMENT_BODY =
	"block truncate text-label leading-[1.25] text-faint";
/** The outbound arrow is a glyph, not running text — 16px is its size, not a
 *  step on the type scale. */
export const PR_COMMENT_LINK = "text-[16px] text-faint no-underline hover:text-fg";
/** "Add to session", per row and once for the card. The quiet card-level one
 *  drops the outline and fill; both light up the same way. */
export const PR_COMMENT_ADD =
	"cursor-pointer whitespace-nowrap rounded-md border border-line bg-surface px-[7px] py-[3px] text-meta text-faint opacity-0 transition-[opacity,background-color,color] group-hover:opacity-100 focus-visible:opacity-100 hover:bg-hover hover:text-fg";
export const PR_COMMENTS_ADD_ALL =
	"cursor-pointer whitespace-nowrap rounded-md border border-transparent bg-transparent px-[7px] py-[3px] text-label text-faint hover:bg-hover hover:text-fg";

/* ── PR description ──────────────────────────────────────────────────────
 *
 * The description is renderer output (dangerouslySetInnerHTML), so its
 * headings, lists and edge margins can only be reached from the container —
 * they were `.pr-body-md h1`, `.pr-body-md li` and friends, and they are child
 * variants here for the same reason. `.markdown` still supplies the
 * typography; these are the panel's overrides on top of it, and they keep
 * winning because the utility sheet is linked after the legacy one.
 */
export const PR_BODY_MD =
	"p-0 text-label leading-[1.42] break-words text-faint " +
	"[&_:is(h1,h2,h3)]:text-label [&_:is(h1,h2,h3)]:font-medium [&_:is(h1,h2,h3)]:text-faint [&_:is(h1,h2,h3)]:[margin:0.8em_0_0.15em] " +
	"[&_:is(ul,ol)]:pl-0 [&_:is(ul,ol)]:[list-style-position:inside] [&_li]:[margin:0.15em_0] " +
	"[&>*:first-child]:mt-0 [&>*:last-child]:mb-0";

/** Collapsed by default — the first couple of lines, so the checks sit right
 *  under the title, with a soft fade hinting there is more behind "Show more".
 *  Spelled out rather than composed from a shared fragment: Tailwind scans
 *  source text, so a class assembled from a variable is never generated. */
export const PR_BODY_CLAMPED =
	"max-h-[2.9em] overflow-hidden [mask-image:linear-gradient(to_bottom,#000_55%,transparent)] [-webkit-mask-image:linear-gradient(to_bottom,#000_55%,transparent)]";

export const PR_BODY_TOGGLE = "mt-[3px] text-label font-medium text-dim hover:text-fg";

export const PR_ROW_OUT =
	"inline-flex size-6 shrink-0 items-center justify-center rounded-md text-dim hover:bg-[color-mix(in_srgb,currentColor_14%,transparent)] hover:text-fg";
