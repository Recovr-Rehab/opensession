import React from "react";
import { motion } from "motion/react";
import { cn } from "../ui/cn";
import { duration, ease } from "../ui/motion";
import { IconX } from "./icons";

/**
 * The row of context that sits directly above the composer's field: a small
 * pill naming something attached to the next send, with an ✕ that detaches it.
 *
 * Two things live here — the transcript selection ("Selected text") and note
 * mode ("Team note") — and they are the same object as far as a reader is
 * concerned: *this send is modified, and here is how to undo that*. So they
 * share one shape rather than each inventing a marker. Anything else that
 * qualifies belongs here too; a mode that cannot be turned off does not,
 * because the ✕ would be a lie.
 */
export function ComposerContextChip({
	icon,
	label,
	title,
	tone = "neutral",
	onRemove,
	removeLabel,
	disabled,
}: {
	/** Leading glyph, sized by the caller (15px is the house size here). */
	icon: React.ReactNode;
	label: string;
	/** Hover text — the long version of whatever `label` compresses. */
	title?: string;
	/** `note` tints the pill, because it sits on a surface that is already
	 *  tinted: a neutral chip on the yellow writing surface reads as a hole in
	 *  it rather than as a label on it. */
	tone?: "neutral" | "note";
	onRemove: () => void;
	/** Accessible name for the ✕ — "Remove selected text", "Leave note mode". */
	removeLabel: string;
	disabled?: boolean;
}) {
	return (
		// Two boxes, because the chip is what changes the composer's height and
		// the composer no longer animates its own size (see the note on the box
		// in Composer.tsx). The outer one collapses its height, so the composer
		// grows and shrinks with the chip on every frame rather than snapping
		// once the ✕ has already faded the chip out; `overflow-hidden` both clips
		// the collapse and keeps the inner margin inside the measured height. The
		// inner one carries the chip's own arrival.
		<motion.div
			initial={{ height: 0, opacity: 0 }}
			animate={{ height: "auto", opacity: 1 }}
			exit={{ height: 0, opacity: 0 }}
			transition={{ type: "tween", duration: duration.base, ease }}
			className="overflow-hidden"
		>
			<motion.div
				initial={{ y: 2, scale: 0.98 }}
				animate={{ y: 0, scale: 1 }}
				transition={{ type: "tween", duration: duration.micro, ease }}
				className="mb-1 flex origin-left"
			>
				<div
					title={title}
					className={cn(
						"inline-flex h-7 max-w-full items-center gap-1 rounded-full border px-2 text-label font-medium",
						tone === "note"
							? "border-[color-mix(in_srgb,var(--yellow-tint)_45%,transparent)] bg-[color-mix(in_srgb,var(--yellow-tint)_18%,transparent)] text-yellow"
							: "border-line/60 bg-surface text-fg",
					)}
				>
					<span
						className={cn(
							"inline-flex shrink-0 translate-y-px items-center",
							tone === "note" ? "text-yellow" : "text-faint opacity-60",
						)}
					>
						{icon}
					</span>
					<span className="truncate">{label}</span>
					<button
						type="button"
						onClick={onRemove}
						disabled={disabled}
						aria-label={removeLabel}
						className={cn(
							// `before:-inset-2` grows the hit area past the 20px box without
							// growing the pill around it.
							"relative -mr-1 flex size-5 shrink-0 cursor-pointer items-center justify-center before:absolute before:-inset-2 enabled:active:scale-[0.96] enabled:transition-[color,transform] disabled:cursor-default disabled:opacity-50",
							tone === "note"
								? "text-yellow/60 enabled:hover:text-yellow"
								: "text-faint enabled:hover:text-fg",
						)}
					>
						<IconX
							size={20}
							className="translate-y-px scale-[0.8] [&_path]:stroke-2"
						/>
					</button>
				</div>
			</motion.div>
		</motion.div>
	);
}
