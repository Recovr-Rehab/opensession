import { useState } from "react";
import { useSetupStatus } from "../../hooks/useSetupStatus";
import type { SettingsSectionKey } from "../../lib/settings-sections";
import {
	dismissSetupWidget,
	setupWidgetDismissed,
	setupWidgetItems,
} from "../../lib/setup-widget";
import { cn } from "../../ui/cn";
import { Tooltip } from "../../ui/tooltip";
import { IconCheck, IconX } from "../icons";

export function SetupWidget({
	hasCreatedSession,
	onOpenSettings,
	onNewSession,
}: {
	hasCreatedSession: boolean;
	onOpenSettings: (section?: SettingsSectionKey) => void;
	onNewSession: () => void;
}) {
	const [dismissed, setDismissed] = useState(setupWidgetDismissed);
	const setup = useSetupStatus();
	if (dismissed || !setup.status) return null;

	const items = setupWidgetItems(setup.status, hasCreatedSession);
	const complete = items.filter((item) => item.complete).length;
	const progress = `${Math.round((complete / items.length) * 100)}%`;

	return (
		<aside
			aria-labelledby="sidebar-setup-title"
			className="mx-[var(--sidebar-nav-x)] mt-3 mb-3 shrink-0 rounded-xl bg-panel p-3"
			onPointerEnter={() => void setup.refetch()}
			onFocusCapture={() => void setup.refetch()}
		>
			<div className="mb-2 flex min-h-8 items-center gap-2 px-1">
				<h2 id="sidebar-setup-title" className="m-0 text-item-title font-semibold text-fg">
					Get started
				</h2>
				<span className="ml-auto tabular-nums text-meta text-faint">
					{complete} of {items.length}
				</span>
				<div
					className="h-1.5 w-12 overflow-hidden rounded-full bg-hover"
					role="progressbar"
					aria-label="Setup progress"
					aria-valuemin={0}
					aria-valuemax={items.length}
					aria-valuenow={complete}
				>
					<div
						className="h-full rounded-full bg-accent transition-[width] duration-[var(--dur-fast)] ease-[var(--ease-out)] motion-reduce:transition-none"
						style={{ width: progress }}
					/>
				</div>
				<Tooltip label="Dismiss">
					<button
						type="button"
						aria-label="Dismiss setup checklist"
						className="focus-ring -mr-2 flex size-10 shrink-0 items-center justify-center rounded-control text-faint transition-colors duration-[var(--dur-micro)] hover:bg-hover hover:text-fg phone:size-11"
						onClick={() => {
							dismissSetupWidget();
							setDismissed(true);
						}}
					>
						<IconX size={18} />
					</button>
				</Tooltip>
			</div>

			<div className="flex flex-col gap-0.5">
				{items.map((item) => (
					<button
						key={item.id}
						type="button"
						className="focus-ring group flex min-h-10 w-full items-center gap-2.5 rounded-row px-2 py-1.5 text-left transition-colors duration-[var(--dur-micro)] hover:bg-hover phone:min-h-11"
						onClick={() =>
							item.target === "new-session"
								? onNewSession()
								: onOpenSettings(item.target)
						}
					>
						<span
							className={cn(
								"flex size-5 shrink-0 items-center justify-center rounded-full",
								item.complete ? "bg-accent text-on-accent" : "bg-surface text-transparent",
							)}
							aria-hidden="true"
						>
							<IconCheck size={13} />
						</span>
						<span className="min-w-0">
							<span
								className={cn(
									"block text-label leading-snug",
									item.complete ? "text-dim" : "font-medium text-fg",
								)}
							>
								{item.label}
							</span>
							{item.detail && (
								<span className="mt-0.5 block truncate text-meta leading-snug text-faint">
									{item.detail}
								</span>
							)}
						</span>
						<span className="sr-only">
							{item.complete ? ", complete" : ", needs setup"}
						</span>
					</button>
				))}
			</div>
		</aside>
	);
}
