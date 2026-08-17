import React from "react";
import type { SidebarToolId } from "../../lib/sidebar-tools";
import {
	DEFAULT_SUPPORT_PLACEMENT,
	SUPPORT_PLACEMENT_OPTIONS,
	SUPPORT_SURFACE_OPTIONS,
	type SupportSurface,
} from "../../lib/support-surface";
import { ContextMenu, Menu, MENU_ICON } from "../../ui/menu";
import { cn } from "../../ui/cn";
import { IconCheck, IconDotsHorizontal } from "../icons";

/**
 * The sidebar's own right-click menu: every tool and every source, ticked when
 * it is showing. Hidden entries are the point — this is the only place a tool
 * or a source that took itself off the sidebar can be put back without going
 * to Settings. Rows stay open on click, so turning three of them on is one
 * gesture rather than three right-clicks.
 *
 * A real context menu rather than the hand-written popup the row menus still
 * use (SidebarCtxMenu), because this one carries a submenu, and a submenu is
 * where a hand-written popup stops being worth it: keyboard walking, the safe
 * triangle across the gap to the flyout, touch, and the exit transition all
 * come with the primitive.
 *
 * It has to be a ContextMenu rather than a Menu opened at a point: Base UI
 * only hands a menu its node in the floating tree through a trigger or a
 * context-menu context, and without one the submenu opens as a SIBLING of its
 * own parent, which closes the parent the moment you reach for it.
 */

const ICON_SLOT = "inline-flex shrink-0 [&_svg]:size-[20px]";

export type SidebarMenuTool = {
	id: SidebarToolId;
	label: string;
	icon: React.ReactNode;
	shown: boolean;
	/** Set on Support, and only Support: it names which of two surfaces its
	 * queue lives on, so the row is a submenu of three states rather than a
	 * tick. It keeps its place among the tools. */
	surface?: SupportSurface;
};

export type SidebarMenuSource = {
	id: string;
	label: string;
	icon: React.ReactNode;
	shown: boolean;
};

const check = <IconCheck size={20} className="shrink-0 text-dim" />;

/**
 * The tool list itself, shared by the two menus that offer it: this one and
 * the one on a tool row in the rail. They are different menus around the same
 * decision, and when each drew its own rows they drifted — the row menu ticked
 * Support like an ordinary tool, which it is not.
 */
export function SidebarToolRows({
	tools,
	onToggleTool,
	onSetSupport,
}: {
	tools: SidebarMenuTool[];
	onToggleTool: (id: SidebarToolId, shown: boolean) => void;
	onSetSupport: (surface: SupportSurface) => void;
}) {
	return (
		<>
			{tools.map((tool) =>
					tool.surface ? (
						// Support switches on and off from the row like every other tool.
						// It is the one tool with somewhere to be, so where it goes is a ⋯
						// on the row rather than a third row of the same switch.
						//
						// The ⋯ is a SIBLING of the row, laid over it, not a control
						// inside it: a press inside a menu item is that item's press, so
						// nested it opened the placement menu and switched Support off in
						// the same click. Out here each is its own target, and the row
						// keeps its tick at the trailing edge, in the column every other
						// row ticks in.
						<div key={tool.id} className="relative">
							<ContextMenu.CheckboxItem
								checked={tool.surface !== "off"}
								onCheckedChange={(shown) =>
									onSetSupport(shown ? DEFAULT_SUPPORT_PLACEMENT : "off")
								}
							>
								<span className={cn(ICON_SLOT, MENU_ICON)}>{tool.icon}</span>
								<span className="grow truncate">{tool.label}</span>
								{tool.surface !== "off" && (
									<span className="shrink-0 truncate text-faint">
										{
											SUPPORT_SURFACE_OPTIONS.find(
												(option) => option.value === tool.surface,
											)?.label
										}
									</span>
								)}
								{/* The gap the ⋯ is drawn in. It is not in the row's flow —
								    a control inside a menu item eats that item's click — so
								    the row holds a place for it, and the tick keeps the
								    trailing edge, in the column every other row ticks in. */}
								<span className="w-7 shrink-0" aria-hidden="true" />
								{tool.surface !== "off" && check}
							</ContextMenu.CheckboxItem>
							{/* A menu of its own rather than a submenu of this row: Base UI
							    submenus open on hover and IGNORE a mouse click
							    (`ignoreMouse: openOnHover` in MenuSubmenuTrigger), and a ⋯
							    is a thing you click. Nested inside the popup it still
							    registers as a child menu, so opening it leaves the menu it
							    sits in up. */}
							<Menu.Root>
								<Menu.Trigger
									// A control on a row, not a row. It sits in the gap the
									// row's `pr-16` keeps clear, just inside the tick.
									className="absolute top-1/2 right-9 -translate-y-1/2 rounded-sm p-1 text-faint hover:bg-hover data-[popup-open]:bg-hover"
									aria-label="Where support tickets live"
								>
									<IconDotsHorizontal size={20} />
								</Menu.Trigger>
								{/* The ⋯ is inset from the popup's right edge by `right-9`, so
									    the offset clears the popup rather than the button:
									    36px of inset plus the 4px gap. Any less and this menu
									    opens over the tick it is about. */}
									<Menu.Popup side="right" align="start" sideOffset={40}>
									{/* One queue, one place: the band and the tool are two
									    doors onto the same tickets, and both at once would
									    list them twice. Off is not here — that is the row's
									    own tick. */}
									<Menu.RadioGroup
										value={tool.surface}
										onValueChange={(value) =>
											onSetSupport(value as SupportSurface)
										}
									>
										{SUPPORT_PLACEMENT_OPTIONS.map((option) => (
											<Menu.RadioItem key={option.value} value={option.value}>
												<span className="grow truncate">{option.label}</span>
												<Menu.RadioItemIndicator render={check} />
											</Menu.RadioItem>
										))}
									</Menu.RadioGroup>
								</Menu.Popup>
							</Menu.Root>
						</div>
					) : (
						<ContextMenu.CheckboxItem
							key={tool.id}
							checked={tool.shown}
							onCheckedChange={(shown) => onToggleTool(tool.id, shown)}
						>
							{/* The glyphs are drawn at the sidebar's 22px rail size; the
							    menu's icon column is 20, the size every other row uses. */}
							<span className={cn(ICON_SLOT, MENU_ICON)}>{tool.icon}</span>
							<span className="grow truncate">{tool.label}</span>
							{tool.shown && check}
						</ContextMenu.CheckboxItem>
					),
			)}
		</>
	);
}

export function SidebarToolsMenu({
	tools,
	sources,
	onToggleTool,
	onSetSupport,
	onToggleSource,
}: {
	tools: SidebarMenuTool[];
	sources: SidebarMenuSource[];
	onToggleTool: (id: SidebarToolId, shown: boolean) => void;
	onSetSupport: (surface: SupportSurface) => void;
	onToggleSource: (id: string, shown: boolean) => void;
}) {
	return (
		<ContextMenu.Popup>
			<ContextMenu.Group>
				<ContextMenu.GroupLabel>Tools</ContextMenu.GroupLabel>
				<SidebarToolRows
					tools={tools}
					onToggleTool={onToggleTool}
					onSetSupport={onSetSupport}
				/>
			</ContextMenu.Group>
			{sources.length > 0 && (
				<>
					<ContextMenu.Separator />
					<ContextMenu.Group>
						<ContextMenu.GroupLabel>Sources</ContextMenu.GroupLabel>
						{sources.map((source) => (
							<ContextMenu.CheckboxItem
								key={source.id}
								checked={source.shown}
								onCheckedChange={(shown) => onToggleSource(source.id, shown)}
							>
								<span className={ICON_SLOT}>{source.icon}</span>
								<span className="grow truncate">{source.label}</span>
								{source.shown && check}
							</ContextMenu.CheckboxItem>
						))}
					</ContextMenu.Group>
				</>
			)}
		</ContextMenu.Popup>
	);
}
