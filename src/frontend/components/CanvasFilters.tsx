// The Canvas tool's two filters: whose cards, and which repo's. Both narrow
// what you see of a shared board without touching it (lib/canvas-filter), so
// they read as view controls and live beside the zoom buttons rather than in a
// popover of their own — on a board, "who is on it" is the first question, not
// a setting.
import React from "react";
import { AGENT_PERSON_KEY } from "../lib/automation-audience";
import { AGENT_NAME } from "../lib/brand";
import type { CanvasFilter, CanvasFilterOptions } from "../lib/canvas-filter";
import { personKey } from "../lib/review-queue";
import { Select } from "../ui/select";
import { IconPeople, IconRobot } from "./icons";
import { RepoTile, repoLabel } from "./RepoTile";
import { UserAvatar } from "./UserAvatar";

interface FilterItem {
	value: string;
	label: string;
	icon: React.ReactNode;
}

/** Fixed width, so picking a longer name doesn't resize the control and shove
 *  the board's other buttons sideways. Labels truncate instead. */
const TRIGGER = "w-[132px] shadow-md";

function CanvasFilterSelect({
	label,
	value,
	items,
	onChange,
}: {
	label: string;
	value: string;
	items: FilterItem[];
	onChange: (value: string) => void;
}) {
	// A filter outlives the last card it matched (the teammate's work finished,
	// the repo's sessions were archived). Keeping the picked value in the list
	// leaves the trigger reading a name rather than a raw key, and leaves a way
	// back to everything.
	const options = items.some((item) => item.value === value)
		? items
		: [...items, { value, label: value, icon: null }];
	const current = options.find((item) => item.value === value);
	return (
		<Select.Root items={options} value={value} onValueChange={(next) => onChange(next as string)}>
			<Select.Trigger
				aria-label={label}
				size="sm"
				className={TRIGGER}
				icon={current?.icon ?? null}
			/>
			<Select.Popup align="start" side="top">
				{options.map((item) => (
					<Select.Item key={item.value} value={item.value} icon={item.icon}>
						{item.label}
					</Select.Item>
				))}
			</Select.Popup>
		</Select.Root>
	);
}

/** The machine face automation rows already wear: the agent holds every card an
 *  automation run made, and an initial tile would read as a teammate. */
function AgentFace() {
	return (
		<span className="inline-flex size-4 shrink-0 items-center justify-center rounded-[32%] bg-active text-dim">
			<IconRobot size={13} />
		</span>
	);
}

export function CanvasFilters({
	filter,
	options,
	currentUser,
	onChange,
}: {
	filter: CanvasFilter;
	options: CanvasFilterOptions;
	currentUser: string;
	onChange: (patch: Partial<CanvasFilter>) => void;
}) {
	const me = personKey(currentUser);
	const people: FilterItem[] = [
		{ value: "everyone", label: "Everyone", icon: <IconPeople size={16} /> },
		...(me
			? [
					{
						value: "me",
						label: "You",
						icon: <UserAvatar name={currentUser} size={16} />,
					},
				]
			: []),
		...options.people
			.filter((person) => person.key !== me)
			.map((person) => ({
				value: person.key,
				label: person.label,
				icon: <UserAvatar name={person.label} size={16} />,
			})),
		...(options.agent
			? [{ value: AGENT_PERSON_KEY, label: AGENT_NAME, icon: <AgentFace /> }]
			: []),
	];
	const repos: FilterItem[] = [
		{ value: "all", label: "All repos", icon: null },
		...options.repos.map((repo) => ({
			value: repo,
			label: repoLabel(repo),
			icon: <RepoTile name={repo} size={16} />,
		})),
	];
	return (
		<div className="flex flex-wrap items-center gap-1">
			<CanvasFilterSelect
				label="Filter by person"
				value={filter.person}
				items={people}
				onChange={(person) => onChange({ person })}
			/>
			<CanvasFilterSelect
				label="Filter by repo"
				value={filter.repo}
				items={repos}
				onChange={(repo) => onChange({ repo })}
			/>
		</div>
	);
}
