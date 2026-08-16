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

/** Matches the Desk's starter pills exactly: a grey shape you can skip, not a
 *  control asking to be pressed. No border, and a fill below the panel rather
 *  than above it, so a row you may never take stays quiet. `rounded-full` is
 *  the Desk pill's own corner, kept so the two suggestion rows read as one
 *  thing rather than as two similar ideas. */
const chip =
	"w-full whitespace-nowrap rounded-full bg-hover px-3 py-1.5 text-label " +
	"font-medium text-dim transition-[background,color] hover:bg-active hover:text-fg " +
	"focus-visible:bg-active focus-visible:text-fg";

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
				// above the composer costs the transcript real height, and these are
				// optional.
				"mb-2 flex gap-1.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
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
					className="shrink-0"
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
