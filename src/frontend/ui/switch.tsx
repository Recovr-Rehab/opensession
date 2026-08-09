import * as React from "react";
import { Switch as BaseSwitch } from "@base-ui/react/switch";
import { cn } from "./cn";

type SwitchProps = React.ComponentProps<typeof BaseSwitch.Root> & {
	className?: string;
};

export function Switch({ className, ...props }: SwitchProps) {
	return (
		<BaseSwitch.Root
			className={cn(
				// macOS 26's NSSwitch, measured off a render from the Mac node:
				// a 54×24pt track with a 2pt inset. A pt is a CSS px here, so
				// these are its numbers, not a scaled interpretation of them.
				// It is longer and flatter than the iOS switch (51×31), which
				// is the shape difference you see against the native app.
				"relative inline-flex h-6 w-[54px] shrink-0 cursor-pointer rounded-full bg-active outline-none",
				"transition-colors duration-[var(--dur-micro)] ease-[var(--ease)] data-[checked]:bg-accent",
				"focus-visible:ring-2 focus-visible:ring-accent/50 focus-visible:ring-offset-2 focus-visible:ring-offset-bg",
				"data-[disabled]:cursor-default data-[disabled]:opacity-40",
				className,
			)}
			{...props}
		>
			{/* Two things the current Mac switch does that the old web one
			    didn't. The knob is a 32×20 CAPSULE, not a circle — that wider
			    shape is most of what reads as "the new toggle". And the knob
			    stays light in every state and both appearances: macOS never
			    inverts to a dark knob, it moves the state onto the TRACK. So
			    this keeps a white knob on the checked accent track too, and
			    separates it with the hairline + drop shadow the native control
			    uses rather than by flipping to --on-accent, which in dark mode
			    (where the accent is near-white) read as a negative image. */}
			<BaseSwitch.Thumb className="absolute left-0.5 top-0.5 h-5 w-8 rounded-full bg-white shadow-[0_1px_3px_rgba(0,0,0,0.22),0_0_0_1px_rgba(0,0,0,0.07)] transition-transform duration-[var(--dur-micro)] ease-[var(--ease)] data-[checked]:translate-x-[18px]" />
		</BaseSwitch.Root>
	);
}
