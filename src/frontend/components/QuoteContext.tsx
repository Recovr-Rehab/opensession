import React from "react";
import { motion } from "motion/react";
import type { Quote } from "../lib/quotes";
import { duration, ease } from "../ui/motion";
import { IconCrosshair, IconX } from "./icons";

interface Props {
	quote: Quote;
	onRemove: () => void;
	disabled?: boolean;
}

/** The active transcript selection, shown as lightweight composer context. */
export function QuoteContext({ quote, onRemove, disabled }: Props) {
	return (
		<motion.div
			initial={{ opacity: 0, transform: "translateY(2px) scale(0.98)" }}
			animate={{ opacity: 1, transform: "translateY(0) scale(1)" }}
			exit={{ opacity: 0, transform: "translateY(1px) scale(0.98)" }}
			transition={{
				type: "tween",
				duration: duration.micro,
				ease,
			}}
			className="mb-1.5 flex origin-left"
		>
			<div
				title={quote.text}
				className="inline-flex h-8 max-w-full items-center gap-1.5 rounded-full border border-line bg-surface px-2.5 text-meta font-medium text-fg"
			>
				<IconCrosshair size={15} className="shrink-0 text-faint" />
				<span className="truncate">Selected text</span>
				<button
					type="button"
					onClick={onRemove}
					disabled={disabled}
					aria-label="Remove selected text"
					className="relative -mr-1 flex size-5 shrink-0 cursor-pointer items-center justify-center rounded-full text-faint before:absolute before:-inset-2 before:rounded-full enabled:hover:before:bg-hover enabled:hover:text-fg enabled:active:scale-[0.96] enabled:transition-transform disabled:cursor-default disabled:opacity-50"
				>
					<IconX size={14} />
				</button>
			</div>
		</motion.div>
	);
}
