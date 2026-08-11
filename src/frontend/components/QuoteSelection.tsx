import React, { useCallback, useEffect, useRef } from "react";
import { newQuote, type Quote } from "../lib/quotes";

interface Props {
	/** The region whose text can be quoted: the transcript scroller. */
	containerRef: React.RefObject<HTMLElement | null>;
	/** The one passage currently riding along with the next message. */
	quote: Quote | null;
	/** Replaces the current context as soon as a selection settles. */
	onQuote: (quote: Quote) => void;
	/** Clears the current context and native selection. */
	onClear: () => void;
	/** Focuses the composer when typing or paste indicates input intent. */
	onInputIntent?: () => HTMLTextAreaElement | null;
	/** Read-only viewers (no composer to carry the quote into) pass true. */
	disabled?: boolean;
}

/**
 * Granola-style transcript context: releasing a text selection immediately
 * stages it for the next message while leaving the browser's native selection
 * intact for copying. Typing or pasting focuses the composer; an ordinary click
 * anywhere clears the ephemeral context.
 */
export function QuoteSelection({
	containerRef,
	quote,
	onQuote,
	onClear,
	onInputIntent,
	disabled,
}: Props) {
	const rangeRef = useRef<Range | null>(null);
	const hadQuoteRef = useRef(false);

	const clear = useCallback(() => {
		window.getSelection()?.removeAllRanges();
		rangeRef.current = null;
		onClear();
	}, [onClear]);

	const capture = useCallback((): boolean => {
		const container = containerRef.current;
		if (!container || disabled) return false;
		const selection = window.getSelection();
		const text = selection?.toString().trim() ?? "";
		if (
			!selection ||
			selection.rangeCount === 0 ||
			selection.isCollapsed ||
			text.length < 2
		)
			return false;
		const range = selection.getRangeAt(0);
		if (
			!container.contains(range.startContainer) ||
			!container.contains(range.endContainer)
		)
			return false;
		const previous = rangeRef.current;
		if (
			previous &&
			previous.startContainer === range.startContainer &&
			previous.startOffset === range.startOffset &&
			previous.endContainer === range.endContainer &&
			previous.endOffset === range.endOffset
		)
			return false;

		rangeRef.current = range.cloneRange();
		onQuote(newQuote(text));
		const active = document.activeElement;
		if (
			active instanceof HTMLInputElement ||
			active instanceof HTMLTextAreaElement
		)
			active.blur();
		return true;
	}, [containerRef, disabled, onQuote]);

	useEffect(() => {
		if (disabled) return;
		let timer: ReturnType<typeof setTimeout> | undefined;
		const settle = (event: Event) => {
			if (event instanceof MouseEvent || event instanceof TouchEvent) {
				if (event instanceof MouseEvent && event.button !== 0) return;
				const container = containerRef.current;
				if (!container || !container.contains(event.target as Node)) return;
				if (event instanceof MouseEvent) {
					capture();
					return;
				}
			}
			if (event instanceof KeyboardEvent && event.key !== "Shift") return;
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
	}, [capture, containerRef, disabled]);

	useEffect(() => {
		if (quote) {
			hadQuoteRef.current = true;
		} else if (hadQuoteRef.current) {
			window.getSelection()?.removeAllRanges();
			rangeRef.current = null;
			hadQuoteRef.current = false;
		}
	}, [quote]);

	useEffect(() => {
		const dismiss = (event: MouseEvent) => {
			if (!quote || event.button !== 0) return;
			const retained = rangeRef.current;
			const selection = window.getSelection();
			if (retained && selection && !selection.isCollapsed && selection.rangeCount) {
				const active = selection.getRangeAt(0);
				if (
					retained.startContainer === active.startContainer &&
					retained.startOffset === active.startOffset &&
					retained.endContainer === active.endContainer &&
					retained.endOffset === active.endOffset
				)
					return;
			}
			clear();
		};
		document.addEventListener("click", dismiss);
		return () => document.removeEventListener("click", dismiss);
	}, [quote, clear]);

	useEffect(
		() => () => {
			if (hadQuoteRef.current) window.getSelection()?.removeAllRanges();
		},
		[],
	);

	useEffect(() => {
		if (!quote) return;
		const isTextEditor = (target: EventTarget | null) =>
			target instanceof HTMLInputElement ||
			target instanceof HTMLTextAreaElement ||
			(target instanceof HTMLElement && target.isContentEditable);
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.defaultPrevented) return;
			if (event.key === "Escape") return clear();
			const target = event.target;
			if (isTextEditor(target)) return;
			const container = containerRef.current;
			if (
				target instanceof Node &&
				target !== document.body &&
				target !== document.documentElement &&
				!container?.contains(target)
			)
				return;
			if (
				target instanceof Element &&
				target.closest(
					"button, a, select, [role='button'], [role='link'], [role='menuitem'], [role='option']",
				)
			)
				return;
			const modifier = event.metaKey || event.ctrlKey;
			if (event.key === "Enter") {
				const textarea = onInputIntent?.();
				if (!textarea) return;
				event.preventDefault();
				textarea.dispatchEvent(
					new KeyboardEvent("keydown", {
						bubbles: true,
						cancelable: true,
						key: event.key,
						code: event.code,
						metaKey: event.metaKey,
						ctrlKey: event.ctrlKey,
						shiftKey: event.shiftKey,
					}),
				);
				return;
			}
			const startsInput =
				(!modifier && !event.altKey && event.key.length === 1) ||
				(modifier && !event.altKey && event.key.toLowerCase() === "v") ||
				(!modifier && !event.altKey && event.shiftKey && event.key === "Insert");
			if (startsInput) onInputIntent?.();
		};
		const onPaste = (event: ClipboardEvent) => {
			if (event.defaultPrevented || isTextEditor(event.target)) return;
			const text = event.clipboardData?.getData("text/plain") ?? "";
			if (!text) return;
			const textarea = onInputIntent?.();
			if (!textarea) return;
			event.preventDefault();
			if (document.execCommand("insertText", false, text)) return;
			textarea.setRangeText(
				text,
				textarea.selectionStart,
				textarea.selectionEnd,
				"end",
			);
			textarea.dispatchEvent(
				new InputEvent("input", {
					bubbles: true,
					data: text,
					inputType: "insertFromPaste",
				}),
			);
		};
		document.addEventListener("keydown", onKeyDown);
		document.addEventListener("paste", onPaste);
		return () => {
			document.removeEventListener("keydown", onKeyDown);
			document.removeEventListener("paste", onPaste);
		};
	}, [quote, clear, containerRef, onInputIntent]);

	return null;
}
