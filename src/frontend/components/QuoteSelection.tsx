import React, { useCallback, useEffect, useRef, useState } from "react";
import { newQuote, type Quote } from "../lib/quotes";
import {
	anchorQuoteRange,
	clearQuoteHighlight,
	paintQuoteHighlight,
	recoverQuoteRange,
	type AnchoredRange,
} from "../lib/quote-selection";

interface Props {
	/** The region whose text can be quoted: the transcript scroller. */
	containerRef: React.RefObject<HTMLElement | null>;
	/** The one passage currently riding along with the next message. */
	quote: Quote | null;
	/** Replaces the current context as soon as a selection settles. */
	onQuote: (quote: Quote) => void;
	/** Clears the current context and its persistent highlight. */
	onClear: () => void;
	/** Called after capture so desktop users can type without another click. */
	onCaptured?: () => void;
	/** Read-only viewers (no composer to carry the quote into) pass true. */
	disabled?: boolean;
}

/**
 * Granola-style transcript context: releasing a text selection immediately
 * stages it for the next message and moves focus to the composer. A CSS custom
 * highlight keeps the passage visibly selected after textarea focus replaces
 * the browser's native selection.
 */
export function QuoteSelection({
	containerRef,
	quote,
	onQuote,
	onClear,
	onCaptured,
	disabled,
}: Props) {
	const [highlightName] = useState(
		() => `os1-quoted-selection-${crypto.randomUUID()}`,
	);
	const rangeRef = useRef<{ quoteId: string; anchored: AnchoredRange } | null>(
		null,
	);

	const clearHighlight = useCallback(() => {
		clearQuoteHighlight(highlightName);
		rangeRef.current = null;
	}, [highlightName]);

	const clear = useCallback(() => {
		window.getSelection()?.removeAllRanges();
		clearHighlight();
		onClear();
	}, [clearHighlight, onClear]);

	const capture = useCallback(() => {
		const container = containerRef.current;
		if (!container || disabled) return;
		const selection = window.getSelection();
		const text = selection?.toString().trim() ?? "";
		if (
			!selection ||
			selection.rangeCount === 0 ||
			selection.isCollapsed ||
			text.length < 2
		)
			return;
		const range = selection.getRangeAt(0);
		if (
			!container.contains(range.startContainer) ||
			!container.contains(range.endContainer)
		)
			return;

		const next = newQuote(text);
		const anchored = anchorQuoteRange(range, container);
		rangeRef.current = { quoteId: next.id, anchored };
		paintQuoteHighlight(highlightName, anchored.range);
		onQuote(next);
		onCaptured?.();
	}, [containerRef, disabled, highlightName, onCaptured, onQuote]);

	useEffect(() => {
		if (disabled) return;
		let timer: ReturnType<typeof setTimeout> | undefined;
		const settle = (event: Event) => {
			if (event instanceof MouseEvent && event.button !== 0) return;
			if (event instanceof KeyboardEvent) {
				const active = document.activeElement;
				if (
					event.shiftKey ||
					active instanceof HTMLInputElement ||
					active instanceof HTMLTextAreaElement ||
					(active instanceof HTMLElement && active.isContentEditable)
				)
					return;
			}
			clearTimeout(timer);
			timer = setTimeout(capture, event.type === "touchend" ? 250 : 0);
		};
		document.addEventListener("mouseup", settle);
		document.addEventListener("touchend", settle);
		document.addEventListener("keyup", settle);
		return () => {
			document.removeEventListener("mouseup", settle);
			document.removeEventListener("touchend", settle);
			document.removeEventListener("keyup", settle);
			clearTimeout(timer);
		};
	}, [capture, disabled]);

	useEffect(() => {
		if (!quote || rangeRef.current?.quoteId !== quote.id) clearHighlight();
	}, [quote, clearHighlight]);

	useEffect(() => {
		if (!quote) return;
		const container = containerRef.current;
		if (!container) return;
		let queued = false;
		const repair = () => {
			queued = false;
			const saved = rangeRef.current;
			if (!saved || saved.quoteId !== quote.id) return;
			const { range } = saved.anchored;
			if (
				range.startContainer.isConnected &&
				range.endContainer.isConnected &&
				range.toString().trim() === quote.text
			)
				return;
			const recovered = recoverQuoteRange(saved.anchored, container);
			if (!recovered) return clear();
			saved.anchored.range = recovered;
			paintQuoteHighlight(highlightName, recovered);
		};
		const observer = new MutationObserver(() => {
			if (queued) return;
			queued = true;
			queueMicrotask(repair);
		});
		observer.observe(container, {
			childList: true,
			characterData: true,
			subtree: true,
		});
		return () => observer.disconnect();
	}, [clear, containerRef, highlightName, quote]);

	useEffect(() => {
		if (!quote) return;
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key === "Escape") clear();
		};
		document.addEventListener("keydown", onKeyDown);
		return () => document.removeEventListener("keydown", onKeyDown);
	}, [quote, clear]);

	useEffect(() => clearHighlight, [clearHighlight]);

	return (
		<style>{`::highlight(${highlightName}) { background-color: color-mix(in srgb, var(--accent) 24%, transparent); color: inherit; }`}</style>
	);
}
