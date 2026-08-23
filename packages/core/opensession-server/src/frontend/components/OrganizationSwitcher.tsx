import React, { useState } from "react";
import { useOrganizationName } from "../hooks/useOrganizationIcon";
import { APP_LOGO_STATUS } from "../lib/app-header-classes";
import { SIDEBAR_RAIL_GAP } from "../lib/sidebar-classes";
import { Menu, MENU_ICON } from "../ui/menu";
import { IconTile } from "./BrandTile";
import { setupRequest } from "./setup-shared";
import {
	IconChevronDown,
	IconGear,
	IconPeople,
	IconPlus,
	IconServer,
} from "./icons";
import { OrganizationAppIcon } from "./OrganizationAppIcon";

type OrganizationAccount = {
	id: string;
	label: string;
	unread: number;
	shortcut: number | null;
};

type OrganizationList = {
	activeId: string;
	accounts: OrganizationAccount[];
};

type OrganizationBridge = {
	list?: () => Promise<OrganizationList | null>;
	switch?: (id: string) => void;
	add?: () => void;
	manage?: () => void;
};

function organizationBridge(): OrganizationBridge | undefined {
	return (
		window as unknown as { os1?: { organizations?: OrganizationBridge } }
	).os1?.organizations;
}

/** Active organization identity and account switcher. */
export function OrganizationSwitcher({
	connected,
	onOpenSettings,
}: {
	connected: boolean;
	onOpenSettings: (section?: "general" | "members") => void;
}) {
	const name = useOrganizationName();
	const bridge = organizationBridge();
	const fallbackId = "current";
	const [accounts, setAccounts] = useState<OrganizationAccount[]>([
		{ id: fallbackId, label: name, unread: 0, shortcut: null },
	]);
	const [activeId, setActiveId] = useState(fallbackId);
	const [memberCount, setMemberCount] = useState<number | null>(null);
	const status = connected ? "Connected" : "Reconnecting…";

	function loadMenu() {
		void bridge?.list?.()
			.then((result) => {
				if (!result?.accounts.length) return;
				setAccounts(result.accounts);
				setActiveId(result.activeId);
			})
			.catch(() => {});
		void setupRequest<{ members: unknown[] }>("/api/setup/team")
			.then((result) => setMemberCount(result.members.length))
			.catch(() => setMemberCount(null));
	}

	const subtitle = `${status}${memberCount === null ? "" : ` · ${memberCount} ${memberCount === 1 ? "member" : "members"}`}`;
	const itemClass = "phone:min-h-11";

	return (
		<Menu.Root onOpenChange={(open) => open && loadMenu()}>
			<Menu.Trigger
				className={`group flex w-full items-center ${SIDEBAR_RAIL_GAP} rounded-row bg-transparent px-[calc(var(--sidebar-icon-left)-var(--sidebar-nav-x))] py-[var(--sidebar-tool-pad)] text-left text-body font-medium text-fg transition-[background-color,scale] hover:bg-hover active:scale-[0.96] phone:py-[13px] desktop:text-item-title motion-reduce:transform-none`}
				aria-label={`Open organization menu, current: ${name}`}
			>
				<span className="relative inline-flex size-[22px] shrink-0 items-center justify-center">
					<OrganizationAppIcon className="size-[22px] rounded-sm object-cover" />
					<span
						className={APP_LOGO_STATUS}
						style={{ background: connected ? "var(--green)" : "var(--red)" }}
						title={status}
					/>
				</span>
				<span className="min-w-0 flex-1 truncate">{name}</span>
				<IconChevronDown
					size={16}
					className="shrink-0 text-faint transition-[color,rotate] group-hover:text-dim group-data-[popup-open]:rotate-180"
					aria-hidden="true"
				/>
			</Menu.Trigger>

			<Menu.Popup
				side="bottom"
				align="start"
				sideOffset={5}
				className="w-[290px] max-w-[calc(100vw-16px)]"
			>
				<div className="flex items-center gap-3 px-2 py-2">
					<span className="relative inline-flex size-9 shrink-0 items-center justify-center">
						<OrganizationAppIcon className="size-9 rounded-md object-cover" />
						<span
							className={APP_LOGO_STATUS}
							style={{ background: connected ? "var(--green)" : "var(--red)" }}
							aria-hidden="true"
						/>
					</span>
					<span className="min-w-0">
						<span className="block truncate text-body font-semibold text-fg">{name}</span>
						<span className="block truncate text-supporting text-faint">{subtitle}</span>
					</span>
				</div>
				<Menu.Separator />
				<Menu.Item className={itemClass} onClick={() => onOpenSettings("general")}>
					<IconGear size={19} className={MENU_ICON} />
					<span className="min-w-0 flex-1 truncate">Settings</span>
				</Menu.Item>
				<Menu.Item className={itemClass} onClick={() => onOpenSettings("members")}>
					<IconPeople size={19} className={MENU_ICON} />
					<span className="min-w-0 flex-1 truncate">Members</span>
					{memberCount !== null && (
						<span className="text-label tabular-nums text-faint">{memberCount}</span>
					)}
				</Menu.Item>
				<Menu.Separator />
				<Menu.Group>
					<Menu.GroupLabel>Organizations</Menu.GroupLabel>
					<Menu.RadioGroup value={activeId}>
						{accounts.map((account) => {
							const active = account.id === activeId;
							return (
								<Menu.RadioItem
									key={account.id}
									value={account.id}
									closeOnClick
									className={itemClass}
									onClick={() => {
										if (!active) bridge?.switch?.(account.id);
									}}
								>
									<span className="flex size-[22px] shrink-0 items-center justify-center">
										{active ? (
											<OrganizationAppIcon className="size-[22px] rounded-sm object-cover" />
										) : (
											<IconTile name={account.label} size={22} />
										)}
									</span>
									<span className="min-w-0 flex-1 truncate">
										{active ? name : account.label}
									</span>
									{account.unread > 0 && (
										<span className="rounded-full bg-accent px-1.5 text-meta font-semibold tabular-nums text-on-accent">
											{account.unread}
										</span>
									)}
									{account.shortcut !== null && (
										<Menu.Shortcut>⌘⇧{account.shortcut}</Menu.Shortcut>
									)}
									<Menu.Check on={active} className="text-dim" />
								</Menu.RadioItem>
							);
						})}
					</Menu.RadioGroup>
					{bridge?.add && (
						<Menu.Item className={itemClass} onClick={() => bridge.add?.()}>
							<IconPlus size={19} className={MENU_ICON} />
							<span className="min-w-0 flex-1 truncate">Add organization</span>
						</Menu.Item>
					)}
					{bridge?.manage && (
						<Menu.Item className={itemClass} onClick={() => bridge.manage?.()}>
							<IconServer size={19} className={MENU_ICON} />
							<span className="min-w-0 flex-1 truncate">
								Manage organizations
							</span>
						</Menu.Item>
					)}
				</Menu.Group>
			</Menu.Popup>
		</Menu.Root>
	);
}
