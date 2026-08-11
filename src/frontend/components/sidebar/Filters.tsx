import type { FilterState, GroupBy, PrsFilter, SortBy } from "../../lib/sidebar-filter";
import { SIDEBAR_HOVER_LAYER } from "../../lib/sidebar-classes";
import type { Group } from "../../lib/sidebar-types";
import { cn } from "../../ui/cn";
import { RepoTile, repoLabel } from "../RepoTile";
import { UserAvatar } from "../UserAvatar";
import React, { useRef, useState } from "react";
import { createPortal } from "react-dom";

// ── Filter popover ─────────────────────────────────────────────────────────
// A small floating panel (anchored under the filter button) with three controls:
// Group by (Status / Repo), Repo (All repos + one per repo), and Sort by
// (Updated / Created). Rendered in a portal so it can overflow the narrow sidebar.

interface SelectOption {
	value: string;
	label: string;
	icon?: React.ReactNode;
}

/** Full-screen transparent catcher that closes a popover/menu on outside
 *  click. The nested one sits above the popover it opens out of, so its z-index
 *  is written out rather than layered on top of the base string — two `z-*`
 *  utilities on one element would leave the winner to Tailwind's output order. */
const BACKDROP = "fixed inset-0 z-[300]";
const BACKDROP_NESTED = "fixed inset-0 z-[320]";

/** The filter panel itself (group / repo / person / PRs / sort), portalled and
 *  fixed-positioned at the anchor. Same entrance and shadow as MINI_MENU below;
 *  one step rounder, and it sits under the menus it opens. */
const FILTER_POPOVER =
	"fixed z-[301] flex flex-col gap-2.5 rounded-[calc(12px*var(--rf))] border border-line-strong bg-popup " +
	"px-3.5 py-3 shadow-[0_12px_34px_rgba(0,0,0,0.4)] animate-[hovercard-in_var(--dur-micro)_var(--ease)]";

/** One labelled control per row: the label holds its width, the select takes
 *  the rest. */
const FILTER_ROW = "flex items-center justify-between gap-3.5";
const FILTER_ROW_LABEL = "shrink-0 text-body text-dim";

export function FilterPopover({
	anchor,
	filter,
	repos,
	people,
	currentUser,
	onChange,
	onClose,
}: {
	anchor: HTMLElement | null;
	filter: FilterState;
	repos: string[];
	people: Array<{ key: string; label: string }>;
	currentUser: string;
	onChange: (patch: Partial<FilterState>) => void;
	onClose: () => void;
}) {
	if (!anchor) return null;
	const r = anchor.getBoundingClientRect();
	const width = 290;
	const left = Math.max(8, Math.min(r.left, window.innerWidth - width - 8));
	const top = r.bottom + 6;

	const repoOptions: SelectOption[] = [
		{ value: "all", label: "All repos" },
		...repos.map((name) => ({
			value: name,
			label: repoLabel(name),
			icon: <RepoTile name={name} />,
		})),
	];

	// You first (the default), then teammates, the aggregate Backlog lens, and
	// "Everyone" last. Owner-focused views retain their own Backlog rows.
	const meKey = currentUser.toLowerCase();
	const personAvatar = (name: string) => <UserAvatar name={name} size={16} />;
	const personOptions: SelectOption[] = [
		{ value: "me", label: `${currentUser} (you)`, icon: personAvatar(currentUser) },
		...people
			.filter(({ key }) => key !== meKey)
			.map(({ key, label }) => ({
				value: key,
				label,
				icon: personAvatar(label),
			})),
		{ value: "unassigned", label: "Unassigned" },
		{ value: "everyone", label: "Everyone" },
	];

	return createPortal(
		<>
			<div className={BACKDROP} onClick={onClose} />
			<div className={FILTER_POPOVER} style={{ left, top, width }}>
				<div className={FILTER_ROW}>
					<span className={FILTER_ROW_LABEL}>Group by</span>
					<MiniSelect
						value={filter.groupBy}
						options={[
							{ value: "status", label: "Status" },
							{ value: "repo", label: "Project" },
							{ value: "repo-status", label: "Project and status" },
							{ value: "repo-inbox", label: "Project and inbox" },
							{ value: "inbox", label: "Inbox" },
						]}
						onSelect={(v) => onChange({ groupBy: v as GroupBy })}
					/>
				</div>
				<div className={FILTER_ROW}>
					<span className={FILTER_ROW_LABEL}>Repo</span>
					<MiniSelect
						value={filter.repo}
						options={repoOptions}
						onSelect={(v) => onChange({ repo: v })}
					/>
				</div>
				<div className={FILTER_ROW}>
					<span className={FILTER_ROW_LABEL}>Person</span>
					<MiniSelect
						value={filter.person}
						options={personOptions}
						onSelect={(v) => onChange({ person: v })}
					/>
				</div>
				{/* Session-less PR rows in the project lanes (the dissolved PR
				    band): whose PRs surface. */}
				<div className={FILTER_ROW}>
					<span className={FILTER_ROW_LABEL}>Pull requests</span>
					<MiniSelect
						value={filter.prs}
						options={[
							{ value: "default", label: "Mine + requested" },
							{ value: "all", label: "Everyone's" },
							{ value: "none", label: "Hidden" },
						]}
						onSelect={(v) => onChange({ prs: v as PrsFilter })}
					/>
				</div>
				<div className={FILTER_ROW}>
					<span className={FILTER_ROW_LABEL}>Sort by</span>
					<MiniSelect
						value={filter.sort}
						options={[
							{ value: "updated", label: "Updated" },
							{ value: "created", label: "Created" },
						]}
						onSelect={(v) => onChange({ sort: v as SortBy })}
					/>
				</div>
			</div>
		</>,
		document.body,
	);
}

/** The dropdown menu shared by MiniSelect and the repo chip: portalled, so it
 *  escapes both the filter popover and the narrow sidebar. */
const MINI_MENU =
	"fixed z-[321] max-h-[60vh] overflow-y-auto rounded-control border border-line-strong bg-popup p-[5px] shadow-[0_12px_34px_rgba(0,0,0,0.4)] animate-[hovercard-in_var(--dur-micro)_var(--ease)]";

/** One row of that menu. The hover is a layer (SIDEBAR_HOVER_LAYER), so it
 *  adds to the selected row's wash instead of replacing it — which is what the
 *  old `hover:bg-pressed` on the selected branch was standing in for. */
const MINI_MENU_ITEM =
	"flex w-full items-center gap-[9px] rounded-md px-[9px] py-2 text-left text-body text-fg";

function miniMenuItem(selected: boolean) {
	return cn(MINI_MENU_ITEM, SIDEBAR_HOVER_LAYER, selected && "bg-pressed");
}

// A styled dropdown used by the filter popover. Its menu is portaled so it can
// escape both the popover and the sidebar; a transparent backdrop closes it.
function MiniSelect({
	value,
	options,
	onSelect,
}: {
	value: string;
	options: SelectOption[];
	onSelect: (value: string) => void;
}) {
	const [open, setOpen] = useState(false);
	const btnRef = useRef<HTMLButtonElement>(null);
	const current = options.find((o) => o.value === value);
	const r = open && btnRef.current ? btnRef.current.getBoundingClientRect() : null;

	let menu: React.ReactNode = null;
	if (open && r) {
		const menuW = Math.max(r.width, 150);
		const left = Math.max(8, Math.min(r.left, window.innerWidth - menuW - 8));
		menu = createPortal(
			<>
				<div
					className={BACKDROP_NESTED}
					onClick={() => setOpen(false)}
				/>
				<div
					className={MINI_MENU}
					style={{ left, top: r.bottom + 4, minWidth: menuW }}
				>
					{options.map((o) => (
						<button
							key={o.value}
							className={miniMenuItem(o.value === value)}
							onClick={() => {
								onSelect(o.value);
								setOpen(false);
							}}
						>
							{o.icon}
							<span className="min-w-0 flex-1 truncate">{o.label}</span>
							{o.value === value && (
								<svg
									className="shrink-0 text-dim"
									width="17"
									height="17"
									viewBox="0 0 16 16"
									fill="none"
								>
									<path
										d="M3.5 8.5l3 3 6-7"
										stroke="currentColor"
										strokeWidth="1.6"
										strokeLinecap="round"
										strokeLinejoin="round"
									/>
								</svg>
							)}
						</button>
					))}
				</div>
			</>,
			document.body,
		);
	}

	return (
		<div className="relative">
			<button
				ref={btnRef}
				className="flex min-w-[148px] cursor-pointer items-center gap-2 rounded-md border border-line-strong bg-panel py-2 pl-3 pr-2.5 text-body text-fg hover:bg-hover"
				onClick={() => setOpen((o) => !o)}
			>
				<span className="flex min-w-0 flex-1 items-center gap-[7px]">
					{current?.icon}
					<span className="truncate">{current?.label ?? value}</span>
				</span>
				<svg
					className="shrink-0 text-faint"
					width="16"
					height="16"
					viewBox="0 0 16 16"
					fill="none"
				>
					<path
						d="M5 6.5L8 3.5l3 3M5 9.5l3 3 3-3"
						stroke="currentColor"
						strokeWidth="1.4"
						strokeLinecap="round"
						strokeLinejoin="round"
					/>
				</svg>
			</button>
			{menu}
		</div>
	);
}

// The removable "active repo filter" chip. Rendered in three variants:
// "inline" (in the header, behind the title), "row" (its own line under the
// header) and "probe" (an off-layout copy used only to measure natural width —
// non-interactive and hidden from a11y).
export const RepoFilterChip = React.forwardRef<
	HTMLSpanElement,
	{
		repo: string;
		repos?: string[];
		onClear?: () => void;
		onSelect?: (repo: string) => void;
		variant: "inline" | "row" | "probe";
	}
>(function RepoFilterChip({ repo, repos = [], onClear, onSelect, variant }, ref) {
	const probe = variant === "probe";
	const [open, setOpen] = useState(false);
	const bodyRef = useRef<HTMLButtonElement>(null);
	const r = open && bodyRef.current ? bodyRef.current.getBoundingClientRect() : null;

	// Repo dropdown, opened straight off the chip body (no detour through the
	// filter popover). "All repos" clears the filter; reuses the MiniSelect menu.
	let menu: React.ReactNode = null;
	if (open && r) {
		const options: SelectOption[] = [
			{ value: "all", label: "All repos" },
			...repos.map((name) => ({
				value: name,
				label: repoLabel(name),
				icon: <RepoTile name={name} />,
			})),
		];
		const menuW = Math.max(r.width, 170);
		const left = Math.max(8, Math.min(r.left, window.innerWidth - menuW - 8));
		menu = createPortal(
			<>
				<div className={BACKDROP} onClick={() => setOpen(false)} />
				<div
					className={MINI_MENU}
					style={{ left, top: r.bottom + 5, minWidth: menuW }}
				>
					{options.map((o) => (
						<button
							key={o.value}
							className={miniMenuItem(o.value === repo)}
							onClick={() => {
								onSelect?.(o.value);
								setOpen(false);
							}}
						>
							{o.icon}
							<span className="min-w-0 flex-1 truncate">{o.label}</span>
							{o.value === repo && (
								<svg
									className="shrink-0 text-dim"
									width="17"
									height="17"
									viewBox="0 0 16 16"
									fill="none"
								>
									<path
										d="M3.5 8.5l3 3 6-7"
										stroke="currentColor"
										strokeWidth="1.6"
										strokeLinecap="round"
										strokeLinejoin="round"
									/>
								</svg>
							)}
						</button>
					))}
				</div>
			</>,
			document.body,
		);
	}

	return (
		<span
			ref={ref}
			className={cn(
				"inline-flex min-w-0 max-w-full items-center gap-px rounded-full border border-line bg-panel px-1 py-[3px] text-label leading-[1.15]",
				variant === "inline" && "shrink-0 max-w-none",
				variant === "probe" && "pointer-events-none absolute left-[-9999px] top-0 max-w-none invisible",
			)}
			aria-hidden={probe || undefined}
		>
			{/* Body opens the repo dropdown; the × clears the filter. */}
			<button
				type="button"
				ref={bodyRef}
				className="inline-flex min-w-0 items-center gap-[7px] rounded-full px-[3px] py-0.5 text-label leading-[1.15] hover:bg-hover"
				title="Switch repo"
				tabIndex={probe ? -1 : undefined}
				onClick={probe ? undefined : () => setOpen((o) => !o)}
			>
				{/* One step down from the tile's 18px default, so the pill stays
				    the height of the text beside it. */}
				<RepoTile name={repo} size={17} />
				<span className="min-w-0 truncate text-dim">{repoLabel(repo)}</span>
			</button>
			<button
				type="button"
				className="inline-flex size-[19px] shrink-0 items-center justify-center rounded-full text-body leading-none text-faint hover:bg-hover hover:text-fg"
				title="Clear repo filter"
				tabIndex={probe ? -1 : undefined}
				onClick={probe ? undefined : onClear}
			>
				×
			</button>
			{menu}
		</span>
	);
});
