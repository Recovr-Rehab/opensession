import * as React from "react";
import { IconChevronDown } from "../components/icons";
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
 *
 * `caret` is the mirror of `icon` for menu triggers: one trailing chevron,
 * sized off the LABEL rather than the 20px glyph step, with the same 2px
 * padding pull on its own side. Every "label opens a menu" trigger in the app
 * was drawing its own chevron at 14, 16, 17 or 18 — the affordance belongs to
 * the primitive, so the whole family reads as one control.
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

// Trailing caret + label: the same 2px shave, on the caret's side.
const caretTrailPad: Record<Size, string> = {
	xs: "pr-2",
	sm: "pr-2",
	md: "pr-2.5",
	lg: "pr-3.5",
};

// The caret keys off the label, not the 20px icon step: an iconic-pro glyph at
// 14 draws an arrow about as tall as the cap height of a 12px label, which is
// the proportion a dropdown affordance wants. Bigger and it competes with the
// text it qualifies.
const caretSize: Record<Size, number> = { xs: 14, sm: 14, md: 16, lg: 18 };

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
//
// `plate-sheen` (styles/tailwind.css) is the top-down shading that keeps this
// from reading as a flat printed rectangle. It is a white-then-black overlay,
// so it costs the variant nothing per palette and survives the ink accent at
// both ends of the light/dark range.
const INK =
	"bg-accent border-transparent text-on-accent plate-sheen smooth-shadow-xs hover:bg-accent-hover";

const variants: Record<Variant, string> = {
	// The raised control look of the newest chrome (viewer Share button).
	// Paper in light (`bg-button`), graphite in dark: the hairline and the cast
	// shadow are what say "raised", so the fill does not have to — see the
	// --button-surface note in base.css.
	default:
		"bg-button border-line text-dim smooth-shadow-xs hover:text-fg hover:border-line-strong",
	// One plate, two names. `primary` is the one to reach for — it carries 46
	// call sites to `ink`'s 2, and now that the accent *is* ink the older name
	// no longer describes anything the newer one doesn't. `ink` stays so its
	// two callers keep working.
	primary: INK,
	ink: INK,
	// No plate at all until you reach for it. A ghost is the right weight for a
	// control that is *reporting state* as much as inviting a press — a filter
	// that says "In all workspaces" is mostly a label — so the row stays quiet
	// and the wash arrives on hover. `data-popup-open` is Base UI's: when the
	// ghost is a menu trigger it has to stay lit while its own menu is open, or
	// the thing you just clicked disappears out from under the popup.
	ghost:
		"border-transparent text-dim hover:bg-hover hover:text-fg data-[popup-open]:bg-hover data-[popup-open]:text-fg",
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
	destructive:
		"bg-red border-transparent text-white plate-sheen smooth-shadow-xs hover:brightness-110",
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
	/** Trailing dropdown chevron, for a button that opens a menu. Inherits the
	 * button's own color at low strength: a fixed grey caret reads as a dead
	 * spot next to a red or green label. */
	caret?: boolean;
};

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
	function Button(
		{ variant = "default", size = "md", icon, caret, className, children, ...rest },
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
					caret && hasLabel && caretTrailPad[size],
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
				{caret && (
					<IconChevronDown
						className="shrink-0 opacity-55"
						size={caretSize[size]}
					/>
				)}
			</button>
		);
	},
);
