import { IconRobot } from "../icons";

/**
 * A row nobody started by hand: an agent minted this session or workspace
 * through the automation machine identity.
 *
 * The separated section answers how much of the list is automatic. This
 * answers whether THIS one is, which is the question a row still raises once
 * the grouping moves it in next to work a person started (a repo band puts
 * both in one column). Faint ink, always on: the fact is worth keeping on the
 * page. It rides beside the title rather than in the rail, so the status mark
 * every other row wears keeps its slot and no title leaves the rail.
 */
export function AutoCreatedMark() {
	return (
		<span
			className="ml-1 flex shrink-0 items-center text-faint"
			role="img"
			aria-label="Created automatically"
			title="Created automatically"
		>
			<IconRobot size={20} />
		</span>
	);
}
