import type { FilterState, GroupBy, PrsFilter, SortBy } from "../../lib/sidebar-filter";
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
			<div className="menu-backdrop" onClick={onClose} />
			<div className="filter-popover" style={{ left, top, width }}>
				<div className="filter-row">
					<span className="filter-row-label">Group by</span>
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
				<div className="filter-row">
					<span className="filter-row-label">Repo</span>
					<MiniSelect
						value={filter.repo}
						options={repoOptions}
						onSelect={(v) => onChange({ repo: v })}
					/>
				</div>
				<div className="filter-row">
					<span className="filter-row-label">Person</span>
					<MiniSelect
						value={filter.person}
						options={personOptions}
						onSelect={(v) => onChange({ person: v })}
					/>
				</div>
				{/* Session-less PR rows in the project lanes (the dissolved PR
				    band): whose PRs surface. */}
				<div className="filter-row">
					<span className="filter-row-label">Pull requests</span>
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
				<div className="filter-row">
					<span className="filter-row-label">Sort by</span>
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
					className="menu-backdrop menu-backdrop--nested"
					onClick={() => setOpen(false)}
				/>
				<div
					className="mini-select-menu"
					style={{ left, top: r.bottom + 4, minWidth: menuW }}
				>
					{options.map((o) => (
						<button
							key={o.value}
							className={`mini-select-item${o.value === value ? " selected" : ""}`}
							onClick={() => {
								onSelect(o.value);
								setOpen(false);
							}}
						>
							{o.icon}
							<span className="mini-select-item-text">{o.label}</span>
							{o.value === value && (
								<svg
									className="mini-select-check"
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
		<div className="mini-select-wrap">
			<button
				ref={btnRef}
				className="mini-select"
				onClick={() => setOpen((o) => !o)}
			>
				<span className="mini-select-value">
					{current?.icon}
					<span className="mini-select-text">{current?.label ?? value}</span>
				</span>
				<svg
					className="mini-select-caret"
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
				<div className="menu-backdrop" onClick={() => setOpen(false)} />
				<div
					className="mini-select-menu"
					style={{ left, top: r.bottom + 5, minWidth: menuW }}
				>
					{options.map((o) => (
						<button
							key={o.value}
							className={`mini-select-item${o.value === repo ? " selected" : ""}`}
							onClick={() => {
								onSelect?.(o.value);
								setOpen(false);
							}}
						>
							{o.icon}
							<span className="mini-select-item-text">{o.label}</span>
							{o.value === repo && (
								<svg
									className="mini-select-check"
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
				"sidebar-repo-chip inline-flex min-w-0 max-w-full items-center gap-px rounded-full border border-line bg-panel px-1 py-[3px] text-[13px] leading-[1.15]",
				variant === "inline" && "shrink-0 max-w-none",
				variant === "probe" && "pointer-events-none absolute left-[-9999px] top-0 max-w-none invisible",
				variant === "inline" && "sidebar-repo-chip--inline",
				variant === "probe" && "sidebar-repo-chip--probe",
			)}
			aria-hidden={probe || undefined}
		>
			{/* Body opens the repo dropdown; the × clears the filter. */}
			<button
				type="button"
				ref={bodyRef}
				className="sidebar-repo-chip-open inline-flex min-w-0 items-center gap-[7px] rounded-full px-[3px] py-0.5 hover:bg-hover"
				title="Switch repo"
				tabIndex={probe ? -1 : undefined}
				onClick={probe ? undefined : () => setOpen((o) => !o)}
			>
				<RepoTile name={repo} />
				<span className="min-w-0 truncate text-dim">{repoLabel(repo)}</span>
			</button>
			<button
				type="button"
				className="sidebar-repo-chip-x inline-flex size-[19px] shrink-0 items-center justify-center rounded-full text-[14px] leading-none text-faint hover:bg-hover hover:text-fg"
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
