import React, { useEffect } from "react";
import { APP_LOGO_STATUS } from "../lib/app-header-classes";
import { useOrganizationName } from "../hooks/useOrganizationIcon";
import { IconChevronDown } from "./icons";
import { OrganizationAppIcon } from "./OrganizationAppIcon";

type OrganizationBridge = {
	showMenu: (position: { x: number; y: number }) => void;
	onOpenSettings?: (callback: () => void) => (() => void) | void;
};

function organizationBridge(): OrganizationBridge | undefined {
	return (
		window as unknown as { os1?: { organizations?: OrganizationBridge } }
	).os1?.organizations;
}

/** Active organization identity and the Electron account picker entry point. */
export function OrganizationSwitcher({
	connected,
	onOpenSettings,
}: {
	connected: boolean;
	onOpenSettings: () => void;
}) {
	const name = useOrganizationName();
	const bridge = organizationBridge();
	const status = connected ? "Connected" : "Reconnecting…";

	useEffect(() => bridge?.onOpenSettings?.(onOpenSettings), [bridge, onOpenSettings]);

	function open(event: React.MouseEvent<HTMLButtonElement>) {
		if (!bridge) {
			onOpenSettings();
			return;
		}
		const rect = event.currentTarget.getBoundingClientRect();
		bridge.showMenu({ x: Math.round(rect.left), y: Math.round(rect.bottom) });
	}

	return (
		<button
			className="group flex min-h-10 w-full items-center gap-2 rounded-row bg-transparent px-[calc(var(--sidebar-icon-left)-var(--sidebar-nav-x))] text-left text-body font-semibold text-fg transition-[background-color,scale] hover:bg-hover active:scale-[0.96] phone:min-h-12 phone:text-base motion-reduce:transform-none"
			onClick={open}
			aria-label={bridge ? `Switch organization, current: ${name}` : "Open organization settings"}
		>
			<span className="relative inline-flex size-8 shrink-0 items-center justify-center">
				<OrganizationAppIcon className="size-8 rounded-md object-cover" />
				<span
					className={APP_LOGO_STATUS}
					style={{ background: connected ? "var(--green)" : "var(--red)" }}
					title={status}
				/>
			</span>
			<span className="min-w-0 flex-1 truncate">{name}</span>
			<IconChevronDown
				size={16}
				className="shrink-0 text-faint transition-colors group-hover:text-dim"
				aria-hidden="true"
			/>
		</button>
	);
}
