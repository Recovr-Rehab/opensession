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
				"relative inline-flex h-[22px] w-[38px] shrink-0 cursor-pointer rounded-full bg-active outline-none",
				"transition-colors duration-150 data-[checked]:bg-accent",
				"focus-visible:ring-2 focus-visible:ring-accent/50 focus-visible:ring-offset-2 focus-visible:ring-offset-bg",
				"data-[disabled]:cursor-default data-[disabled]:opacity-40",
				className,
			)}
			{...props}
		>
			{/* The thumb has to flip with the track, not sit at a fixed white: the
			    checked track is the accent, which is now ink rather than a
			    saturated red. A white thumb would vanish on a near-white checked
			    track in dark mode; a fixed --bg thumb would go muddy on the
			    unchecked track. So: ink on the neutral track, page on the ink one. */}
			<BaseSwitch.Thumb className="absolute left-0.5 top-0.5 size-[18px] rounded-full bg-fg shadow-[0_1px_2px_rgba(0,0,0,0.3)] transition-transform duration-150 data-[checked]:translate-x-4 data-[checked]:bg-on-accent" />
		</BaseSwitch.Root>
	);
}
