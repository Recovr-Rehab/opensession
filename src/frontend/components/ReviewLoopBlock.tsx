import React, { useState } from "react";
import { IconChevronDown, IconCheck, IconPullRequest, IconX } from "./icons";
import { cn } from "../ui/cn";
import type { ReviewLoopResult } from "../lib/review-loop";

/**
 * A review handoff and the work it triggered, folded into one line, plus the
 * result the loop reached once it settles.
 *
 * The same bounded surface holds both states. The header owns the review
 * identity and verdict; the open body contains only the work, so nested
 * transcript chrome cannot compete with the parent hierarchy.
 */
export function ReviewLoopBlock({
	prNumber,
	rounds,
	live,
	result,
	children,
}: {
	prNumber: number | null;
	rounds: number;
	live: boolean;
	result?: ReviewLoopResult;
	children: React.ReactNode;
}) {
	const [open, setOpen] = useState(false);
	const status = live ? "pending" : result?.status;
	const detail = reviewLoopDetail(status, rounds, result);
	const stateLabel = live
		? "Review in progress"
		: status === "pending"
			? "Review pending"
			: status === "passed"
				? "Review passed"
				: status === "failed"
					? "Review failed"
					: undefined;

	return (
		<section
			className="mx-auto mb-3 w-full max-w-[var(--session-col)] overflow-hidden rounded-lg border border-line bg-surface shadow-[0_1px_2px_rgba(0,0,0,0.025)] [corner-shape:var(--cs)]"
			aria-label="Review loop"
		>
			<button
				type="button"
				aria-expanded={open}
				onClick={() => setOpen((value) => !value)}
				className={cn(
					"group flex min-h-10 w-full min-w-0 cursor-pointer items-center gap-2 border-0 bg-panel/60 px-3.5 text-left font-sans transition-colors hover:bg-hover/40",
					open && "border-b border-line",
				)}
			>
				<span className="relative flex size-[22px] flex-none self-center items-center justify-center text-faint">
					<IconPullRequest
						size={20}
						className={cn(
							"transition-opacity duration-150 group-hover:opacity-0",
							open && "opacity-0",
						)}
					/>
					<IconChevronDown
						size={20}
						className={cn(
							"absolute text-dim opacity-0 transition-[opacity,transform] duration-150 group-hover:opacity-100",
							open && "rotate-180 opacity-100",
						)}
					/>
				</span>
				<span className="shrink-0 text-[14px] font-medium leading-5 text-fg">
					Review loop
				</span>
				{prNumber && (
					<span className="shrink-0 text-label leading-4 text-dim">PR #{prNumber}</span>
				)}
				<span className="min-w-0 flex-1 truncate text-label leading-4 text-faint">
					{detail}
				</span>
				{stateLabel && (
					<span
						className={cn(
							"flex size-5 flex-none self-center items-center justify-center",
							status === "passed" && "text-green",
							status === "failed" && "text-red",
						)}
						aria-label={stateLabel}
					>
						{status === "passed" ? (
							<IconCheck size={20} />
						) : status === "failed" ? (
							<IconX size={20} />
						) : (
							<span className="size-[11px] animate-spin rounded-full border border-b-line-strong border-l-line-strong border-r-line-strong border-t-dim" />
						)}
					</span>
				)}
			</button>
			{open && (
				<div className="px-3.5 pb-3 pt-2.5 [&>*:last-child]:mb-0">
					{children}
				</div>
			)}
		</section>
	);
}

function reviewLoopDetail(
	status: ReviewLoopResult["status"] | undefined,
	rounds: number,
	result: ReviewLoopResult | undefined,
): string {
	if (status === "pending") return "Reviewing changes";
	const facts = [
		`${rounds} ${rounds === 1 ? "round" : "rounds"}`,
		typeof result?.confidence === "number" ? `${result.confidence}/5` : null,
		result?.blocking ? `${result.blocking} blocking` : null,
		result?.checksFailed
			? `${result.checksFailed} ${result.checksFailed === 1 ? "check" : "checks"} failed`
			: null,
		result?.checksPassed ? `${result.checksPassed} checks passed` : null,
	];
	return facts.filter(Boolean).join(" · ");
}
