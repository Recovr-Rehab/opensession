import React, { useCallback, useEffect, useId, useRef, useState } from "react";
import type { SentMessage } from "../lib/sent-messages";
import { RAIL_GUTTER, RAIL_W, SCROLLBAR_RESERVE } from "../lib/message-rail";
import { Popover } from "../ui/popover";
import { cn } from "../ui/cn";

/**
 * Your own messages, as a rail of ticks down the right edge of the transcript.
 * One tick per message, newest at the bottom. Hovering the rail previews them
 * as a list, and clicking a tick or a row scrolls that message to the top.
 *
 * Deliberately an index of what YOU said, not a map of the document. A turn
 * here runs from one line to several thousand, so a proportional map would
 * draw verbosity rather than structure, and what a person scrolling back is
 * looking for is the question they asked, which the answer is attached to
 * anyway. Indexing only the messages also keeps the rail short enough to sit
 * in the gutter: a few ticks around the middle, not a second scrollbar.
 *
 * The rail is one hit target rather than N. At 60 messages a tick is a few
 * pixels tall, too small to hover, so pointer Y maps to the nearest index and
 * the ticks stay pure decoration.
 *
 * It is a shortcut, not the only way to reach anything, so it stays out of the
 * way: hidden on touch and at phone widths, and hidden while the transcript
 * fits on one screen. It stays keyboard operable, because a control that only
 * answers to hover is not a control.
 */

/** Below this there is nothing to navigate. */
const MIN_MESSAGES = 2;
/** Tick length. */
const TICK_W = 15;
/** Ideal gap between ticks, compressed when the session is long. */
const PITCH = 10;
/** Grab room above the first tick and below the last. */
const STACK_PAD = 10;
/** Room the stack leaves at the top and bottom of the transcript. */
const RAIL_MARGIN = 32;
/** Where a jumped-to message parks below the transcript's top edge. */
const TOP_GAP = 20;
/** A transcript within this much of fitting on one screen has nowhere to jump
 *  to. The same slack the scroll hook counts as "at the live edge". */
const STICK_SLACK = 90;
/** Correction passes after a jump, for placeholders that measure on the way. */
const SETTLE_FRAMES = 8;

interface Props {
	messages: SentMessage[];
	/** The transcript's scroll container. */
	containerRef: React.RefObject<HTMLDivElement | null>;
	/** Moving into history is intent: tell the scroll hook to stop following. */
	leaveLatest: () => void;
}

/** Where the rail can sit, or null when the gutter is too narrow for it. */
interface RailBox {
	/** Distance from the container's right edge. */
	inset: number;
	/** The container's height, which the tick pitch is fitted to. */
	height: number;
}

export function MessageRail({ messages, containerRef, leaveLatest }: Props) {
	const railRef = useRef<HTMLButtonElement>(null);
	const listRef = useRef<HTMLDivElement>(null);
	const listId = useId();
	const [open, setOpen] = useState(false);
	/** The tick being pointed at (or arrowed to): what a jump goes to. */
	const [active, setActive] = useState(0);
	/** The message the reader is currently below. */
	const [current, setCurrent] = useState(0);
	const [box, setBox] = useState<RailBox | null>(null);
	const [scrollable, setScrollable] = useState(false);

	const count = messages.length;
	const enabled = count >= MIN_MESSAGES;

	// The effects below outlive any one transcript frame, and a streaming
	// session rebuilds `messages` on every append, so they read the list
	// through a ref rather than re-subscribing to scroll on every token.
	const latest = useRef(messages);
	useEffect(() => {
		latest.current = messages;
	});

	/* -- where the rail can sit ---------------------------------------- */

	const measure = useCallback(() => {
		const el = containerRef.current;
		if (!el) return;
		const rect = el.getBoundingClientRect();
		// A classic scrollbar takes its width out of the box; an overlay one
		// takes it out of nothing and paints over the padding instead. Both are
		// answered the same way, by keeping the reserve clear of the measured
		// width, so the rail lands in the same place on both platforms and a
		// Linux verification browser renders what a Mac does.
		const scrollbar = el.offsetWidth - el.clientWidth;
		// Measure the rendered reading column rather than computing it from
		// --session-col: rows carry `.msg`, and a measured edge is already
		// right under the workspace peek's translate and any future change to
		// the column. The transcript reserves this gutter (lib/message-rail.ts),
		// so the check is a backstop against a layout that stops doing so.
		const row = el.querySelector<HTMLElement>(".msg");
		const gutter = row
			? rect.right - scrollbar - row.getBoundingClientRect().right
			: 0;
		const next =
			gutter >= RAIL_GUTTER
				? { inset: scrollbar + SCROLLBAR_RESERVE, height: rect.height }
				: null;
		setBox((prev) =>
			prev && next && prev.inset === next.inset && prev.height === next.height
				? prev
				: next,
		);
		setScrollable(el.scrollHeight > el.clientHeight + STICK_SLACK);
	}, [containerRef]);

	// After every render, because both answers depend on laid-out content: the
	// transcript's first rows land a commit or two after the rail mounts, and a
	// session becomes scrollable as its reply streams in. Both reads are cheap
	// and set state only when the answer changes, so this settles immediately.
	useEffect(measure);

	// And on container resize, which changes the gutter without re-rendering
	// this component: a sidebar drag, the workspace panel opening, the window.
	useEffect(() => {
		const el = containerRef.current;
		if (!el || !enabled) return;
		const observer = new ResizeObserver(measure);
		observer.observe(el);
		return () => observer.disconnect();
	}, [containerRef, enabled, measure]);

	/* -- geometry ------------------------------------------------------ */

	const railH = box?.height ?? 0;
	const available = Math.max(0, railH - RAIL_MARGIN * 2);
	const pitch = count > 1 ? Math.min(PITCH, available / (count - 1)) : 0;
	const tickY = (index: number) => STACK_PAD + index * pitch;
	const boxH = pitch * Math.max(0, count - 1) + STACK_PAD * 2;

	const indexAt = (clientY: number): number => {
		const el = railRef.current;
		if (!el || pitch <= 0) return 0;
		const y = clientY - el.getBoundingClientRect().top - STACK_PAD;
		return Math.max(0, Math.min(count - 1, Math.round(y / pitch)));
	};

	/* -- which message the reader is on -------------------------------- */

	const trackCurrent = useCallback(() => {
		const el = containerRef.current;
		if (!el) return;
		const order = new Map(latest.current.map((m, i) => [m.id, i]));
		const selector = latest.current
			.map((m) => `[data-eid="${CSS.escape(m.id)}"]`)
			.join(",");
		if (!selector) return;
		const edge = el.getBoundingClientRect().top + TOP_GAP + 4;
		let index = 0;
		// Document order, so we can stop at the first message below the edge.
		for (const node of el.querySelectorAll<HTMLElement>(selector)) {
			if (node.getBoundingClientRect().top > edge) break;
			index = order.get(node.dataset.eid ?? "") ?? index;
		}
		setCurrent((prev) => (prev === index ? prev : index));
	}, [containerRef]);

	// Tracked here rather than in the transcript's own scroll handler: that one
	// is the hot path the scroll-FPS counter watches, and this is a decoration
	// that can afford to be late. `count` re-runs it when a history page
	// prepends messages, which renumbers every index under the reader.
	useEffect(() => {
		const el = containerRef.current;
		if (!el || !enabled) return;
		let timer: number | null = null;
		const onScroll = () => {
			if (timer !== null) return;
			timer = window.setTimeout(() => {
				timer = null;
				trackCurrent();
			}, 100);
		};
		trackCurrent();
		el.addEventListener("scroll", onScroll, { passive: true });
		return () => {
			el.removeEventListener("scroll", onScroll);
			if (timer !== null) window.clearTimeout(timer);
		};
	}, [containerRef, enabled, count, trackCurrent]);

	/* -- the list follows the rail ------------------------------------- */

	useEffect(() => {
		if (!open) return;
		listRef.current?.children[active]?.scrollIntoView({ block: "nearest" });
	}, [open, active]);

	/* -- jumping ------------------------------------------------------- */

	const jump = (index: number) => {
		const el = containerRef.current;
		const message = latest.current[index];
		if (!el || !message) return;
		// Disengage following FIRST, so the scroll we are about to cause cannot
		// be mistaken for the reader drifting back to the live edge.
		leaveLatest();

		// Instant, never smooth: an animated scroll across hundreds of
		// virtualized blocks mounts and unmounts them mid-flight, and the
		// destination moves out from under the animation.
		const settle = () => {
			// Re-query every pass: the block may have been a measured
			// placeholder a moment ago.
			const target = el.querySelector<HTMLElement>(
				`[data-eid="${CSS.escape(message.id)}"]`,
			);
			if (!target) return false;
			const delta =
				target.getBoundingClientRect().top -
				el.getBoundingClientRect().top -
				TOP_GAP;
			if (Math.abs(delta) <= 2) return true;
			el.scrollTop += delta;
			return false;
		};
		// Landing swaps estimated placeholder heights for measured ones above
		// the target, which drifts it, and each remount takes a frame to land.
		// Correct until two passes agree, or give up rather than chase forever.
		let frames = 0;
		let settled = 0;
		const correct = () => {
			settled = settle() ? settled + 1 : 0;
			if (settled >= 2 || ++frames >= SETTLE_FRAMES) return;
			requestAnimationFrame(correct);
		};
		correct();
	};

	const onKeyDown = (event: React.KeyboardEvent) => {
		const step = (to: number) => {
			event.preventDefault();
			setOpen(true);
			setActive(Math.max(0, Math.min(count - 1, to)));
		};
		if (event.key === "ArrowDown" || event.key === "ArrowRight") step(active + 1);
		else if (event.key === "ArrowUp" || event.key === "ArrowLeft") step(active - 1);
		else if (event.key === "Home") step(0);
		else if (event.key === "End") step(count - 1);
		else if (event.key === "Escape") setOpen(false);
		else if (event.key === "Enter" || event.key === " ") {
			// Handled here rather than left to the button's native click, which
			// would also reach the trigger's own open/close toggle.
			event.preventDefault();
			jump(active);
		}
	};

	if (!enabled || !box || !scrollable) return null;

	return (
		<Popover.Root open={open} onOpenChange={setOpen}>
			<Popover.Trigger
				ref={railRef}
				openOnHover
				delay={220}
				closeDelay={140}
				aria-label="Jump to a message"
				aria-controls={listId}
				// The list is portalled, so it is nobody's descendant. Owning it
				// is what makes the active option point at something.
				{...(open ? { "aria-owns": listId } : {})}
				aria-activedescendant={open ? `${listId}-${active}` : undefined}
				className={cn(
					"absolute top-1/2 z-[4] hidden -translate-y-1/2 cursor-pointer",
					"rounded-md border-0 bg-transparent p-0 focus-ring",
					// Both conditions on one stacked variant, so neither can
					// out-order the other. It matches the gutter the transcript
					// reserves (lib/message-rail.ts).
					"group desktop:[@media(hover:hover)]:block",
				)}
				style={{ right: box.inset, width: RAIL_W, height: boxH }}
				onPointerMove={(event) => {
					if (event.pointerType === "touch") return;
					setActive(indexAt(event.clientY));
				}}
				onFocus={(event) => {
					// Only a keyboard arrival resets the target. On a click the
					// pointer has already named the tick it wants, and focus lands
					// between that and the click.
					if (event.currentTarget.matches(":focus-visible")) setActive(current);
				}}
				onKeyDown={onKeyDown}
				onClick={(event) => {
					// A click on the rail is a jump, not a dismissal. Base UI's
					// own handler would toggle the list shut on the same click,
					// and hover would then reopen it a moment later.
					event.preventBaseUIHandler();
					jump(indexAt(event.clientY));
				}}
			>
				{messages.map((message, index) => {
					const lit = index === current || (open && index === active);
					const height = lit ? 3 : 2;
					return (
						<span
							key={message.id}
							aria-hidden
							className={cn(
								"absolute right-0 block rounded-[999px] transition-colors duration-150",
								lit ? "bg-fg" : "bg-line-strong group-hover:bg-faint",
							)}
							style={{
								top: tickY(index) - height / 2,
								width: TICK_W,
								height,
							}}
						/>
					);
				})}
			</Popover.Trigger>

			<Popover.Popup side="left" align="center" sideOffset={8} className="w-[320px]">
				<div
					ref={listRef}
					id={listId}
					role="listbox"
					aria-label="Messages you sent"
					className="max-h-[min(60vh,380px)] overflow-y-auto overscroll-contain p-1.5"
				>
					{messages.map((message, index) => (
						<button
							key={message.id}
							id={`${listId}-${index}`}
							type="button"
							role="option"
							aria-selected={index === active}
							// The rail is the one tab stop: a hover list of sixty
							// messages must not be sixty of them.
							tabIndex={-1}
							onClick={() => jump(index)}
							onPointerEnter={() => setActive(index)}
							className={cn(
								"flex w-full cursor-pointer items-center gap-2 rounded-md border-0 bg-transparent",
								"px-2 py-1.5 text-left text-control-label",
								index === current ? "text-fg" : "text-dim",
								index === active && "bg-hover",
							)}
						>
							{message.sender && (
								<span className="shrink-0 text-meta font-semibold text-faint">
									{message.sender}
								</span>
							)}
							<span className="truncate">{message.preview}</span>
						</button>
					))}
				</div>
			</Popover.Popup>
		</Popover.Root>
	);
}
