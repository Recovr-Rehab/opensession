import { Tooltip } from "../../ui/tooltip";
import { IconInbox, IconPlus } from "../icons";

/** The inline claim affordance for a row that is visible but not yet kept. */
export function KeepInSidebarMark({ onKeep }: { onKeep: () => void }) {
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
				className="focus-ring relative ml-1 flex size-5 shrink-0 cursor-pointer items-center justify-center rounded-md text-faint transition-[color,scale] before:absolute before:-inset-3 before:content-[''] hover:text-fg active:scale-[0.96] desktop:before:-inset-2.5 motion-reduce:transform-none"
				onClick={keep}
				onMouseDown={(event) => event.stopPropagation()}
				onDoubleClick={(event) => event.stopPropagation()}
				onTouchStart={(event) => event.stopPropagation()}
				onTouchEnd={keep}
				onKeyDown={(event) => {
					if (event.key === "Enter" || event.key === " ") keep(event);
				}}
			>
				<IconInbox size={20} />
				<span
					aria-hidden="true"
					className="absolute -right-1 -bottom-1 flex size-3 items-center justify-center rounded-full bg-accent text-on-accent ring-2 ring-panel"
				>
					<IconPlus size={9} />
				</span>
			</span>
		</Tooltip>
	);
}
