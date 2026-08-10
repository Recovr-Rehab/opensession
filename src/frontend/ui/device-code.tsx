import { IconCopy } from "../components/icons";
import { cn } from "./cn";
import { CopyCheck, useCopy } from "./copy";
import { Tooltip } from "./tooltip";

/**
 * A one-time device code (GitHub, ChatGPT) that someone has to enter on
 * another site — rendered as the button it always wanted to be. Retyping
 * `4A56-C7AE` by hand is most of what a device flow costs the person doing it,
 * and the code was previously plain text on three separate surfaces, so the
 * copy affordance lives here rather than being re-invented per flow.
 *
 * Wide tracking is what keeps an ambiguous code readable (0/O, 1/I), but
 * letter-spacing also pads the glyph *after* the last character; the negative
 * margin pulls that phantom column back off the copy glyph so the pair isn't
 * lopsided.
 */
export function DeviceCode({
	code,
	className,
	/** Accessible/tooltip verb — override only if "code" is the wrong noun. */
	label = "Copy code",
}: {
	code: string;
	className?: string;
	label?: string;
}) {
	const { copied, copy } = useCopy();
	return (
		<Tooltip label={copied ? "Copied" : label}>
			<button
				type="button"
				aria-label={`${label} ${code}`}
				onClick={() => copy(code, { toast: "Code copied" })}
				className={cn(
					"group relative inline-flex items-center justify-center rounded-control border border-line bg-control px-9 py-1",
					"font-mono text-item-title font-bold text-fg shadow-control",
					"transition-[background-color,border-color,scale] active:scale-[0.98]",
					"hover:border-line-strong hover:bg-hover focus-ring",
					className,
				)}
			>
				<span className="tracking-[0.14em] -mr-[0.14em]">{code}</span>
				<CopyCheck
					copied={copied}
					size={20}
					className="absolute right-2.5"
					idle={
						<IconCopy
							size={20}
							className="opacity-45 transition-opacity group-hover:opacity-80"
						/>
					}
				/>
			</button>
		</Tooltip>
	);
}
