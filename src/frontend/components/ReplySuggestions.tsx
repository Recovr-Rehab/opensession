import React from "react";
import { motion } from "motion/react";
import type { ReplySuggestion } from "../lib/reply-suggestions";
import { duration, ease } from "../ui/motion";
import { Tooltip } from "../ui/tooltip";
import { cn } from "../ui/cn";

/**
 * Quick-reply chips above the session composer: the two or three replies the
 * finished turn most likely wants, as 1-2 word pills you can pick instead of
 * typing them out. The server generates them (server/reply-suggestions.ts) and
 * only when the turn actually ended on a choice, so most turns show no row.
 *
 * The row floats over the tail of the transcript rather than sitting in flow
 * between it and the composer. In flow it opened a band of empty page every
 * time a turn ended and closed it again the moment you picked a chip, which
 * moved the composer under your hands for something optional. So it lies on
 * the conversation instead, as glass, and the transcript pays for the rows it
 * covers in bottom padding (SUGGESTIONS_CLEARANCE).
 *
 * Picking one FILLS the composer, it never sends. Two reasons, and neither is
 * timidity: the chip is a guess about what you meant, and the full sentence is
 * the thing you are agreeing to, so you should read it before it becomes your
 * message. The Desk's starter pills made the same call for the same reason
 * (lib/desk-suggestions.ts), and this row deliberately wears their shape.
 *
 * The row retires as soon as you pick one. Picking a second chip would leave
 * two contradictory instructions in one draft ("fix both" under "only step
 * 1"), and replacing instead of appending would eat whatever you had typed.
 */

/**
 * A lid, not a wash. The row lies ON the transcript, and at a wash's weight
 * the sentence underneath read straight through the label sitting on it.
 *
 * So it is the material the transcript's other floating pills are already made
 * of (TRANSCRIPT_PILL: "New messages", "Load all"): paper over the popups'
 * blur, which turns whatever it covers into colour and shape rather than
 * somebody else's words, with the hairline and cast shadow that let a white
 * pill be seen on a white page. Two pills 40px apart made of different things
 * read as two ideas, so they are made of one, down to the `rounded-[999px]`
 * squircle. What keeps this row the quieter of the two is its ink: dim at
 * medium weight against the pill's near-black semibold, and no icon.
 *
 * The 28px height is fixed rather than left to the label, because the
 * transcript pads for exactly that (SUGGESTIONS_CLEARANCE) and inherited
 * leading would otherwise decide how much of the answer the row covers.
 */
const chip =
	"relative inline-flex h-7 w-full items-center whitespace-nowrap rounded-[999px] px-3 " +
	"bg-popup-glass [backdrop-filter:var(--popup-blur)] " +
	"[--smooth-ring-color:var(--popup-ring)] smooth-shadow-ring-sm " +
	"text-label font-medium text-dim transition-[color,scale] " +
	"hover:text-fg focus-visible:text-fg active:scale-[0.96] " +
	// The hover wash layers over the lid rather than replacing it, so it paints
	// on a pseudo-element, which needs the pill's corner treatment of its own:
	// base.css grants `corner-shape` by matching `rounded-*` on an ELEMENT, and
	// a pseudo-element matches no selector.
	"before:pointer-events-none before:absolute before:inset-0 before:rounded-[inherit] " +
	"before:[corner-shape:inherit] before:bg-transparent before:transition-colors " +
	"before:content-[''] hover:before:bg-hover focus-visible:before:bg-hover " +
	"focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fg";

interface Props {
	suggestions: ReplySuggestion[];
	/** Hands back the chip's full text for the composer to receive as a draft. */
	onPick: (text: string) => void;
	className?: string;
}

export function ReplySuggestions({ suggestions, onPick, className }: Props) {
	if (!suggestions.length) return null;
	return (
		<div
			className={cn(
				// One row that scrolls sideways rather than wrapping: a second line
				// costs the transcript real height, and these are optional.
				"flex gap-1.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
				// The caller floats this over the transcript, so the row spans the
				// whole column while the chips fill only part of it. Nothing but the
				// chips may take a click: the rest of that band is transcript you
				// should still be able to select and reach.
				"pointer-events-none",
				className,
			)}
		>
			{suggestions.map((s, i) => (
				// The animation rides a wrapper rather than the button itself: the
				// button is Base UI's tooltip trigger, which renders INTO the element
				// it is given, and a motion component there is the one case where its
				// injected props are known to get lost.
				<motion.div
					key={`${s.label}-${i}`}
					className="pointer-events-auto shrink-0"
					// The row arrives seconds after the turn ends, so it fades in from
					// its own size rather than sliding: something appearing above the
					// composer while you are reading should not also move. The small
					// stagger reads as one row settling rather than four arrivals.
					initial={{ opacity: 0, y: 3 }}
					animate={{ opacity: 1, y: 0 }}
					transition={{ duration: duration.base, ease, delay: i * 0.04 }}
				>
					<Tooltip label={s.text} side="top" multiline>
						<button
							type="button"
							className={chip}
							onClick={() => onPick(s.text)}
							// The label is the short form; the sentence it stands for is
							// what lands in the draft, so name it for a screen reader
							// rather than leaving that to the hover tooltip.
							aria-label={s.text}
						>
							{s.label}
						</button>
					</Tooltip>
				</motion.div>
			))}
		</div>
	);
}
