import type { GitDotTone } from "./pr-git-tasks";

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
