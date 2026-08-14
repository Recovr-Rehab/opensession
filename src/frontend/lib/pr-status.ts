/**
 * The PR glyph's color language, shared by every surface that paints a pull
 * request's state: purple = merged, faint = closed or draft, red = blocked
 * (conflict / failing checks / changes requested), yellow = checks running,
 * green = open and healthy.
 *
 * Callers normalize their own row shape into `PrStatusInput` — the sidebar's
 * `WsPrStatusMark` still carries its own copy for session-shaped input, since it
 * additionally paints "no PR" rows.
 */
export interface PrStatusInput {
	state?: "OPEN" | "MERGED" | "CLOSED" | null;
	isDraft?: boolean | null;
	/** APPROVED | CHANGES_REQUESTED | REVIEW_REQUIRED | "" */
	reviewDecision?: string | null;
	/** MERGEABLE | CONFLICTING | UNKNOWN — GitHub's async conflict probe. */
	mergeable?: string | null;
	checks?: { failed?: number; pending?: number } | null;
}

/**
 * The wash a surface paints behind the glyph when the state is a chip rather
 * than a bare mark. Same tones as the status strip's band (PR_BAR_BG), so a
 * PR's colour is the same wherever it is filled rather than drawn: purple and
 * yellow have no soft token and mix from their own variable, and the muted
 * states take translucent ink instead of a hue.
 */
const MARK_BG = {
	purple: "bg-[color-mix(in_srgb,var(--purple)_10%,transparent)]",
	muted: "bg-hover",
	red: "bg-red-soft",
	yellow: "bg-[color-mix(in_srgb,var(--yellow)_9%,transparent)]",
	green: "bg-green-soft",
} as const;

export function prStatusMark(pr: PrStatusInput): {
	className: string;
	bgClassName: string;
	label: string;
} {
	if (pr.state === "MERGED")
		return { className: "text-purple", bgClassName: MARK_BG.purple, label: "PR merged" };
	if (pr.state === "CLOSED")
		return { className: "text-faint", bgClassName: MARK_BG.muted, label: "PR closed" };

	const conflicting = pr.mergeable === "CONFLICTING";
	const failed = (pr.checks?.failed || 0) > 0;
	const pending = (pr.checks?.pending || 0) > 0;
	const decision = (pr.reviewDecision || "").toUpperCase();
	const changesRequested = decision === "CHANGES_REQUESTED";

	if (conflicting)
		return { className: "text-red", bgClassName: MARK_BG.red, label: "PR has conflicts" };
	if (changesRequested)
		return { className: "text-red", bgClassName: MARK_BG.red, label: "PR changes requested" };
	if (failed)
		return { className: "text-red", bgClassName: MARK_BG.red, label: "PR checks failing" };
	if (pending)
		return { className: "text-yellow", bgClassName: MARK_BG.yellow, label: "PR checks running" };
	if (pr.isDraft)
		return { className: "text-faint", bgClassName: MARK_BG.muted, label: "Draft PR" };
	if (decision === "APPROVED")
		return { className: "text-green", bgClassName: MARK_BG.green, label: "PR approved" };
	return { className: "text-green", bgClassName: MARK_BG.green, label: "PR open" };
}
