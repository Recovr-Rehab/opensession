import React, { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import type { TranscriptLandmark } from "../../shared/transcript-landmarks";
import { popupTransition } from "../ui/motion";
import { requestTurnExpand } from "../lib/turn-expand";
import { cn } from "../ui/cn";

/**
 * The transcript's turn index, as a rail of ticks down the right edge.
 *
 * Deliberately NOT a scaled map of the document: turns here run from one line
 * to several thousand, so a proportional rail would be a picture of verbosity
 * — one exploration turn swallowing the rail while ten short exchanges
 * collapse into a smudge — and every lazily-loaded history page would rescale
 * it under the reader. Evenly-spaced ticks are a table of contents instead:
 * one tick per landmark, stable the moment the count is known.
 *
 * The rail is one hit target rather than N: at 300 landmarks a tick is ~2px,
 * far too small to hover, so pointer Y maps to the nearest index. That keeps
 * it usable at any density and means the ticks are pure decoration.
 *
 * It's a shortcut, not the only way to reach anything (the transcript is right
 * there), so it hides on touch and narrow widths — but it stays keyboard
 * operable, because a control that only answers to hover is not a control.
 */

/** Fewer landmarks than this and there is nothing worth navigating. */
const MIN_LANDMARKS = 4;
/** Width of the rail's hit strip. */
const RAIL_W = 20;
/** Ideal gap between ticks; compressed when the session is long. */
const PITCH = 9;
/** Breathing room above and below the tick stack. */
const RAIL_PAD = 24;
/** Where a jumped-to block parks below the viewport's top edge. */
const TOP_GAP = 20;
/** Assumed card height until it has been measured, for edge clamping. */
const CARD_H_FALLBACK = 104;

interface Props {
	landmarks: TranscriptLandmark[];
	/** Generated titles by landmark id; falls back to the derived label. */
	titles: Record<string, string>;
	/** The transcript's scroll container. */
	containerRef: React.RefObject<HTMLDivElement | null>;
	/** Moving into history is intent — tell the scroll hook to stop following. */
	leaveLatest: () => void;
	/** Jumping to the newest landmark means "catch me up", so resume following. */
	scrollToLatest: (behavior?: ScrollBehavior) => void;
}

function kindLabel(kind: TranscriptLandmark["kind"]): string {
	return kind === "prompt"
		? "Prompt"
		: kind === "answer"
			? "Reply"
			: kind === "step"
				? "Step"
				: "Worked";
}

export const TranscriptMinimap = React.memo(function TranscriptMinimap({
	landmarks,
	titles,
	containerRef,
	leaveLatest,
	scrollToLatest,
}: Props) {
	const railRef = useRef<HTMLDivElement>(null);
	const cardRef = useRef<HTMLDivElement>(null);
	const cardHeightRef = useRef(CARD_H_FALLBACK);

	const [railH, setRailH] = useState(0);
	const [scrollbarW, setScrollbarW] = useState(0);
	const [active, setActive] = useState<number | null>(null);
	const [current, setCurrent] = useState(0);
	const [keyboard, setKeyboard] = useState(false);

	const enabled = landmarks.length >= MIN_LANDMARKS;

	// Sit inboard of the native scrollbar rather than on top of it: an overlay
	// covering the scrollbar swallows its drags, and a scrollbar drag is one of
	// the gestures the scroll hook reads as "the reader took over".
	useEffect(() => {
		const el = containerRef.current;
		if (!el || !enabled) return;
		const measure = () => setScrollbarW(el.offsetWidth - el.clientWidth);
		measure();
		const ro = new ResizeObserver(measure);
		ro.observe(el);
		return () => ro.disconnect();
	}, [containerRef, enabled]);

	useEffect(() => {
		const el = railRef.current;
		if (!el || !enabled) return;
		const ro = new ResizeObserver(([entry]) => {
			if (entry) setRailH(entry.contentRect.height);
		});
		ro.observe(el);
		setRailH(el.getBoundingClientRect().height);
		return () => ro.disconnect();
	}, [enabled]);

	/* -- geometry ---------------------------------------------------- */

	const available = Math.max(0, railH - RAIL_PAD * 2);
	const pitch =
		landmarks.length > 1
			? Math.min(PITCH, available / (landmarks.length - 1))
			: 0;
	const stackH = pitch * Math.max(0, landmarks.length - 1);
	const top0 = Math.max(RAIL_PAD, (railH - stackH) / 2);
	const tickY = (index: number) => top0 + index * pitch;

	const indexAt = (clientY: number): number => {
		const el = railRef.current;
		if (!el || landmarks.length === 0) return 0;
		const y = clientY - el.getBoundingClientRect().top;
		if (pitch <= 0) return 0;
		return Math.max(
			0,
			Math.min(landmarks.length - 1, Math.round((y - top0) / pitch)),
		);
	};

	/* -- which landmark is the reader looking at ---------------------- */

	// Tracked here rather than in the transcript's own scroll handler: that one
	// is the hot path the scroll-FPS counter watches, and this is a decoration
	// that can afford to be late. Throttled, and it only ever sets state when
	// the index actually changes.
	useEffect(() => {
		const el = containerRef.current;
		if (!el || !enabled) return;
		const order = new Map(landmarks.map((l, i) => [l.id, i]));
		let timer: number | null = null;

		const compute = () => {
			timer = null;
			const edge = el.getBoundingClientRect().top + TOP_GAP + 4;
			let index = 0;
			// Document order, so we can stop at the first block below the edge.
			for (const node of el.querySelectorAll<HTMLElement>("[data-eid]")) {
				const at = order.get(node.dataset.eid ?? "");
				if (at === undefined) continue;
				if (node.getBoundingClientRect().top <= edge) index = at;
				else break;
			}
			setCurrent((prev) => (prev === index ? prev : index));
		};

		const onScroll = () => {
			if (timer !== null) return;
			timer = window.setTimeout(compute, 100);
		};

		compute();
		el.addEventListener("scroll", onScroll, { passive: true });
		return () => {
			el.removeEventListener("scroll", onScroll);
			if (timer !== null) window.clearTimeout(timer);
		};
	}, [containerRef, enabled, landmarks]);

	/* -- jumping ------------------------------------------------------ */

	const jump = (index: number) => {
		const el = containerRef.current;
		const landmark = landmarks[index];
		if (!el || !landmark) return;

		// The newest landmark is the live edge — going there means "catch me
		// up", so hand it to the hook that knows how to resume following.
		if (index === landmarks.length - 1) {
			scrollToLatest("auto");
			return;
		}
		// Everything else is a move into history. Disengage following FIRST so
		// the scroll events we are about to cause can't be mistaken for the
		// reader drifting back to the edge.
		leaveLatest();

		// A step lives inside a fold that is closed by default, so it isn't in
		// the DOM yet. Ask its fold to open; until it does, the fold's own row
		// is the destination, which is where the reader wants to end up anyway.
		if (landmark.turnId) requestTurnExpand(landmark.turnId);

		// Instant, never smooth: an animated scroll across hundreds of
		// virtualized blocks mounts and unmounts them mid-flight and the
		// destination moves out from under the animation.
		const settle = () => {
			// Re-query every pass: the block may have been a measured
			// placeholder a moment ago, a closed fold before that.
			const target =
				el.querySelector<HTMLElement>(`[data-eid="${CSS.escape(landmark.id)}"]`) ??
				(landmark.turnId
					? el.querySelector<HTMLElement>(
							`[data-eid="${CSS.escape(landmark.turnId)}"]`,
						)
					: null);
			if (!target) return;
			const delta =
				target.getBoundingClientRect().top -
				el.getBoundingClientRect().top -
				TOP_GAP;
			if (Math.abs(delta) > 2) el.scrollTop += delta;
		};
		settle();
		// Landing swaps estimated placeholder heights for measured ones above
		// the target, which drifts it; two bounded correction passes settle it.
		requestAnimationFrame(() => {
			settle();
			requestAnimationFrame(settle);
		});
	};

	/* -- keyboard ----------------------------------------------------- */

	const onKeyDown = (e: React.KeyboardEvent) => {
		const at = active ?? current;
		if (e.key === "ArrowDown" || e.key === "ArrowRight") {
			e.preventDefault();
			setKeyboard(true);
			setActive(Math.min(landmarks.length - 1, at + 1));
		} else if (e.key === "ArrowUp" || e.key === "ArrowLeft") {
			e.preventDefault();
			setKeyboard(true);
			setActive(Math.max(0, at - 1));
		} else if (e.key === "Home") {
			e.preventDefault();
			setKeyboard(true);
			setActive(0);
		} else if (e.key === "End") {
			e.preventDefault();
			setKeyboard(true);
			setActive(landmarks.length - 1);
		} else if (e.key === "Enter" || e.key === " ") {
			e.preventDefault();
			jump(at);
		} else if (e.key === "Escape") {
			setActive(null);
			railRef.current?.blur();
		}
	};

	if (!enabled) return null;

	const shown = active ?? null;
	const landmark = shown === null ? null : landmarks[shown];
	// Until a generated title lands, the title is just the head of the preview
	// — so drop that head rather than saying the same sentence twice.
	const cardTitle = landmark ? titles[landmark.id] || landmark.label : "";
	const cardBody = (() => {
		if (!landmark) return "";
		const head = cardTitle.replace(/…$/, "");
		return head && landmark.preview.startsWith(head)
			? landmark.preview.slice(head.length).replace(/^[\s.:;,·…—–-]+/, "")
			: landmark.preview;
	})();
	const cardAnchor = shown === null ? 0 : tickY(shown);
	const half = cardHeightRef.current / 2;
	const cardY = Math.max(
		half + 8,
		Math.min(railH - half - 8, cardAnchor),
	);

	return (
		<div
			// Hidden where it can't be used: a hover rail is meaningless on touch,
			// and at phone widths the gutter it needs isn't there.
			className="pointer-events-none absolute inset-y-0 z-[3] hidden md:block [@media(hover:none)]:md:hidden"
			style={{ right: scrollbarW, width: RAIL_W }}
		>
			<div
				ref={railRef}
				role="listbox"
				tabIndex={0}
				aria-label="Jump to a point in the conversation"
				aria-activedescendant={
					shown === null ? undefined : `minimap-tick-${landmarks[shown].id}`
				}
				className="pointer-events-auto group/rail relative h-full w-full cursor-pointer outline-none"
				onPointerMove={(e) => {
					if (e.pointerType === "touch") return;
					setKeyboard(false);
					setActive(indexAt(e.clientY));
				}}
				onPointerLeave={() => {
					if (!keyboard) setActive(null);
				}}
				onPointerDown={(e) => {
					// Claim the gesture so it can't read as a transcript drag.
					e.preventDefault();
					jump(indexAt(e.clientY));
				}}
				onFocus={() => {
					setKeyboard(true);
					setActive((prev) => prev ?? current);
				}}
				onBlur={() => {
					setKeyboard(false);
					setActive(null);
				}}
				onKeyDown={onKeyDown}
			>
				{landmarks.map((l, i) => {
					const isCurrent = i === current;
					const isActive = i === shown;
					// Width is "how much happened here": prompts are the spine, a
					// long work fold outweighs a one-line reply.
					const width =
						(l.kind === "prompt"
							? 12
							: l.kind === "answer"
								? 8
								: l.kind === "work"
									? 6
									: 4) +
						Math.round(l.weight * 4) +
						(isActive ? 4 : 0);
					return (
						<div
							key={l.id}
							id={`minimap-tick-${l.id}`}
							role="option"
							aria-selected={isActive}
							aria-label={titles[l.id] || l.label}
							className={cn(
								"absolute right-1 h-[2px] rounded-full transition-[width,background-color,opacity] duration-150",
								l.kind === "prompt"
									? "bg-accent"
									: l.kind === "answer"
										? "bg-dim"
										: "bg-faint",
								isActive || isCurrent
									? "opacity-100"
									: "opacity-45 group-hover/rail:opacity-80 group-focus/rail:opacity-80",
							)}
							style={{ top: tickY(i) - 1, width }}
						/>
					);
				})}

				{/* Where the reader is, so the rail answers "where am I" even
				    before it is touched. Kept to a whisper: it sits behind the
				    ticks permanently, and anything stronger reads as an alert. */}
				<div
					className="absolute right-0.5 h-[2px] w-[15px] rounded-full bg-accent/15 transition-[top] duration-150"
					style={{ top: tickY(current) - 1 }}
					aria-hidden
				/>
			</div>

			<AnimatePresence>
				{landmark && (
					<motion.div
						ref={(node: HTMLDivElement | null) => {
							cardRef.current = node;
							if (node) cardHeightRef.current = node.offsetHeight;
						}}
						key="card"
						initial={{ opacity: 0, x: 4 }}
						animate={{ opacity: 1, x: 0 }}
						exit={{ opacity: 0, x: 4, transition: { duration: 0.1 } }}
						transition={popupTransition}
						className="pointer-events-none absolute right-[calc(100%+6px)] w-[290px] -translate-y-1/2 rounded-lg border border-line bg-panel px-3 py-2.5 shadow-[0_6px_20px_rgba(0,0,0,0.22)]"
						style={{ top: cardY }}
					>
						<div className="flex items-baseline gap-2">
							<span className="min-w-0 flex-1 truncate text-label font-semibold text-fg">
								{cardTitle}
							</span>
							<span className="flex-shrink-0 text-meta text-faint">
								{kindLabel(landmark.kind)}
								{landmark.meta ? ` · ${landmark.meta}` : ""}
							</span>
						</div>
						{cardBody && (
							<p className="mt-1 line-clamp-3 text-meta leading-[1.45] text-dim">
								{cardBody}
							</p>
						)}
					</motion.div>
				)}
			</AnimatePresence>
		</div>
	);
});
