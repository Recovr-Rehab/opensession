import React from "react";
import type { Quote } from "../lib/quotes";
import { IconCrosshair, IconX } from "./icons";

interface Props {
	quote: Quote | null;
	onRemove: () => void;
	disabled?: boolean;
}

/** The active transcript selection, shown as lightweight composer context. */
export function QuoteContext({ quote, onRemove, disabled }: Props) {
	if (!quote) return null;
	return (
		<div className="mb-2 flex">
			<div
				title={quote.text}
				className="inline-flex h-9 max-w-full items-center gap-2 rounded-full border border-line bg-surface px-3 text-label font-medium text-fg"
			>
				<IconCrosshair size={17} className="shrink-0 text-faint" />
				<span className="truncate">Selected text</span>
				<button
					type="button"
					onClick={onRemove}
					disabled={disabled}
					aria-label="Remove selected text"
					className="relative -mr-1 flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-full text-faint before:absolute before:inset-0 before:rounded-full enabled:hover:before:bg-hover enabled:hover:text-fg disabled:cursor-default disabled:opacity-50"
				>
					<IconX size={15} />
				</button>
			</div>
		</div>
	);
}
