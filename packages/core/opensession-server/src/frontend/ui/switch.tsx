import * as React from "react";
import { Switch as BaseSwitch } from "@base-ui/react/switch";
import { cn } from "./cn";

type SwitchSize = "md" | "sm";

/** The track. macOS 26's NSSwitch, measured off a render from the Mac node:
 *  a 54×24pt track with a 2pt inset. A pt is a CSS px here, so these are its
 *  numbers, not a scaled interpretation of them. It is longer and flatter
 *  than the iOS switch (51×31), which is the shape difference you see against
 *  the native app. "sm" is the same switch at 44×20, for dense rows where the
 *  full control would outweigh the row it sits in.
 *
 *  The shape lives in these two strings rather than inside the component
 *  because `SwitchIndicator` below draws the same switch without owning the
 *  press: a switch in a menu row that had drifted from a switch in a settings
 *  row would read as a different control. Both are keyed off `data-checked`,
 *  which Base UI sets on the real thing and the indicator sets by hand. */
const trackClasses = (size: SwitchSize) =>
	cn(
		"relative inline-flex shrink-0 rounded-full bg-active",
		size === "sm" ? "h-5 w-11" : "h-6 w-[54px]",
		// The checked track is the selected app accent, matching native
		// controls, through --accent-control: Black and Honey swap it for
		// a blue in dark mode, where a white or yellow track stops reading
		// as "on". Every other accent resolves straight through.
		"transition-colors duration-[var(--dur-micro)] ease-[var(--ease)] data-[checked]:bg-accent-control",
	);

/** The knob is a 32×20 capsule, not a circle. That wider shape is most of
 *  what reads as the current macOS switch. The small size keeps the 2px inset
 *  and the capsule, at 26×16.
 *
 *  Press feedback changes width instead of scale so the round ends stay round.
 *  A checked knob subtracts the stretch from its translate, which holds its
 *  right edge on the 2px inset. The fallback keeps `SwitchIndicator` valid
 *  without a root that sets the variable. */
const thumbClasses = (size: SwitchSize) =>
	cn(
		"absolute left-0.5 top-0.5 rounded-full bg-white shadow-[0_1px_3px_rgba(0,0,0,0.22),0_0_0_1px_rgba(0,0,0,0.07)] transition-[translate,width,background-color] duration-[var(--dur-micro)] ease-[var(--ease)] data-[checked]:bg-on-accent-control",
		size === "sm"
			? "h-4 w-[calc(26px_+_var(--stretch,0px))] data-[checked]:translate-x-[calc(14px_-_var(--stretch,0px))]"
			: "h-5 w-[calc(32px_+_var(--stretch,0px))] data-[checked]:translate-x-[calc(18px_-_var(--stretch,0px))]",
	);

/** Put `:active` on the root so presses on either the track or thumb inherit
 *  the stretch. Base UI's disabled root can still match `:active`, so disabled
 *  switches reset the variable explicitly. */
const pressClasses = (size: SwitchSize) =>
	cn(
		size === "sm" ? "active:[--stretch:3px]" : "active:[--stretch:4px]",
		"data-[disabled]:active:[--stretch:0px]",
	);

type SwitchProps = Omit<React.ComponentProps<typeof BaseSwitch.Root>, "size"> & {
	className?: string;
	size?: SwitchSize;
};

export function Switch({ className, size = "md", ...props }: SwitchProps) {
	return (
		<BaseSwitch.Root
			className={cn(
				trackClasses(size),
				pressClasses(size),
				"cursor-pointer outline-none",
				"focus-visible:ring-2 focus-visible:ring-accent/50 focus-visible:ring-offset-2 focus-visible:ring-offset-bg",
				"data-[disabled]:cursor-default data-[disabled]:opacity-40",
				className,
			)}
			{...props}
		>
			<BaseSwitch.Thumb className={thumbClasses(size)} />
		</BaseSwitch.Root>
	);
}

/**
 * The switch as a picture of a setting rather than the control for it: for a
 * row that is itself the control, where a real switch would be a button
 * inside a button and would take the press away from the row around it. It
 * holds no focus and answers no pointer, and it is hidden from assistive
 * technology, because the row already says what the setting is and whether it
 * is on.
 */
export function SwitchIndicator({
	on,
	size = "sm",
	className,
}: {
	/** Whether the setting is on. */
	on: boolean;
	size?: SwitchSize;
	className?: string;
}) {
	// Written as an attribute rather than a class so both halves take the same
	// `data-[checked]:` utilities the real control does.
	const checked = on ? "" : undefined;
	return (
		<span
			aria-hidden
			data-checked={checked}
			className={cn(trackClasses(size), "pointer-events-none", className)}
		>
			<span data-checked={checked} className={thumbClasses(size)} />
		</span>
	);
}
