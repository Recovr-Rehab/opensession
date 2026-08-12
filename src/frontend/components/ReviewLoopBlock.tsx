import React, { useState } from "react";
import { IconChevronDown, IconCheck } from "./icons";
import { PulseDot } from "../ui/status";
import { cn } from "../ui/cn";

export interface ReviewLoopOutcome {
	prNumber: number;
	title: string;
	confidence?: number;
	checksPassed?: number;
}

/**
 * A review handoff and the work it triggered, folded into one line — and, when
 * the loop has settled, the result it reached.
 *
 * The outcome lives inside this section rather than after the transcript: it is
 * what this loop concluded, so it hangs off the same rail the loop's work does.
 * That rail is drawn whenever there is anything below the header, which keeps
 * a closed loop and its verdict visibly one object.
 */
export function ReviewLoopBlock({
	prNumber,
	rounds,
	live,
	outcome,
	children,
}: {
	prNumber: number | null;
	rounds: number;
	live: boolean;
	/** The settled result. Absent while the loop is still fixing feedback. */
	outcome?: ReviewLoopOutcome;
	children: React.ReactNode;
}) {
	const [open, setOpen] = useState(false);
	const title = prNumber ? `Review loop · PR #${prNumber}` : "Review loop";
	const detail = live
		? "Fixing review feedback"
		: `${rounds} ${rounds === 1 ? "round" : "rounds"} completed`;

	return (
		<section className="mx-auto mb-4 w-full max-w-[var(--session-col)]" aria-label={title}>
			<button
				type="button"
				aria-expanded={open}
				onClick={() => setOpen((value) => !value)}
				className="-mx-2 flex min-h-10 w-[calc(100%+16px)] min-w-0 items-center gap-2 rounded-control border-0 bg-transparent px-3 py-2 text-left font-sans text-[14px] leading-5 text-dim transition-colors hover:bg-hover/40 hover:text-fg active:scale-[0.96]"
			>
				<span
					className={cn(
						"grid size-5 flex-none place-items-center text-faint transition-transform duration-150",
						!open && "-rotate-90",
					)}
				>
					<IconChevronDown size={20} />
				</span>
				<span className="shrink-0 font-medium text-fg">{title}</span>
				<span className="min-w-0 truncate text-label text-faint">{detail}</span>
				{live && <PulseDot className="ml-auto" />}
			</button>
			{(open || outcome) && (
				<div className="mt-1 border-l border-line pl-3">
					{open && children}
					{outcome && <ReviewOutcome outcome={outcome} open={open} />}
				</div>
			)}
		</section>
	);
}

/**
 * What the loop settled on. A quiet panel rather than a sentence: the state is
 * the headline, and the numbers that back it read as meta beside it — the same
 * shape the turn fold and the PR rows use for a result plus its evidence. The
 * PR number is already on the header above, so it is not repeated here.
 */
function ReviewOutcome({ outcome, open }: { outcome: ReviewLoopOutcome; open: boolean }) {
	const facts = [
		typeof outcome.confidence === "number" ? `Review ${outcome.confidence}/5` : null,
		outcome.checksPassed ? `${outcome.checksPassed} checks passed` : null,
	]
		.filter(Boolean)
		.join(" · ");
	return (
		<div
			className={cn(
				"flex w-fit max-w-full flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-line bg-surface px-3 py-2",
				// Open, the verdict follows the loop's own work and needs the gap
				// that separates it from the last tool row.
				open && "mt-2",
			)}
			aria-label="Review outcome"
		>
			<span className="grid size-5 flex-none place-items-center rounded-full bg-green-soft text-green">
				<IconCheck size={14} />
			</span>
			<span className="text-[14px] font-medium leading-5 text-fg">Ready to merge</span>
			{facts && <span className="min-w-0 text-label leading-4 text-faint">{facts}</span>}
		</div>
	);
}
