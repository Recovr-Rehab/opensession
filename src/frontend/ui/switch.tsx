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
				// UISwitch's actual size, not a scaled-down version of it: a
				// 51×31pt track with a 2pt inset, so the knob is 27pt and
				// travels 20pt. A pt is a CSS px here, so these are the same
				// numbers the app uses. The web type around it is smaller than
				// iOS body copy, which is why the earlier proportional
				// shrink looked right in ratio and still read short.
				"relative inline-flex h-[31px] w-[51px] shrink-0 cursor-pointer rounded-full bg-active outline-none",
				"transition-colors duration-[var(--dur-micro)] ease-[var(--ease)] data-[checked]:bg-accent",
				"focus-visible:ring-2 focus-visible:ring-accent/50 focus-visible:ring-offset-2 focus-visible:ring-offset-bg",
				"data-[disabled]:cursor-default data-[disabled]:opacity-40",
				className,
			)}
			{...props}
		>
			{/* iOS's knob is a fixed white disc in both states and both
			    appearances, and it stays that way here — on the neutral track
			    and on the ink one in light mode. The single deviation is dark
			    mode's checked track, which is the accent and therefore near
			    white: a white knob would vanish on it, so it takes --on-accent
			    (the page colour, i.e. white in light and dark ink in dark).
			    Hence bg-white for the resting knob rather than bg-fg, which
			    made the OFF state read as a bold black dot — the one place the
			    web switch didn't look like the app's. */}
			<BaseSwitch.Thumb className="absolute left-0.5 top-0.5 size-[27px] rounded-full bg-white shadow-[0_3px_8px_rgba(0,0,0,0.15),0_3px_1px_rgba(0,0,0,0.06)] transition-transform duration-[var(--dur-micro)] ease-[var(--ease)] data-[checked]:translate-x-5 data-[checked]:bg-on-accent" />
		</BaseSwitch.Root>
	);
}
