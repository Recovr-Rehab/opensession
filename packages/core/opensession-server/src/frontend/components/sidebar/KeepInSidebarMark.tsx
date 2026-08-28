import { Tooltip } from "../../ui/tooltip";
import { IconSidebarPlus } from "../icons";

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
				className="focus-ring relative ml-1 flex size-5 shrink-0 cursor-pointer items-center justify-center rounded-md text-accent transition-[scale] before:absolute before:-inset-3 before:content-[''] active:scale-[0.96] desktop:before:-inset-2.5 motion-reduce:transform-none"
				onClick={keep}
				onMouseDown={(event) => event.stopPropagation()}
				onDoubleClick={(event) => event.stopPropagation()}
				onTouchStart={(event) => event.stopPropagation()}
				onTouchEnd={keep}
				onKeyDown={(event) => {
					if (event.key === "Enter" || event.key === " ") keep(event);
				}}
			>
				<IconSidebarPlus size={20} />
			</span>
		</Tooltip>
	);
}
