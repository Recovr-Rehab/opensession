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
				// The checked track is the selected app accent, matching native
				// controls. Its knob takes --on-accent so Mono still has internal
				// contrast when the accent becomes white in dark mode.
				"transition-colors duration-[var(--dur-micro)] ease-[var(--ease)] data-[checked]:bg-accent",
				"focus-visible:ring-2 focus-visible:ring-accent/50 focus-visible:ring-offset-2 focus-visible:ring-offset-bg",
				"data-[disabled]:cursor-default data-[disabled]:opacity-40",
				className,
			)}
			{...props}
		>
			{/* The knob is a 32×20 capsule, not a circle — that wider shape is
			    most of what reads as the current macOS switch. */}
			<BaseSwitch.Thumb className="absolute left-0.5 top-0.5 h-5 w-8 rounded-full bg-white shadow-[0_1px_3px_rgba(0,0,0,0.22),0_0_0_1px_rgba(0,0,0,0.07)] transition-[transform,background-color] duration-[var(--dur-micro)] ease-[var(--ease)] data-[checked]:translate-x-[18px] data-[checked]:bg-on-accent" />
		</BaseSwitch.Root>
	);
}
