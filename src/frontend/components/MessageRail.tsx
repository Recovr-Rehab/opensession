import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { SentMessage } from "../lib/sent-messages";
import { RAIL_GUTTER, RAIL_W, SCROLLBAR_RESERVE } from "../lib/message-rail";
import { relativeTime } from "../lib/api";
import { IconGitCommit, IconPencil, IconPullRequest } from "./icons";
import { Popover } from "../ui/popover";
import { cn } from "../ui/cn";

/**
 * Your own messages, as a rail of ticks down the right edge of the transcript.
 * One tick per message, newest at the bottom. Running the pointer down the rail
 * previews them one at a time, and clicking jumps to the one under the pointer.
 *
 * Deliberately an index of what YOU said, not a map of the document. A turn
 * here runs from one line to several thousand, so a proportional map would
 * draw verbosity rather than structure, and what a person scrolling back is
 * looking for is the question they asked, which the answer is attached to
 * anyway. Indexing only the messages also keeps the rail short enough to sit
 * in the gutter: a few ticks around the middle, not a second scrollbar.
 *
 * The rail is one hit target rather than N. At 60 messages a tick is a couple
 * of pixels tall, too small to hover, so pointer Y maps to the nearest index
 * and the ticks stay pure decoration. That is also why the ticks fan out as a
 * LENS around the pointer rather than lighting up one by one: the reader is
 * scrubbing a continuous strip, and the taper shows where in it they are.
 *
 * The preview is one card, not a list of every message. A list asks the reader
 * to find their place in a second column of text before they can act; a card
 * anchored to the tick under the pointer answers the only question being asked
 * ("what is here?") in the place they are already looking.
 *
 * It is a shortcut, not the only way to reach anything, so it stays out of the
 * way: hidden on touch and at phone widths, and hidden while the transcript
 * fits on one screen. It stays keyboard operable, because a control that only
 * answers to hover is not a control.
 */

/** Below this there is nothing to navigate. */
const MIN_MESSAGES = 2;
/**
 * Tick sizes. A resting tick is short and pale, so the rail reads as texture
 * in the gutter rather than as a second scrollbar. Pointing at it raises the
 * tick under the pointer to full size and ink, and its neighbours part way, so
 * the target is legible at a 2px pitch without anything ever moving.
 *
 * Each tick is LAID OUT at its largest and scaled down from its right edge, so
 * every size here is a transform: no layout on a rail of sixty ticks, and the
 * right edge stays put while the left one travels.
 */
const TICK_MAX_W = 20;
const TICK_MAX_H = 3;
const TICK_REST_W = 8;
const TICK_REST_H = 2;
const TICK_REST_INK = 0.22;
/** The message the reader is parked on: a touch longer, full ink at rest and
 *  a step back from it while the lens is up. */
const TICK_CURRENT_W = 12;
const TICK_HERE_INK = 0.5;
/**
 * The lens, as each tick's share of the growth by its distance from the
 * pointer. It falls off fast and then trails, which is what reads as a curve
 * rather than a wedge; past the end of it a tick is simply at rest.
 */
const LENS = [1, 0.62, 0.38, 0.22, 0.1];
/** Per-tick delay away from the pointer, so the rail wakes as a ripple rather
 *  than a slab. Capped, or the far end of a long rail lags visibly behind. */
const STAGGER_MS = 14;
const STAGGER_MAX = 6;
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

function OutcomeIcon({ kind }: { kind: NonNullable<SentMessage["outcome"]>["kind"] }) {
	if (kind === "pr") return <IconPullRequest size={20} />;
	if (kind === "commit") return <IconGitCommit size={20} />;
	return <IconPencil size={20} />;
}

export function MessageRail({ messages, containerRef, leaveLatest }: Props) {
	const railRef = useRef<HTMLButtonElement>(null);
	const [open, setOpen] = useState(false);
	/** The tick being pointed at (or arrowed to): what a jump goes to. */
	const [active, setActive] = useState(0);
	/** The message the reader is currently below. */
	const [current, setCurrent] = useState(0);
	/** Pointing at the rail, or on it from the keyboard: the state the ticks
	 *  grow in. Held here rather than left to `group-hover`, because the lens
	 *  is measured from `active`, which only React knows. */
	const [hovered, setHovered] = useState(false);
	const [keyboard, setKeyboard] = useState(false);
	/** True for the length of the wake-up ripple, and only then. */
	const [entering, setEntering] = useState(false);
	const [box, setBox] = useState<RailBox | null>(null);
	const [scrollable, setScrollable] = useState(false);

	const count = messages.length;
	const enabled = count >= MIN_MESSAGES;
	/** The rail has the reader's attention: pointer on it, keyboard on it, or
	 *  the card still up while the pointer leaves. */
	const hot = hovered || keyboard || open;

	// The effects below outlive any one transcript frame, and a streaming
	// session rebuilds `messages` on every append, so they read the list
	// through a ref rather than re-subscribing to scroll on every token.
	const latest = useRef(messages);
	useEffect(() => {
		latest.current = messages;
	});

	// The ripple runs on arrival and never again: while the pointer scrubs, a
	// per-tick delay would leave the lens trailing the pointer it sits under.
	useEffect(() => {
		if (!entering) return;
		const timer = window.setTimeout(
			() => setEntering(false),
			STAGGER_MAX * STAGGER_MS + 60,
		);
		return () => window.clearTimeout(timer);
	}, [entering]);

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

	// The card hangs off the tick under the pointer, not off the rail, so it
	// tracks the scrub. A fresh object per position is what re-registers it
	// with the positioner; a stable function would be memoized and never move.
	const tickAnchor = useMemo(
		() => ({
			getBoundingClientRect: () => {
				const rail = railRef.current?.getBoundingClientRect();
				const right = rail?.right ?? 0;
				const top = (rail?.top ?? 0) + tickY(active) - TICK_MAX_H / 2;
				return {
					x: right - TICK_MAX_W,
					y: top,
					left: right - TICK_MAX_W,
					right,
					top,
					bottom: top + TICK_MAX_H,
					width: TICK_MAX_W,
					height: TICK_MAX_H,
				};
			},
		}),
		// `tickY` is this render's, and reads nothing but `pitch`.
		[active, pitch],
	);

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

	const shown = messages[Math.min(active, count - 1)];

	return (
		<Popover.Root open={open} onOpenChange={setOpen}>
			<Popover.Trigger
				ref={railRef}
				openOnHover
				delay={220}
				closeDelay={140}
				aria-label="Jump to a message"
				className={cn(
					"absolute top-1/2 z-[4] hidden -translate-y-1/2 cursor-pointer",
					"rounded-md border-0 bg-transparent p-0 focus-ring",
					// Both conditions on one stacked variant, so neither can
					// out-order the other. It matches the gutter the transcript
					// reserves (lib/message-rail.ts).
					"desktop:[@media(hover:hover)]:block",
				)}
				style={{ right: box.inset, width: RAIL_W, height: boxH }}
				onPointerEnter={(event) => {
					if (event.pointerType === "touch") return;
					// Name the tick in the same event that wakes the rail, so the
					// ripple starts from where the pointer landed rather than from
					// whichever tick was last pointed at.
					setActive(indexAt(event.clientY));
					setHovered(true);
					setEntering(true);
				}}
				onPointerLeave={() => setHovered(false)}
				onPointerMove={(event) => {
					if (event.pointerType === "touch") return;
					setActive(indexAt(event.clientY));
				}}
				onFocus={(event) => {
					// Only a keyboard arrival resets the target. On a click the
					// pointer has already named the tick it wants, and focus lands
					// between that and the click.
					if (!event.currentTarget.matches(":focus-visible")) return;
					setActive(current);
					setKeyboard(true);
					setEntering(true);
				}}
				onBlur={() => {
					// Tabbing away from a card you opened with the keyboard takes
					// it with you. Only then: a click also blurs the rail, and
					// that must leave the card up.
					if (keyboard) setOpen(false);
					setKeyboard(false);
				}}
				onKeyDown={onKeyDown}
				onClick={(event) => {
					// A click on the rail is a jump, not a dismissal. Base UI's
					// own handler would toggle the card shut on the same click,
					// and hover would then reopen it a moment later.
					event.preventBaseUIHandler();
					jump(indexAt(event.clientY));
				}}
			>
				{messages.map((message, index) => {
					// Distance from the pointer decides everything about a tick,
					// with its resting size as the floor — so the message the
					// reader is parked on stays visible through the lens.
					const lift = hot ? (LENS[Math.abs(index - active)] ?? 0) : 0;
					const here = index === current;
					const width = Math.max(
						here ? TICK_CURRENT_W : TICK_REST_W,
						TICK_REST_W + (TICK_MAX_W - TICK_REST_W) * lift,
					);
					const height = Math.max(
						here ? TICK_MAX_H : TICK_REST_H,
						TICK_REST_H + (TICK_MAX_H - TICK_REST_H) * lift,
					);
					return (
						<span
							key={message.id}
							aria-hidden
							className={cn(
								"absolute right-0 block origin-right rounded-[999px] bg-fg",
								"transition-[transform,opacity] duration-200 ease-[var(--ease)]",
								"motion-reduce:transition-none",
							)}
							style={{
								top: tickY(index) - TICK_MAX_H / 2,
								width: TICK_MAX_W,
								height: TICK_MAX_H,
								transform: `scale(${width / TICK_MAX_W},${height / TICK_MAX_H})`,
								opacity: Math.max(
									// Where you are stays legible under the lens, but
									// steps back while it is up: two ticks at full ink
									// read as two peaks, and only one of them is the
									// one a click would take.
									here ? (hot ? TICK_HERE_INK : 1) : TICK_REST_INK,
									TICK_REST_INK + (1 - TICK_REST_INK) * lift,
								),
								transitionDelay: entering
									? `${Math.min(Math.abs(index - active), STAGGER_MAX) * STAGGER_MS}ms`
									: "0ms",
							}}
						/>
					);
				})}
				{/* A scrubber has nothing to announce until someone arrives on the
				    keyboard, and then it has to announce every step. */}
				{keyboard && shown && (
					<span aria-live="polite" className="sr-only">
						{`Message ${active + 1} of ${count}: ${shown.preview}`}
					</span>
				)}
			</Popover.Trigger>

			{shown && (
				<Popover.Popup
					side="left"
					align="center"
					sideOffset={10}
					anchor={tickAnchor}
					// The card answers a question, it does not take one: every
					// target is on the rail, so the pointer never has to reach it
					// and the transcript underneath stays selectable.
					className="pointer-events-none w-[320px] p-4"
				>
					<p className="line-clamp-2 text-body font-semibold leading-snug text-fg">
						{shown.preview}
					</p>
					{shown.reply && (
						<p className="mt-2 line-clamp-3 text-label leading-normal text-dim">
							{shown.reply}
						</p>
					)}
					<div className="mt-3 flex items-center gap-3 text-label text-faint">
						{shown.outcome && (
							<span className="inline-flex min-w-0 items-center gap-1.5 text-dim">
								<OutcomeIcon kind={shown.outcome.kind} />
								<span className="truncate">{shown.outcome.label}</span>
							</span>
						)}
						<span className="ml-auto shrink-0">
							{shown.sender ? `${shown.sender} · ` : ""}
							{relativeTime(shown.timestamp)}
						</span>
					</div>
				</Popover.Popup>
			)}
		</Popover.Root>
	);
}
