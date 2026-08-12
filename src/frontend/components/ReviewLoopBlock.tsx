import React, { useState } from "react";
import { IconChevronDown, IconCheck } from "./icons";
import { cn } from "../ui/cn";

export interface ReviewLoopOutcome {
	prNumber: number;
	title: string;
	confidence?: number;
	checksPassed?: number;
}

export function ReviewLoopBlock({
	prNumber,
	rounds,
	live,
	children,
}: {
	prNumber: number | null;
	rounds: number;
	live: boolean;
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
				{live && (
					<span className="ml-auto size-2 shrink-0 rounded-full bg-yellow animate-pulse" aria-label="In progress" />
				)}
			</button>
			{open && <div className="mt-1 border-l border-line pl-3">{children}</div>}
		</section>
	);
}

/** The settled result is deliberately separate from the last fix turn. */
export function ReviewOutcomeBlock({ outcome }: { outcome: ReviewLoopOutcome }) {
	const review = typeof outcome.confidence === "number" ? `Review ${outcome.confidence}/5` : "Review complete";
	const checks = outcome.checksPassed ? ` · ${outcome.checksPassed} checks passed` : "";
	return (
		<section
			className="mx-auto mb-4 w-full max-w-[var(--session-col)] rounded-lg bg-surface px-4 py-3 shadow-[0_1px_2px_oklch(0_0_0_/_0.06)]"
			aria-label="Session outcome"
		>
			<div className="flex items-center gap-2 text-[14px] font-medium text-fg">
				<span className="grid size-5 place-items-center rounded-full bg-green/15 text-green"><IconCheck size={16} /></span>
				Outcome
			</div>
			<p className="mt-1.5 text-body leading-5 text-dim">
				Completed {outcome.title || "this session"}. PR #{outcome.prNumber} is ready to merge: {review.toLowerCase()}{checks}.
			</p>
		</section>
	);
}
