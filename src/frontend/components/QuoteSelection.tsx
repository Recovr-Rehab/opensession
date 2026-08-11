import React, { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { duration, ease } from "../ui/motion";
import { IconQuote } from "./icons";

interface Props {
	/** The region whose text can be quoted — the transcript scroller. */
	containerRef: React.RefObject<HTMLElement | null>;
	/** Receives the selected text when the person takes the action. */
	onQuote: (text: string) => void;
	/** Read-only viewers (no composer to carry the quote into) pass true. */
	disabled?: boolean;
}

interface Anchor {
	text: string;
	/** Viewport coordinates of the pill's anchor point. */
	left: number;
	top: number;
	/** True when the pill hangs below the selection (no room above it). */
	below: boolean;
}

/** Gap between the selection and the pill, and the margin it keeps from the
 *  viewport edges. */
const GAP = 8;
const EDGE = 12;
/** Conservative half-width used to keep the pill inside the viewport before it
 *  has been measured. The pill is a fixed-size control, so this doesn't drift. */
const HALF = 80;

function measure(range: Range, container: HTMLElement): Omit<Anchor, "text"> | null {
	const rects = Array.from(range.getClientRects()).filter((r) => r.width || r.height);
	if (rects.length === 0) return null;
	const first = rects[0]!;
	const last = rects[rects.length - 1]!;
	const bounds = range.getBoundingClientRect();
	const box = container.getBoundingClientRect();
	// Selection scrolled out of the transcript's visible box — drop the pill
	// rather than parking it over the header or the composer.
	if (last.bottom < box.top || first.top > box.bottom) return null;
	// Above the selection by default (it doesn't cover the text you just read);
	// flip below when the first line sits too close to the top of the region.
	const below = first.top - GAP < Math.max(box.top, 0) + 36;
	const center = bounds.left + bounds.width / 2;
	return {
		left: Math.min(Math.max(center, EDGE + HALF), window.innerWidth - EDGE - HALF),
		top: below ? last.bottom + GAP : first.top - GAP,
		below,
	};
}

/**
 * Granola-style quote action: select text anywhere in the transcript and a
 * small pill offers to carry it into the composer, where it becomes a
 * "Selected text" chip that rides along with the next message.
 *
 * Renders nothing until there's a selection inside `containerRef`; the pill is
 * `position: fixed` so it escapes the scroller without needing a portal.
 */
export function QuoteSelection({ containerRef, onQuote, disabled }: Props) {
	const [anchor, setAnchor] = useState<Anchor | null>(null);
	// The live range, kept so the pill can follow the text while the transcript
	// scrolls under it instead of detaching from what it points at.
	const rangeRef = useRef<Range | null>(null);
	const pillRef = useRef<HTMLDivElement>(null);

	const hide = useCallback(() => {
		rangeRef.current = null;
		setAnchor(null);
	}, []);

	const sync = useCallback(() => {
		const container = containerRef.current;
		if (!container || disabled) return hide();
		const sel = window.getSelection();
		const text = sel?.toString().trim() ?? "";
		if (!sel || sel.rangeCount === 0 || sel.isCollapsed || text.length < 2) return hide();
		const range = sel.getRangeAt(0);
		// Only our own region — a selection in the composer, a side panel or the
		// pill itself is none of this component's business.
		if (!container.contains(range.commonAncestorContainer)) return hide();
		const pos = measure(range, container);
		if (!pos) return hide();
		rangeRef.current = range;
		setAnchor({ text, ...pos });
	}, [containerRef, disabled, hide]);

	// Settle on pointer/keyboard release rather than on every `selectionchange`:
	// during a drag the pill would chase the cursor.
	useEffect(() => {
		if (disabled) return;
		let timer: ReturnType<typeof setTimeout> | undefined;
		// Defer — the browser hasn't finalised the selection when the event
		// fires. Touch needs longer: a long-press selection (and its own
		// callout) settles well after `touchend`.
		const settle = (e: Event) => {
			clearTimeout(timer);
			timer = setTimeout(sync, e.type === "touchend" ? 250 : 0);
		};
		const onSelectionChange = () => {
			// Only ever used to retract: a click that collapses the selection
			// should take the pill with it immediately.
			const sel = window.getSelection();
			if (!sel || sel.isCollapsed) hide();
		};
		document.addEventListener("mouseup", settle);
		document.addEventListener("touchend", settle);
		document.addEventListener("keyup", settle);
		document.addEventListener("selectionchange", onSelectionChange);
		return () => {
			document.removeEventListener("mouseup", settle);
			document.removeEventListener("touchend", settle);
			document.removeEventListener("keyup", settle);
			document.removeEventListener("selectionchange", onSelectionChange);
			clearTimeout(timer);
		};
	}, [disabled, sync, hide]);

	// Follow the text while the transcript scrolls (including the live tail
	// pushing content up under a running turn) and on resize.
	// `active` rather than `anchor`: repositioning replaces the anchor object,
	// and keying on it would tear down and re-add these listeners every frame.
	const active = anchor !== null;
	useEffect(() => {
		if (!active) return;
		const container = containerRef.current;
		const reposition = () => {
			const range = rangeRef.current;
			if (!range || !container) return hide();
			const pos = measure(range, container);
			if (!pos) return hide();
			setAnchor((a) => (a ? { ...a, ...pos } : a));
		};
		container?.addEventListener("scroll", reposition, { passive: true });
		window.addEventListener("resize", reposition);
		// The transcript also reflows without either event — the side panel
		// opening, an image or tool block expanding above the selection, a
		// running turn streaming in while the reader sits scrolled up.
		const observer = new ResizeObserver(reposition);
		if (container) observer.observe(container);
		return () => {
			container?.removeEventListener("scroll", reposition);
			window.removeEventListener("resize", reposition);
			observer.disconnect();
		};
	}, [active, containerRef, hide]);

	useEffect(() => {
		if (!anchor) return;
		const onKey = (e: KeyboardEvent) => {
			if (e.key !== "Escape") return;
			// Drop the selection as well: the keyup that follows would otherwise
			// settle on it and summon the pill straight back.
			window.getSelection()?.removeAllRanges();
			hide();
		};
		document.addEventListener("keydown", onKey);
		return () => document.removeEventListener("keydown", onKey);
	}, [anchor, hide]);

	// A viewer that loses its composer (disconnected, no engine) keeps no pill:
	// staging a quote there would be an action with nowhere to go.
	useEffect(() => {
		if (disabled) hide();
	}, [disabled, hide]);

	const take = useCallback(() => {
		if (!anchor || disabled) return;
		onQuote(anchor.text);
		window.getSelection()?.removeAllRanges();
		hide();
	}, [anchor, disabled, onQuote, hide]);

	return (
		<AnimatePresence>
			{anchor && (
				<motion.div
					ref={pillRef}
					// The transcript owns mouse-down for its own selection handling;
					// keep it from clearing the selection out from under the action.
					onMouseDown={(e) => e.preventDefault()}
					initial={{ opacity: 0, scale: 0.94, y: anchor.below ? -4 : 4 }}
					animate={{ opacity: 1, scale: 1, y: 0 }}
					exit={{ opacity: 0, scale: 0.96 }}
					transition={{ duration: duration.micro, ease }}
					style={{
						left: anchor.left,
						top: anchor.top,
						// Above the selection the pill grows upward from its anchor.
						translate: anchor.below ? "-50% 0" : "-50% -100%",
					}}
					className="fixed z-100 rounded-control border border-[color:var(--composer-border)] bg-[var(--composer-surface)] p-1 shadow-[var(--composer-shadow)]"
				>
					<button
						type="button"
						onClick={take}
						className="flex min-h-8 cursor-pointer items-center gap-1.5 rounded-control bg-transparent px-2.5 py-1 text-label text-fg hover:bg-hover"
					>
						<IconQuote size={16} className="text-dim" />
						Add to chat
					</button>
				</motion.div>
			)}
		</AnimatePresence>
	);
}
