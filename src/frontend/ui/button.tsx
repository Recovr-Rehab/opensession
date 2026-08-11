import * as React from "react";
import { cn } from "./cn";

/**
 * Button primitive — the shared optics for text, icon+label, and icon-only
 * buttons. New buttons go through this; legacy `.btn-*` classes in legacy.css
 * migrate here opportunistically when touched (strangler pattern).
 *
 * The icon/spacing rules are ported from tella-fusion's button system
 * (webapp Button.res + ButtonWithIcon.res — the product these iconic-pro
 * glyphs come from):
 *
 *  - icon ↔ label gap is 4px, with 20px iconic glyphs (their `w-5 h-5`
 *    convention; matches our icons.tsx size-20 "inline/meta" step);
 *  - when an icon LEADS a label, pull the icon-side padding in 2px
 *    (Tella: px-3 → pl-2.5) so the pair reads optically balanced against a
 *    text-only button — the glyph's built-in whitespace otherwise makes the
 *    icon side look padded out;
 *  - dim the leading icon relative to the label (Tella: opacity-50 on
 *    neutral weights, a lighter tint on the primary) — the label stays the
 *    dominant read, the icon is support;
 *  - icon-only buttons go square with symmetric padding and the icon
 *    dead-centered, UNdimmed — there the icon *is* the label;
 *  - press feedback is a whole-button scale tick (Tella: active:scale-97).
 */

type Variant =
	| "default"
	| "primary"
	| "ink"
	| "ghost"
	| "success"
	| "danger"
	| "destructive"
	| "warning";
type Size = "xs" | "sm" | "md" | "lg";

const sizes: Record<Size, string> = {
	// Heights bracket the app's existing chrome: 32px matches the viewer
	// header buttons, 26px the chip/inline tier.
	//
	// One radius across every size: `rounded-control`, the corner the rest of
	// the chrome already uses (legacy.css authors it as `calc(10px*var(--rf))`
	// on .btn-viewer-pin / .btn-panel-toggle / .btn-viewer-newsession). The
	// `rounded-xs`/`rounded-sm` this used to ship read visibly squarer than the
	// buttons it sat beside — enough that call sites kept patching it back out
	// by hand. Holding one corner across the scale is also what makes the four
	// sizes read as one family: it goes pill on the short sizes, exactly as the
	// ~26px chrome buttons already do, and stays a soft rect on lg.
	xs: "min-h-6 px-2.5 text-xs rounded-control",
	sm: "min-h-[26px] px-2.5 text-xs rounded-control",
	md: "min-h-8 px-3 text-sm rounded-control",
	lg: "min-h-9 px-4 text-base rounded-control",
};

// Leading icon + label: shave 2px off the icon side (see doc block).
const iconLeadPad: Record<Size, string> = {
	xs: "pl-2",
	sm: "pl-2",
	md: "pl-2.5",
	lg: "pl-3.5",
};

// Icon-only: square hit target, symmetric.
const iconOnlyPad: Record<Size, string> = {
	xs: "w-6 px-0",
	sm: "w-[26px] px-0",
	md: "w-8 px-0",
	lg: "w-9 px-0",
};

// Solid ink: the heaviest weight, for the one dominant action on a surface (a
// page header's CTA, a panel's single call to action). This variant existed
// because the brand accent was red and, at that size, it shouted — ink carried
// the same emphasis without it. The accent is now ink itself, so `primary` and
// `ink` describe the same plate and share one definition.
//
// The label is `text-on-accent` rather than a literal white: on an ink fill,
// white-on-white is what you get in dark mode. And `brightness-110` (what
// `primary` used to hover with) is invisible on a near-white or near-black
// fill, so the hover takes `--accent-hover`, which picks its own direction:
// toward the page while the accent is ink, deeper into the hue once it isn't.
const INK =
	"bg-accent border-transparent text-on-accent shadow-control hover:bg-accent-hover";

const variants: Record<Variant, string> = {
	// The raised control look of the newest chrome (viewer Share button).
	default:
		"bg-control border-line text-dim shadow-control hover:text-fg hover:border-line-strong",
	// One plate, two names. `primary` is the one to reach for — it carries 46
	// call sites to `ink`'s 2, and now that the accent *is* ink the older name
	// no longer describes anything the newer one doesn't. `ink` stays so its
	// two callers keep working.
	primary: INK,
	ink: INK,
	ghost: "border-transparent text-dim hover:bg-hover hover:text-fg",
	// Outline green, mirroring `danger` — the affirmative half of the pair
	// (approve a review, merge, confirm). Green is the second-most reached-for
	// button color in the app after the accent, so it earns a variant rather
	// than a bespoke class each time.
	success: "border-green text-green hover:bg-green-soft",
	// Outline red, like the delete-worktree confirm buttons.
	danger: "border-red text-red hover:bg-red-soft",
	// Solid red plate — the *committed* half of the destructive pair, for the
	// button that actually does the irreversible thing (a modal's confirm, the
	// second click of a two-click close). `danger` proposes, `destructive`
	// commits, so a surface can show both without them reading as the same
	// weight. Shares `primary`'s shape so the two swap cleanly in a footer.
	destructive: "bg-red border-transparent text-white shadow-control hover:brightness-110",
	warning: "border-yellow text-yellow hover:bg-[color-mix(in_srgb,var(--yellow)_12%,transparent)]",
};

// Leading-icon dimming per variant (icon-only stays full strength).
const iconDim: Record<Variant, string> = {
	default: "opacity-60",
	primary: "opacity-80",
	ink: "opacity-80",
	ghost: "opacity-60",
	success: "opacity-80",
	danger: "opacity-80",
	destructive: "opacity-80",
	warning: "opacity-80",
};

export type ButtonProps = React.ComponentPropsWithoutRef<"button"> & {
	variant?: Variant;
	size?: Size;
	/** Leading icon — pass a 20px glyph from components/icons.tsx. Renders an
	 * icon-only square button when there are no children. */
	icon?: React.ReactNode;
};

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
	function Button(
		{ variant = "default", size = "md", icon, className, children, ...rest },
		ref,
	) {
		const hasLabel = children != null && children !== false && children !== "";
		const iconOnly = icon != null && !hasLabel;
		return (
			<button
				type="button"
				ref={ref}
				className={cn(
					"inline-flex items-center justify-center gap-1 border whitespace-nowrap select-none",
					// Text utilities carry different stock line heights even though this
					// button scale pins its own heights. A single tight line box gives
					// labels the same optical centre as fixed-size icons and chevrons.
					"leading-none",
					"font-medium transition-[color,background-color,border-color,filter,scale] active:scale-[0.96]",
					// One keyboard focus treatment for every variant. Without it a
					// Button falls back to the browser's default outline, which
					// differs per engine and sits tight against the corner; the
					// shared utility also carries the forced-colors fallback.
					"focus-ring",
					"disabled:pointer-events-none disabled:opacity-40",
					sizes[size],
					variants[variant],
					icon != null && hasLabel && iconLeadPad[size],
					iconOnly && iconOnlyPad[size],
					className,
				)}
				{...rest}
			>
				{icon != null && (
					<span
						className={cn(
							"inline-flex shrink-0 items-center",
							!iconOnly && iconDim[variant],
						)}
					>
						{icon}
					</span>
				)}
				{children}
			</button>
		);
	},
);
