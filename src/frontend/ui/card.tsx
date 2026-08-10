import * as React from "react";
import { cn } from "./cn";

type CardElement = "article" | "div" | "section" | "ul";

type CardProps = React.HTMLAttributes<HTMLElement> & {
	as?: CardElement;
};

export function Card({ as: Component = "div", className, ...props }: CardProps) {
	return React.createElement(Component, {
		...props,
		className: cn(
			"rounded-lg border border-line bg-panel",
			// `as="ul"` is one of the shapes this primitive offers, and the
			// browser's own list styling doesn't know that: a card rendered as a
			// list arrives with 40px of marker indent and 14px of vertical margin,
			// so its rows sit visibly inboard of every other card on the page.
			// base.css's preflight is hand-rolled and deliberately leaves lists
			// alone, so the reset belongs with the shape that needs it.
			"[&:where(ul)]:m-0 [&:where(ul)]:list-none [&:where(ul)]:pl-0",
			className,
		),
	});
}

export function CardList({ className, ...props }: CardProps) {
	return (
		<Card
			className={cn(
				"overflow-hidden [&>*+*]:border-t [&>*+*]:border-line",
				className,
			)}
			{...props}
		/>
	);
}
