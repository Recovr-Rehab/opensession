import type { UnifiedSession } from "./types";

/**
 * Derivation for the PRs a session knows only as refs — everything the status
 * strip shows for a sibling PR without fetching its detail.
 *
 * A ref comes enriched from the server's bulk PR cache (state, draft, review
 * decision, check counts) but has no local git and no per-check list, so these
 * helpers deliberately mirror `deriveHeadline`'s precedence minus every git
 * case: whatever the primary strip would say about the same facts, a sibling
 * row says too. Kept out of the component so the mapping is testable on its
 * own — the strip is the only thing that renders it, not the only thing that
 * has to be right about it.
 */

/** One of `session.prs` — a PR the session spans. */
export type SessionPrRef = NonNullable<UnifiedSession["prs"]>[number];

export type PrTone = "green" | "purple" | "red" | "yellow" | "muted";

/** Worst-first, so a series folds down to the tone that needs attention. */
const TONE_RANK: Record<PrTone, number> = {
	red: 0,
	yellow: 1,
	green: 2,
	purple: 3,
	muted: 4,
};

/**
 * Tone for a PR the strip only knows through the session's refs: no detail
 * fetch, no local git (a sibling PR usually lives in another repo, or on a
 * branch this worktree isn't on). deriveHeadline minus every git case.
 */
export function refTone(ref: SessionPrRef): PrTone {
	if (ref.state === "MERGED") return "purple";
	if (ref.state === "CLOSED") return "muted";
	if (
		(ref.checks?.failed ?? 0) > 0 ||
		ref.reviewDecision === "CHANGES_REQUESTED"
	)
		return "red";
	if ((ref.checks?.pending ?? 0) > 0) return "yellow";
	if (ref.isDraft) return "muted";
	return "green";
}

/**
 * The state a ref-only PR can honestly claim. Same precedence as `refTone`, so
 * the words and the colour never disagree, and pending checks are counted the
 * way the primary headline counts them rather than collapsing to "Open".
 */
export function refState(ref: SessionPrRef): string {
	if (ref.state === "MERGED") return "Merged";
	if (ref.state === "CLOSED") return "Closed";
	if ((ref.checks?.failed ?? 0) > 0) return "Checks failed";
	if (ref.reviewDecision === "CHANGES_REQUESTED") return "Changes requested";
	const pending = ref.checks?.pending ?? 0;
	if (pending > 0) return `${pending} check${pending === 1 ? "" : "s"} pending`;
	if (ref.isDraft) return "Draft";
	if (ref.reviewDecision === "APPROVED") return "Approved";
	return "Open";
}

/**
 * Chip text. A PR in the session's own repo is just its number; one in another
 * repo carries a short repo hint, because a bare "#72" next to "#5253" gives no
 * clue which repository it belongs to.
 */
export function refChipText(ref: SessionPrRef, primaryRepo?: string): string {
	if (!primaryRepo || ref.repo === primaryRepo) return `#${ref.number}`;
	return `${ref.repo} #${ref.number}`;
}

/** Full sentence for the row's tooltip — the detail the compact row drops. */
export function refLabel(ref: SessionPrRef): string {
	const checks = ref.checks;
	const parts = [`${ref.repo} #${ref.number} (${refState(ref).toLowerCase()})`];
	if (ref.title) parts.push(`— ${ref.title}`);
	if (checks && checks.total > 0)
		parts.push(`· ${checks.passed}/${checks.total} checks passed`);
	return parts.join(" ");
}

/**
 * One headline for a set of refs, used when the session owns no PR on its own
 * branch: the strip has no primary status to show, and a bare count in the
 * neutral tone hides a failing PR sitting right underneath it.
 */
export function summarizePrSeries(
	refs: SessionPrRef[],
): { tone: PrTone; label: string } | null {
	if (refs.length === 0) return null;
	const tone = refs
		.map(refTone)
		.reduce((worst, t) => (TONE_RANK[t] < TONE_RANK[worst] ? t : worst));
	const open = refs.filter(
		(r) => r.state !== "MERGED" && r.state !== "CLOSED",
	).length;
	if (open === 0) {
		const merged = refs.filter((r) => r.state === "MERGED").length;
		return {
			tone,
			label:
				merged === refs.length
					? `All ${refs.length} merged`
					: merged > 0
						? `${merged} of ${refs.length} merged`
						: `All ${refs.length} closed`,
		};
	}
	const total = `${refs.length} PR${refs.length === 1 ? "" : "s"}`;
	return { tone, label: open === refs.length ? total : `${total} · ${open} open` };
}
