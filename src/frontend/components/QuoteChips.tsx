import React from "react";
import { AnimatePresence, motion } from "motion/react";
import { duration, ease } from "../ui/motion";
import { quotePreview, type Quote } from "../lib/quotes";
import { IconQuote } from "./icons";

interface Props {
	quotes: Quote[];
	onRemove: (id: string) => void;
	disabled?: boolean;
}

/** Staged transcript selections, shown above the draft field as removable
 *  capsules — the composer's lightest attachment, so it stays a pill rather
 *  than joining the file/image cards. */
export function QuoteChips({ quotes, onRemove, disabled }: Props) {
	if (quotes.length === 0) return null;
	return (
		<div className="mb-2 flex flex-wrap gap-1.5">
			<AnimatePresence initial={false}>
				{quotes.map((q) => (
					<motion.span
						key={q.id}
						layout
						initial={{ opacity: 0, scale: 0.94 }}
						animate={{ opacity: 1, scale: 1 }}
						exit={{ opacity: 0, scale: 0.94 }}
						transition={{ duration: duration.micro, ease }}
						title={quotePreview(q.text)}
						className="inline-flex items-center gap-1.5 rounded-[999px] border border-line bg-[var(--bg-hover)] py-1 pr-1.5 pl-2.5 text-label text-fg"
					>
						<IconQuote size={14} className="text-dim" />
						Selected text
						<button
							type="button"
							onClick={() => onRemove(q.id)}
							disabled={disabled}
							title="Remove selection"
							aria-label="Remove selection"
							className="flex size-[18px] cursor-pointer items-center justify-center rounded-[999px] bg-transparent text-[15px] leading-none text-faint enabled:hover:bg-hover enabled:hover:text-fg disabled:cursor-default disabled:opacity-50"
						>
							×
						</button>
					</motion.span>
				))}
			</AnimatePresence>
		</div>
	);
}
