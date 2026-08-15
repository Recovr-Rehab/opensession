import * as React from "react";
import { Select as BaseSelect } from "@base-ui/react/select";
import { IconCheck, IconChevronDown } from "../components/icons";
import { cn } from "./cn";
import { fieldClasses } from "./input";
import {
	POPUP_HOOK,
	popupItemClasses,
	popupScrollClasses,
	popupSurfaceClasses,
} from "./popup-classes";

/**
 * Select on Base UI parts: a field-shaped trigger that opens the app's own
 * popup instead of the operating system's dropdown.
 *
 * A native `<select>` is the odd control out here. It draws the platform's
 * arrow rather than our icon set, it opens a list styled by the OS, and its
 * rows can carry nothing but text, so a page of settings ends with one
 * control that belongs to a different app. This is the same surface every
 * menu in the product already uses (`ui/popup-classes.ts`), so a select and
 * the ⋯ menu in the row beside it open the same-looking list.
 *
 * Composable parts, like `ui/menu`: assemble Root/Trigger/Popup/Item rather
 * than passing item configs. `components/settings/shared.tsx` wraps these in
 * the options-array API settings rows use.
 *
 * One thing to know: pass `items` to `Root`. The trigger's value text is
 * resolved from that list, so without it a closed select shows the raw value
 * (`opencode/anthropic/claude-opus-5`) instead of its label.
 *
 * Reach for `ui/input`'s native `Select` only when you specifically want the
 * OS picker.
 */

type Size = "sm" | "md" | "lg";

type TriggerProps = Omit<React.ComponentProps<typeof BaseSelect.Trigger>, "className"> & {
	className?: string;
	size?: Size;
	/** Shown when nothing is selected. */
	placeholder?: React.ReactNode;
	/**
	 * Every label the select can show. The trigger reserves the width of the
	 * widest one, so choosing a longer option doesn't resize the control and
	 * shuffle the row around it. A native select does this for free; a custom
	 * trigger sizes to the current value unless it is told the rest.
	 *
	 * Skip it where the trigger's width is already fixed by its container (a
	 * form grid, a `w-full` field).
	 */
	sizeTo?: React.ReactNode[];
};

function Trigger({
	className,
	size = "md",
	placeholder,
	sizeTo,
	children,
	...props
}: TriggerProps) {
	return (
		<BaseSelect.Trigger
			{...props}
			className={cn(
				fieldClasses(
					size,
					// The chevron sits in flow in its own grid column, so the
					// field's own padding is what separates it from the edge.
					"inline-grid cursor-pointer grid-cols-[minmax(0,1fr)_auto] items-center gap-2 pr-2 text-left",
				),
				// Open reads like focus: the border carries the state, as it does
				// on every other field.
				"data-[popup-open]:border-accent",
				className,
			)}
		>
			<span className="col-start-1 row-start-1 truncate">
				{children ?? <BaseSelect.Value placeholder={placeholder} />}
			</span>
			{sizeTo?.map((label, index) => (
				<span key={index} aria-hidden className="invisible col-start-1 row-start-1 truncate">
					{label}
				</span>
			))}
			<IconChevronDown size={16} className="col-start-2 row-start-1 shrink-0 text-faint" />
		</BaseSelect.Trigger>
	);
}

function Popup({
	className,
	side,
	align = "start",
	sideOffset = 6,
	children,
}: {
	className?: string;
	side?: React.ComponentProps<typeof BaseSelect.Positioner>["side"];
	align?: React.ComponentProps<typeof BaseSelect.Positioner>["align"];
	sideOffset?: number;
	children: React.ReactNode;
}) {
	return (
		<BaseSelect.Portal>
			<BaseSelect.Positioner
				side={side}
				align={align}
				sideOffset={sideOffset}
				collisionPadding={8}
				// Base UI's default overlays the popup on its trigger so the
				// selected row lands under the cursor. That mode skips the
				// positioning transition and turns itself off on touch, which
				// would give this one popup two open behaviours and no
				// animation. Anchor it below the trigger like every menu.
				alignItemWithTrigger={false}
				className="z-[10001] outline-none"
			>
				<BaseSelect.Popup
					className={cn(POPUP_HOOK, popupSurfaceClasses, "min-w-[var(--anchor-width)]", className)}
				>
					<BaseSelect.List className={popupScrollClasses}>{children}</BaseSelect.List>
				</BaseSelect.Popup>
			</BaseSelect.Positioner>
		</BaseSelect.Portal>
	);
}

function Item({
	className,
	children,
	...props
}: Omit<React.ComponentProps<typeof BaseSelect.Item>, "className"> & {
	className?: string;
}) {
	return (
		<BaseSelect.Item
			{...props}
			className={cn(
				popupItemClasses,
				"justify-between gap-3 data-[disabled]:cursor-default data-[disabled]:opacity-40",
				className,
			)}
		>
			<BaseSelect.ItemText className="min-w-0 truncate">{children}</BaseSelect.ItemText>
			<BaseSelect.ItemIndicator className="shrink-0 text-accent">
				<IconCheck size={17} />
			</BaseSelect.ItemIndicator>
		</BaseSelect.Item>
	);
}

function GroupLabel({
	className,
	...props
}: Omit<React.ComponentProps<typeof BaseSelect.GroupLabel>, "className"> & {
	className?: string;
}) {
	return (
		<BaseSelect.GroupLabel
			{...props}
			className={cn(
				"px-2 pb-1 pt-1.5 text-meta font-semibold tracking-[-0.01em] text-faint",
				className,
			)}
		/>
	);
}

function Separator({ className }: { className?: string }) {
	return <BaseSelect.Separator className={cn("-mx-1.5 my-1.5 h-px bg-line", className)} />;
}

export const Select = {
	Root: BaseSelect.Root,
	Trigger,
	Value: BaseSelect.Value,
	Popup,
	Item,
	Group: BaseSelect.Group,
	GroupLabel,
	Separator,
};

/**
 * The flat case, which is most of them: a list of `{ value, label }` and the
 * one that is picked. Settings rows and form fields both reach for this;
 * assemble the parts above only when the list needs groups or custom rows.
 */
export function OptionSelect<T extends string>({
	value,
	options,
	onChange,
	label,
	disabled,
	className,
}: {
	value: T;
	options: { value: T; label: string; disabled?: boolean }[];
	onChange: (value: T) => void;
	label: string;
	disabled?: boolean;
	className?: string;
}) {
	return (
		<Select.Root
			// The labels the trigger draws its value from, so a closed select
			// reads "Ask first" rather than "ask".
			items={options}
			value={value}
			disabled={disabled}
			onValueChange={(next) => onChange(next as T)}
		>
			<Select.Trigger
				aria-label={label}
				className={className}
				sizeTo={options.map((option) => option.label)}
			/>
			<Select.Popup align="end">
				{options.map((option) => (
					<Select.Item key={option.value} value={option.value} disabled={option.disabled}>
						{option.label}
					</Select.Item>
				))}
			</Select.Popup>
		</Select.Root>
	);
}
