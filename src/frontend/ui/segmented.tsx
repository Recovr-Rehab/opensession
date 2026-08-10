import * as React from "react";
import { cn } from "./cn";

/**
 * Segmented control — a short, exclusive choice shown in full: "My archived /
 * Everyone", "All / Auto-archived / Manual".
 *
 * The shape already existed in three hand-copied class strings on one page,
 * which is how the app ends up with two controls that mean the same thing and
 * look 1px apart. It also arrived with `role="group"` and no pressed state, so
 * the choice was visible but unspoken: `aria-pressed` is what makes each
 * option announce whether it is the one in effect.
 *
 * The track is `--bg-hover`, one of the few places that absolute surface is
 * correct — it is a real surface here (a well the options sit in), not a hover
 * wash. The option in effect is a raised plate (`bg-active`); the rest are
 * plain text that only warms on hover, so the control reads as one object with
 * a current value rather than a row of buttons.
 *
 * Reach for it only for two or three short options that all deserve to be
 * visible. A longer list (every repo on the instance) belongs in a `Select` or
 * a menu — spelled out, it wraps to a second line and outweighs the content it
 * is filtering.
 */
export function Segmented({
	label,
	className,
	...props
}: React.ComponentPropsWithoutRef<"div"> & { label: string }) {
	return (
		<div
			role="group"
			aria-label={label}
			className={cn(
				"inline-flex gap-0.5 rounded-md bg-[var(--bg-hover)] p-0.5",
				className,
			)}
			{...props}
		/>
	);
}

export function SegmentedOption({
	selected,
	className,
	...props
}: React.ComponentPropsWithoutRef<"button"> & { selected: boolean }) {
	return (
		<button
			type="button"
			aria-pressed={selected}
			className={cn(
				"cursor-pointer rounded-sm border-none bg-transparent px-2.5 py-1 text-label font-medium",
				"whitespace-nowrap transition-colors duration-[var(--dur-micro)] ease-[var(--ease)]",
				"phone:px-[13px] phone:py-[9px] phone:text-body",
				selected ? "bg-active text-fg" : "text-faint hover:text-dim",
				className,
			)}
			{...props}
		/>
	);
}
