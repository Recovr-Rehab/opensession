import type { ReactNode } from "react";
import { MINE_STATUS_META, type MineStatus } from "../../lib/sidebar-types";
import { SheetBody, SheetIconButton, SheetItem } from "../../ui/sheet";
import { TopBar, TopBarTitle } from "../../ui/top-bar";
import { IconCheck, IconChevronLeft, IconChevronRight } from "../icons";

export type LanePickerValue = MineStatus | "mixed" | null;

export function lanePickerLabel(value: LanePickerValue): string {
	if (value === "mixed") return "Mixed";
	return MINE_STATUS_META.find((item) => item.key === value)?.label ?? "Auto";
}

export function LaneStatusMark({ value }: { value: LanePickerValue }) {
	const color = MINE_STATUS_META.find((item) => item.key === value)?.dotColor;
	return (
		<span className="grid size-[22px] shrink-0 place-items-center">
			<span
				className="size-2 rounded-full"
				style={{ background: color ?? "var(--text-faint)" }}
			/>
		</span>
	);
}

export function SheetDrillInItem({
	icon,
	label,
	value,
	onClick,
}: {
	icon: ReactNode;
	label: string;
	value?: string;
	onClick: () => void;
}) {
	return (
		<SheetItem onClick={onClick}>
			{icon}
			<span>{label}</span>
			<span className="ml-auto flex min-w-0 items-center gap-1.5 text-supporting text-faint">
				{value && <span className="truncate">{value}</span>}
				<IconChevronRight size={20} />
			</span>
		</SheetItem>
	);
}

export function SheetPageHeader({
	title,
	onBack,
}: {
	title: string;
	onBack: () => void;
}) {
	return (
		<TopBar
			as="header"
			className="relative h-11 shrink-0 justify-center px-3"
		>
			<SheetIconButton
				className="absolute left-3"
				onClick={onBack}
				aria-label="Back to actions"
			>
				<IconChevronLeft size={24} />
			</SheetIconButton>
			<TopBarTitle className="text-section-title font-title text-fg">
				{title}
			</TopBarTitle>
		</TopBar>
	);
}

export function LanePickerPage({
	current,
	onBack,
	onSelect,
}: {
	current: LanePickerValue;
	onBack: () => void;
	onSelect: (status: MineStatus | null) => void;
}) {
	return (
		<>
			<SheetPageHeader title="Status" onBack={onBack} />
			<SheetBody>
				{MINE_STATUS_META.map((item) => (
					<SheetItem key={item.key} onClick={() => onSelect(item.key)}>
						<span
							className="size-2 shrink-0 rounded-full"
							style={{ background: item.dotColor }}
						/>
						{item.label}
						{current === item.key && (
							<IconCheck size={20} className="ml-auto text-dim" />
						)}
					</SheetItem>
				))}
				<SheetItem onClick={() => onSelect(null)}>
					<span className="size-2 shrink-0 rounded-full border border-line-strong" />
					Auto
					{current === null && (
						<IconCheck size={20} className="ml-auto text-dim" />
					)}
				</SheetItem>
			</SheetBody>
		</>
	);
}
