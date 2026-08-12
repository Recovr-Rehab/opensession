import React, { useState } from "react";
import { IconChevronDown, IconCheck, IconPullRequest, IconX } from "./icons";
import { cn } from "../ui/cn";
import type { ReviewLoopResult } from "../lib/review-loop";

/**
 * A review handoff and the work it triggered, folded into one line, plus the
 * result the loop reached once it settles. Its row follows the same grammar as
 * a tool call: identity on the left, compact detail in the middle, state on the
 * right, and the chevron only takes over the glyph while the row is hovered.
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
		<section className="mx-auto mb-3 w-full max-w-[var(--session-col)]" aria-label="Review loop">
			<button
				type="button"
				aria-expanded={open}
				onClick={() => setOpen((value) => !value)}
				className="group flex w-full min-w-0 cursor-pointer items-baseline gap-2 rounded-control border-0 bg-transparent px-1 py-[3px] text-left font-sans transition-colors hover:bg-hover/40"
			>
				<span className="relative flex size-[22px] flex-none self-center items-center justify-center text-faint">
					<IconPullRequest
						size={20}
						className="transition-opacity duration-150 group-hover:opacity-0"
					/>
					<IconChevronDown
						size={20}
						className={cn(
							"absolute text-dim opacity-0 transition-[opacity,transform] duration-150 group-hover:opacity-100",
							open && "rotate-180",
						)}
					/>
				</span>
				<span className="shrink-0 text-[14px] font-medium leading-5 text-dim transition-colors group-hover:text-fg">
					Review loop
				</span>
				<span
					className={cn(
						"min-w-0 flex-1 truncate text-label leading-4 text-faint",
						status === "passed" && "text-green",
						status === "failed" && "text-red",
					)}
				>
					{[prNumber ? `PR #${prNumber}` : null, detail].filter(Boolean).join(" · ")}
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
			{open && <div className="mt-0.5">{children}</div>}
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
		status === "passed" ? "Passed" : status === "failed" ? "Failed" : null,
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
