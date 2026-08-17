import React from "react";
import type { SidebarToolId } from "../../lib/sidebar-tools";
import {
	SUPPORT_SURFACE_OPTIONS,
	type SupportSurface,
} from "../../lib/support-surface";
import { ContextMenu, Menu, MENU_ICON } from "../../ui/menu";
import { cn } from "../../ui/cn";
import { IconCheck, IconChevronRight } from "../icons";

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
						<ContextMenu.SubmenuRoot key={tool.id}>
							<ContextMenu.SubmenuTrigger>
								<span className={cn(ICON_SLOT, MENU_ICON)}>{tool.icon}</span>
								<span className="grow truncate">{tool.label}</span>
								{/* Which surface it is on, then the way in, then the tick —
								    the tick last so it lands in the same column as every
								    other row's, which is the column the eye reads to see
								    what is showing. Off is the unticked state, exactly as a
								    tool switched off has no tick. */}
								<span className="shrink-0 text-faint">
									{
										SUPPORT_SURFACE_OPTIONS.find(
											(option) => option.value === tool.surface,
										)?.label
									}
								</span>
								<IconChevronRight size={16} className="shrink-0 text-faint" />
								{tool.surface !== "off" && check}
							</ContextMenu.SubmenuTrigger>
							<Menu.Popup>
								{/* One queue, one decision: the band and the page are
								    alternatives, so these are three answers to one question
								    rather than ticks that could leave the same tickets on
								    screen twice. Same wording and order as Settings >
								    Appearance. */}
								<Menu.RadioGroup
									value={tool.surface}
									onValueChange={(value) =>
										onSetSupport(value as SupportSurface)
									}
								>
									{SUPPORT_SURFACE_OPTIONS.map((option) => (
										<Menu.RadioItem key={option.value} value={option.value}>
											<span className="grow truncate">{option.label}</span>
											<Menu.RadioItemIndicator render={check} />
										</Menu.RadioItem>
									))}
								</Menu.RadioGroup>
							</Menu.Popup>
						</ContextMenu.SubmenuRoot>
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
