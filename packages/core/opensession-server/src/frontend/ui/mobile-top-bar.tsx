import * as React from "react";
import {
	MOBILE_BACK,
	MOBILE_TOP_BAR_CONTROL,
} from "../lib/app-header-classes";
import { IconChevronLeft } from "../components/icons";
import { Button, type ButtonProps } from "./button";
import { cn } from "./cn";

/**
 * Shared mobile navigation chrome. The root stays layout-agnostic so the app
 * shell can float it while a drill-in can keep it sticky; the controls and
 * slots remain identical in both places.
 */
export const MobileTopBar = React.forwardRef<HTMLElement, React.ComponentPropsWithoutRef<"header">>(
	function MobileTopBar({ className, ...props }, ref) {
		return (
			<header
				ref={ref}
				data-mobile-top-bar=""
				className={cn("items-center", className)}
				{...props}
			/>
		);
	},
);

export const MobileTopBarLeading = React.forwardRef<
	HTMLDivElement,
	React.ComponentPropsWithoutRef<"div">
>(function MobileTopBarLeading({ className, ...props }, ref) {
	return (
		<div
			ref={ref}
			className={cn("flex shrink-0 items-center gap-2", className)}
			{...props}
		/>
	);
});

export const MobileTopBarActions = React.forwardRef<
	HTMLDivElement,
	React.ComponentPropsWithoutRef<"div">
>(function MobileTopBarActions({ className, ...props }, ref) {
	return (
		<div
			ref={ref}
			className={cn("ml-auto flex shrink-0 items-center", className)}
			{...props}
		/>
	);
});

type MobileTopBarActionProps = Omit<ButtonProps, "children"> & {
	icon: React.ReactNode;
};

export const MobileTopBarAction = React.forwardRef<
	HTMLButtonElement,
	MobileTopBarActionProps
>(function MobileTopBarAction({ className, ...props }, ref) {
	return (
		<Button
			ref={ref}
			variant="ghost"
			size="md"
			className={cn(MOBILE_TOP_BAR_CONTROL, className)}
			{...props}
		/>
	);
});

type MobileTopBarBackProps = Omit<ButtonProps, "children" | "icon"> & {
	"aria-label": string;
};

export const MobileTopBarBack = React.forwardRef<
	HTMLButtonElement,
	MobileTopBarBackProps
>(function MobileTopBarBack({ className, ...props }, ref) {
	return (
		<Button
			ref={ref}
			variant="ghost"
			size="md"
			icon={<IconChevronLeft size={34} />}
			className={cn(MOBILE_BACK, className)}
			{...props}
		/>
	);
});
