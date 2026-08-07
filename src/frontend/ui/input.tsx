import * as React from "react";
import { cn } from "./cn";

/**
 * Field primitive — the shared optics for single-line inputs, multi-line
 * editors, and native selects.
 *
 * The app had no field primitive at all: 95 raw `<input>`s each carried their
 * own class list, and they had settled on `rounded-md` (7px) while every
 * button in the app is `rounded-control` (10px). A field and the button that
 * submits it therefore sat side by side with visibly different corners — the
 * single loudest reason a form here reads as assembled from parts rather than
 * designed.
 *
 * So the scale is deliberately Button's scale, step for step: same heights,
 * same horizontal padding, same one radius. A field and a button of the same
 * size are the same box; only the fill and the border differ, which is the
 * distinction that should carry (a well you type into vs. a plate you press).
 *
 * The fill is `bg-surface` — the page's own surface, so a field reads as a
 * well cut into the group it sits in rather than another raised card. Focus
 * moves the border to the accent instead of adding a ring: the accent is ink
 * now, so a full-strength border is legible in both themes and costs no
 * layout.
 */

type Size = "sm" | "md" | "lg";

/** Height/padding/type per step — mirrors `Button`'s `sizes`. */
const sizes: Record<Size, string> = {
	sm: "min-h-[26px] px-2 text-xs",
	md: "min-h-8 px-2.5 text-sm",
	lg: "min-h-9 px-3 text-base",
};

/**
 * Everything a field shares regardless of element: corner, fill, border,
 * placeholder, focus, disabled. Exported for the few natively-styled controls
 * that cannot be one of the components below (a `<select>` needing its own
 * appearance reset, a contenteditable).
 */
export const fieldClass =
	"w-full rounded-control border border-line bg-surface text-fg outline-none transition-colors placeholder:text-faint focus:border-accent disabled:cursor-default disabled:opacity-40";

export function fieldClasses(size: Size = "md", className?: string) {
	return cn(fieldClass, sizes[size], className);
}

type InputProps = Omit<React.ComponentPropsWithoutRef<"input">, "size"> & {
	size?: Size;
};

export function Input({ className, size = "md", ...props }: InputProps) {
	return <input className={fieldClasses(size, className)} {...props} />;
}

type TextareaProps = React.ComponentPropsWithoutRef<"textarea"> & {
	size?: Size;
};

/** Multi-line entry. Vertically resizable and padded like a paragraph rather
 *  than a single line, but the same well as `Input` in every other respect. */
export function Textarea({ className, size = "md", ...props }: TextareaProps) {
	return <textarea className={fieldClasses(size, cn("resize-y py-2", className))} {...props} />;
}

type SelectProps = Omit<React.ComponentPropsWithoutRef<"select">, "size"> & {
	size?: Size;
};

/** Native select in the field shape. Kept native for the platform's own
 *  keyboard and mobile pickers; reach for `ui/menu` when the options need
 *  richer rows than a native list can carry. */
export function Select({ className, size = "md", ...props }: SelectProps) {
	return <select className={fieldClasses(size, cn("cursor-pointer", className))} {...props} />;
}
