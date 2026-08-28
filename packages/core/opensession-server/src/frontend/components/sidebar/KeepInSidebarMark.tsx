import { cn } from "../../ui/cn";
import { Tooltip } from "../../ui/tooltip";
import { IconInbox, IconPlus } from "../icons";

/** Inbox-plus mark, accented in the sidebar and muted in the top bar. */
export function KeepInSidebarIcon({
	muted = false,
	className,
}: {
	muted?: boolean;
	className?: string;
}) {
	return (
		<span className={cn("relative inline-flex shrink-0", className)}>
			<IconInbox size={20} />
			<span
				aria-hidden="true"
				className={cn(
					"absolute -right-1 -bottom-1 flex size-3 items-center justify-center rounded-full ring-2 ring-panel",
					muted ? "bg-dim text-panel" : "bg-accent text-on-accent",
				)}
			>
				<IconPlus size={9} />
			</span>
		</span>
	);
}

/** The inline claim affordance for a row that is visible but not yet kept. */
export function KeepInSidebarMark({
	onKeep,
	className,
	onMouseEnter,
}: {
	onKeep: () => void;
	className?: string;
	onMouseEnter?: () => void;
}) {
	const keep = (event: { preventDefault(): void; stopPropagation(): void }) => {
		event.preventDefault();
		event.stopPropagation();
		onKeep();
	};
	return (
		<Tooltip label="Keep in sidebar">
			<span
				role="button"
				tabIndex={0}
				aria-label="Keep in sidebar"
				data-sidebar-keep=""
				className={cn(
					"focus-ring relative shrink-0 cursor-pointer items-center justify-center rounded-md text-faint transition-[color,scale] hover:text-fg active:scale-[0.96] motion-reduce:transform-none",
					className ??
						"ml-1 flex size-5 before:absolute before:-inset-3 before:content-[''] desktop:before:-inset-2.5",
				)}
				onClick={keep}
				onMouseEnter={onMouseEnter}
				onMouseDown={(event) => event.stopPropagation()}
				onDoubleClick={(event) => event.stopPropagation()}
				onTouchStart={(event) => event.stopPropagation()}
				onTouchEnd={keep}
				onKeyDown={(event) => {
					if (event.key === "Enter" || event.key === " ") keep(event);
				}}
			>
				<KeepInSidebarIcon />
			</span>
		</Tooltip>
	);
}
