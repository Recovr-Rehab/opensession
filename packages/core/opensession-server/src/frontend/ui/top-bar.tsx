import * as React from "react";
import {
	MOBILE_BACK,
	MOBILE_TOP_BAR_CONTROL,
} from "../lib/app-header-classes";
import { IconChevronLeft } from "../components/icons";
import { Button, type ButtonProps } from "./button";
import { cn } from "./cn";

/**
 * Shared application top-bar structure. Feature bars keep their own position,
 * height and surface while using the same leading, title and action slots.
 */
type TopBarProps = React.HTMLAttributes<HTMLElement> & {
	as?: "div" | "header";
};

export const TopBar = React.forwardRef<HTMLElement, TopBarProps>(function TopBar(
	{ as = "div", className, ...props },
	ref,
) {
	return React.createElement(as, {
		ref,
		"data-top-bar": "",
		className: cn("flex min-w-0 items-center", className),
		...props,
	});
});

export const TopBarLeading = React.forwardRef<
	HTMLDivElement,
	React.ComponentPropsWithoutRef<"div">
>(function TopBarLeading({ className, ...props }, ref) {
	return (
		<div
			ref={ref}
			className={cn("flex min-w-0 items-center gap-2", className)}
			{...props}
		/>
	);
});

export const TopBarTitle = React.forwardRef<
	HTMLDivElement,
	React.ComponentPropsWithoutRef<"div">
>(function TopBarTitle({ className, ...props }, ref) {
	return <div ref={ref} className={cn("min-w-0", className)} {...props} />;
});

export const TopBarActions = React.forwardRef<
	HTMLDivElement,
	React.ComponentPropsWithoutRef<"div">
>(function TopBarActions({ className, ...props }, ref) {
	return (
		<div
			ref={ref}
			className={cn("ml-auto flex shrink-0 items-center", className)}
			{...props}
		/>
	);
});

type TopBarActionProps = Omit<ButtonProps, "children"> & {
	icon: React.ReactNode;
	floating?: boolean;
};

export const TopBarAction = React.forwardRef<HTMLButtonElement, TopBarActionProps>(
	function TopBarAction({ className, floating = false, ...props }, ref) {
		return (
			<Button
				ref={ref}
				variant="ghost"
				size="md"
				className={cn(floating && MOBILE_TOP_BAR_CONTROL, className)}
				{...props}
			/>
		);
	},
);

type TopBarBackProps = Omit<ButtonProps, "children" | "icon"> & {
	"aria-label": string;
	floating?: boolean;
	iconSize?: number;
};

export const TopBarBack = React.forwardRef<HTMLButtonElement, TopBarBackProps>(
	function TopBarBack(
		{ className, floating = false, iconSize = 22, ...props },
		ref,
	) {
		return (
			<Button
				ref={ref}
				variant="ghost"
				size="md"
				icon={<IconChevronLeft size={iconSize} />}
				className={cn(floating && MOBILE_BACK, className)}
				{...props}
			/>
		);
	},
);
