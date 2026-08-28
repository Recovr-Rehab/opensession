import { Tooltip } from "../../ui/tooltip";
import { IconPlus, IconRobot } from "../icons";

/**
 * A row nobody started in a composer: an automation run, a report's Fix task,
 * or a session an agent minted itself. Faint ink keeps the origin visible
 * without competing with status. It rides beside the title so the status rail
 * stays aligned with every ordinary row.
 *
 * An unclaimed row adds a small plus and becomes the inline "Keep in sidebar"
 * action. Claiming removes the plus while preserving the machine-origin mark.
 */
export function AutoCreatedMark({ onKeep }: { onKeep?: () => void }) {
	const mark = (
		<>
			<IconRobot size={20} />
			{onKeep && (
				<span
					aria-hidden="true"
					className="absolute -right-1 -bottom-1 flex size-3 items-center justify-center rounded-full bg-accent text-on-accent ring-2 ring-panel"
				>
					<IconPlus size={9} />
				</span>
			)}
		</>
	);
	if (!onKeep) {
		return (
			<span
				className="ml-1 flex shrink-0 items-center text-faint"
				role="img"
				aria-label="Started by an agent, not by a person"
				title="Started by an agent, not by a person"
			>
				{mark}
			</span>
		);
	}

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
				{mark}
			</span>
		</Tooltip>
	);
}
