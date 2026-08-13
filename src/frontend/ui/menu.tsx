import * as React from "react";
import { Menu as BaseMenu } from "@base-ui/react/menu";
import { ContextMenu as BaseContextMenu } from "@base-ui/react/context-menu";
import { cn } from "./cn";

/**
 * Menu on Base UI parts, styled with Tailwind tokens. Composable shape —
 * consumers assemble Root/Trigger/Popup/Item rather than passing item configs.
 *
 * Unlike ui/tooltip.tsx this does NOT animate via a Motion render prop: the
 * render merge drops Base UI's injected attributes (role, data-*), which a
 * focus-managed popup can't afford. Menus animate with CSS transitions on
 * Base UI's [data-starting-style]/[data-ending-style] lifecycle attributes —
 * enter AND exit work, keyboard nav and a11y stay intact.
 */

function Trigger({
	className,
	...props
}: Omit<React.ComponentProps<typeof BaseMenu.Trigger>, "className"> & {
	className?: string;
}) {
	return <BaseMenu.Trigger {...props} className={cn("focus-ring", className)} />;
}

// Shared popup chrome for both the click-menu and the right-click context menu:
// overflow-hidden keeps the inner scrollbar's ends clipped to the rounded corner
// instead of poking past it; the transition rides Base UI's lifecycle attrs.
const popupClasses =
	"min-w-[180px] overflow-hidden rounded-popup [corner-shape:squircle] bg-popup-glass [backdrop-filter:var(--popup-blur)] [--smooth-ring-color:var(--popup-ring)] smooth-shadow-ring-md outline-none origin-[var(--transform-origin)] transition-[transform,opacity] duration-[120ms] ease-out data-[starting-style]:scale-[0.97] data-[starting-style]:opacity-0 data-[ending-style]:opacity-0";

const popupInnerClasses =
	"max-h-[min(60vh,420px,var(--available-height))] overflow-y-auto overflow-x-hidden overscroll-contain p-1.5";

function Popup({
	className,
	side,
	align,
	sideOffset = 8,
	children,
}: {
	className?: string;
	side?: React.ComponentProps<typeof BaseMenu.Positioner>["side"];
	align?: React.ComponentProps<typeof BaseMenu.Positioner>["align"];
	sideOffset?: number;
	children: React.ReactNode;
}) {
	return (
		<BaseMenu.Portal>
			<BaseMenu.Positioner
				side={side}
				align={align}
				sideOffset={sideOffset}
				collisionPadding={8}
				className="z-[10001] outline-none"
			>
				<BaseMenu.Popup className={cn("app-menu-popup", popupClasses, className)}>
					<div className={popupInnerClasses}>{children}</div>
				</BaseMenu.Popup>
			</BaseMenu.Positioner>
		</BaseMenu.Portal>
	);
}

/** Right-click context-menu popup. Anchors to the cursor (Base UI positions it
 * from the contextmenu event), reusing the same chrome + Item styling as Menu. */
function ContextPopup({
	className,
	finalFocus,
	children,
}: {
	className?: string;
	/** Where focus goes on close — pass `false` when the menu opens an inline
	 * editor that autofocuses itself (default restores focus to the trigger). */
	finalFocus?: React.ComponentProps<typeof BaseContextMenu.Popup>["finalFocus"];
	children: React.ReactNode;
}) {
	return (
		<BaseContextMenu.Portal>
			<BaseContextMenu.Positioner
				collisionPadding={8}
				className="z-[10001] outline-none"
			>
				<BaseContextMenu.Popup
					className={cn("app-menu-popup", popupClasses, className)}
					finalFocus={finalFocus}
				>
					<div className={popupInnerClasses}>{children}</div>
				</BaseContextMenu.Popup>
			</BaseContextMenu.Positioner>
		</BaseContextMenu.Portal>
	);
}

/** Shared row styling for anything that behaves like a menu item. Highlight
 * via Base UI's data-highlighted so keyboard navigation lights rows up too. */
const itemClasses =
	"flex w-full cursor-pointer select-none items-center gap-2 rounded-md px-2 py-1.5 text-left text-control-label text-fg no-underline outline-none data-[highlighted]:bg-hover";

function Item({
	className,
	...props
}: Omit<React.ComponentProps<typeof BaseMenu.Item>, "className"> & {
	className?: string;
}) {
	return <BaseMenu.Item {...props} className={cn(itemClasses, className)} />;
}

function SubmenuTrigger({
	className,
	...props
}: Omit<React.ComponentProps<typeof BaseMenu.SubmenuTrigger>, "className"> & {
	className?: string;
}) {
	return (
		<BaseMenu.SubmenuTrigger
			{...props}
			className={cn(itemClasses, "data-[popup-open]:bg-hover", className)}
		/>
	);
}

function RadioItem({
	className,
	...props
}: Omit<React.ComponentProps<typeof BaseMenu.RadioItem>, "className"> & {
	className?: string;
}) {
	return (
		<BaseMenu.RadioItem {...props} className={cn(itemClasses, className)} />
	);
}

function CheckboxItem({
	className,
	...props
}: Omit<React.ComponentProps<typeof BaseMenu.CheckboxItem>, "className"> & {
	className?: string;
}) {
	return (
		<BaseMenu.CheckboxItem {...props} className={cn(itemClasses, className)} />
	);
}

/**
 * Resting colour for a row's leading glyph. Menu icons sit one step back from
 * their label so the words lead and the column of glyphs reads as one set;
 * the sidebar's right-click menu and the phone sheet already do this. Skip it
 * for a glyph that carries state in its colour (a running preview's green, a
 * pinned row's yellow).
 */
export const MENU_ICON = "text-dim";

/** Right-aligned keyboard-shortcut hint on a menu row ("⌘ W"). Place it after
 * the row's `grow` label so it pins to the trailing edge. Exported on its own
 * as well as on the Menu namespaces: the composer's "+" menu is a hand-rolled
 * popover (its rows carry the iOS touchend handling Base UI can't), and its
 * hints have to read exactly like the ones in a real menu. */
export function MenuShortcut({
	className,
	children,
}: {
	className?: string;
	children: React.ReactNode;
}) {
	return (
		<span className={cn("shrink-0 pl-4 text-label text-faint", className)}>
			{children}
		</span>
	);
}

function Separator({ className }: { className?: string }) {
	return <BaseMenu.Separator className={cn("-mx-1.5 my-1.5 h-px bg-line", className)} />;
}

function GroupLabel({ className, ...props }: { className?: string; children?: React.ReactNode }) {
	return (
		<BaseMenu.GroupLabel
			{...props}
			className={cn(
				"px-2 pb-1 text-meta font-semibold tracking-[-0.01em] text-faint",
				className,
			)}
		/>
	);
}

/** Right-click context menu. Trigger wraps the target (render it as the anchor);
 * left-click passes through, contextmenu opens the popup at the cursor. Reuses
 * Menu's Item/Separator — Base UI's ContextMenu.Item is the same MenuItem. */
export const ContextMenu = {
	Root: BaseContextMenu.Root,
	Trigger: BaseContextMenu.Trigger,
	Popup: ContextPopup,
	Item,
	Separator,
	Shortcut: MenuShortcut,
	// Submenus are the plain Menu parts (ContextMenu re-exports them), so a
	// submenu's own popup is Menu.Popup: it anchors to its trigger row rather
	// than to the cursor the way ContextPopup does.
	SubmenuRoot: BaseContextMenu.SubmenuRoot,
	SubmenuTrigger,
};

export const Menu = {
	Root: BaseMenu.Root,
	Trigger,
	Popup,
	Item,
	Separator,
	Shortcut: MenuShortcut,
	Group: BaseMenu.Group,
	GroupLabel,
	SubmenuRoot: BaseMenu.SubmenuRoot,
	SubmenuTrigger,
	RadioGroup: BaseMenu.RadioGroup,
	RadioItem,
	RadioItemIndicator: BaseMenu.RadioItemIndicator,
	CheckboxItem,
};
