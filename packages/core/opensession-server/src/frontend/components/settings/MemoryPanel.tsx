import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { BASE_PATH } from "../../lib/base";
import {
	addMemoryEntryApi,
	deleteMemoryEntryApi,
	fetchMemory,
	relativeTime,
	updateMemoryEntryApi,
	type MemoryEntryDto,
	type MemoryScopeDto,
} from "../../lib/api";
import {
	markTileClass,
	markTileGradient,
	markTileInk,
	markTileShadow,
	type MarkTone,
} from "../../lib/mark-tile";
import { Button } from "../../ui/button";
import { Field, Select, Textarea } from "../../ui/input";
import { Modal } from "../../ui/modal";
import {
	SettingCard,
	SettingCardSkeleton,
	SettingsHeader,
	SettingsPanel,
} from "../../ui/settings";
import { EmptyState, InlineAlert } from "../../ui/state";
import { toast } from "../../ui/toast";
import {
	IconBranches,
	IconChevronLeft,
	IconChevronRight,
	IconGlobe,
	IconHash,
	IconPencil,
	IconPeople,
	IconPlus,
	IconTrash,
} from "../icons";
import { getCurrentUser } from "../UserPicker";

// Settings maintenance for the repo, user, workspace, and Slack channel stores
// behind the opensession-memory tools. This is only a different view over the
// existing scopes and CRUD routes; storage and prompt injection stay unchanged.

type MemoryKind = MemoryScopeDto["scope"]["kind"];

type MemoryCategory = {
	kind: MemoryKind;
	title: string;
	pageTitle: string;
	description: string;
	targetLabel: string;
	icon: typeof IconGlobe;
	tone: MarkTone;
};

const MEMORY_CATEGORIES: MemoryCategory[] = [
	{
		kind: "team",
		title: "Workspace",
		pageTitle: "Workspace memories",
		description: "Shared across the workspace and with public Slack memory.",
		targetLabel: "Workspace",
		icon: IconGlobe,
		tone: "indigo",
	},
	{
		kind: "repo",
		title: "Repositories",
		pageTitle: "Repository memories",
		description: "Used when a session works in that repository.",
		targetLabel: "Repository",
		icon: IconBranches,
		tone: "sky",
	},
	{
		kind: "user",
		title: "Team",
		pageTitle: "Team memories",
		description: "Follows the teammate prompting, including their Slack DM memory.",
		targetLabel: "Teammate",
		icon: IconPeople,
		tone: "green",
	},
	{
		kind: "channel",
		title: "Slack channels",
		pageTitle: "Slack channel memories",
		description: "Used within a specific Slack channel.",
		targetLabel: "Slack channel",
		icon: IconHash,
		tone: "orange",
	},
];

function CategoryIcon({ category }: { category: MemoryCategory }) {
	const size = 40;
	const Icon = category.icon;
	return (
		<span
			className={markTileClass(size)}
			style={{
				width: size,
				height: size,
				backgroundImage: markTileGradient(category.tone),
				color: "#fff",
				boxShadow: markTileShadow(markTileInk(category.tone)),
			}}
		>
			<Icon size={22} />
		</span>
	);
}

function memoryCount(scopes: MemoryScopeDto[]): number {
	return scopes.reduce((total, scoped) => total + scoped.entries.length, 0);
}

function CategoryCard({
	category,
	scopes,
	onOpen,
}: {
	category: MemoryCategory;
	scopes: MemoryScopeDto[];
	onOpen: () => void;
}) {
	const count = memoryCount(scopes);
	return (
		<SettingCard>
			<button
				type="button"
				className="focus-ring group flex w-full items-center gap-3 rounded-2xl px-5 py-4 text-left hover:bg-hover phone:items-start"
				onClick={onOpen}
			>
				<CategoryIcon category={category} />
				<span className="min-w-0 flex-1">
					<span className="block text-item-title font-semibold text-fg">{category.title}</span>
					<span className="mt-1 block text-supporting leading-relaxed text-dim">
						{category.description}
					</span>
					<span className="mt-1.5 hidden text-label font-medium text-dim phone:block">
						{count} {count === 1 ? "memory" : "memories"}
					</span>
				</span>
				<span className="flex shrink-0 items-center gap-2 self-center text-label font-medium text-dim phone:self-start phone:pt-2">
					<span className="phone:hidden">{count} {count === 1 ? "memory" : "memories"}</span>
					<IconChevronRight size={20} className="text-faint group-hover:text-dim" />
				</span>
			</button>
		</SettingCard>
	);
}

type MemoryTableRow = {
	scoped: MemoryScopeDto;
	entry: MemoryEntryDto;
};

function MemoryRow({
	row,
	showScope,
	onChanged,
}: {
	row: MemoryTableRow;
	showScope: boolean;
	onChanged: () => void;
}) {
	const [editing, setEditing] = useState(false);
	const [draft, setDraft] = useState(row.entry.text);
	const [busy, setBusy] = useState(false);
	const [expanded, setExpanded] = useState(false);
	const [canExpand, setCanExpand] = useState(false);
	const textRef = useRef<HTMLDivElement>(null);

	useLayoutEffect(() => {
		if (expanded || editing) return;
		const text = textRef.current;
		if (!text) return;
		const frame = requestAnimationFrame(() => {
			setCanExpand(text.scrollHeight > text.clientHeight + 1);
		});
		return () => cancelAnimationFrame(frame);
	}, [editing, expanded, row.entry.text]);

	async function save() {
		const text = draft.trim();
		if (!text || text === row.entry.text) {
			setEditing(false);
			return;
		}
		setBusy(true);
		try {
			await updateMemoryEntryApi(row.scoped.scope.key, row.entry.id, text);
			setEditing(false);
			onChanged();
		} catch (error: any) {
			toast(error?.message || "Failed to update memory", { variant: "error" });
		} finally {
			setBusy(false);
		}
	}

	async function remove() {
		setBusy(true);
		try {
			await deleteMemoryEntryApi(row.scoped.scope.key, row.entry.id);
			toast("Memory forgotten", { variant: "success" });
			onChanged();
		} catch (error: any) {
			toast(error?.message || "Failed to delete memory", { variant: "error" });
			setBusy(false);
		}
	}

	return (
		<tr className="border-t border-line align-top first:border-t-0 phone:grid phone:grid-cols-[minmax(0,1fr)_auto] phone:gap-x-3 phone:px-4 phone:py-3">
			{showScope && (
				<td className="w-32 px-4 py-3 text-label font-medium text-dim phone:col-start-1 phone:row-start-1 phone:w-auto phone:p-0">
					{row.scoped.scope.label}
				</td>
			)}
			<td className="px-4 py-3 phone:col-span-2 phone:row-start-2 phone:mt-1 phone:p-0">
				{editing ? (
					<div>
						<Textarea
							rows={3}
							value={draft}
							autoFocus
							onChange={(event) => setDraft(event.target.value)}
							onKeyDown={(event) => {
								if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) void save();
								if (event.key === "Escape") setEditing(false);
							}}
						/>
						<div className="mt-2 flex items-center gap-2">
							<Button size="sm" variant="primary" disabled={busy || !draft.trim()} onClick={() => void save()}>
								Save
							</Button>
							<Button size="sm" variant="ghost" disabled={busy} onClick={() => {
								setDraft(row.entry.text);
								setEditing(false);
							}}>
								Cancel
							</Button>
						</div>
					</div>
				) : (
					<div className={expanded ? "relative" : "group/memory relative"}>
						<div className={expanded ? "relative" : "relative h-[7.5em] overflow-hidden"}>
							<div
								ref={textRef}
								className={`whitespace-pre-wrap break-words text-supporting leading-relaxed text-fg ${expanded ? "" : "line-clamp-5"}`}
							>
								{row.entry.text}
							</div>
							{!expanded && canExpand && (
								<span
									aria-hidden="true"
									className="pointer-events-none absolute inset-x-0 bottom-0 h-10 bg-[linear-gradient(to_bottom,transparent,var(--settings-plate))]"
								/>
							)}
						</div>
						<div className="flex min-h-10 items-center justify-between gap-2">
							<div className="min-w-0">
								{!expanded && canExpand && (
									<button
										type="button"
										aria-expanded="false"
										className="focus-ring min-h-10 rounded-md border-0 bg-transparent px-0 text-meta font-semibold text-dim opacity-0 transition-opacity duration-150 hover:text-fg group-hover/memory:opacity-100 group-focus-within/memory:opacity-100 phone:opacity-100"
										onClick={() => setExpanded(true)}
									>
										Read all
									</button>
								)}
								{expanded && canExpand && (
									<button
										type="button"
										aria-expanded="true"
										className="focus-ring min-h-10 rounded-md border-0 bg-transparent px-0 text-meta font-semibold text-dim hover:text-fg"
										onClick={() => setExpanded(false)}
									>
										Show less
									</button>
								)}
							</div>
							<div className="ml-auto flex shrink-0 justify-end gap-1">
								<Button
									size="sm"
									variant="ghost"
									aria-label="Edit memory"
									className="size-10 min-h-10 phone:size-11 phone:min-h-11"
									icon={<IconPencil size={16} />}
									disabled={busy}
									onClick={() => {
										setDraft(row.entry.text);
										setEditing(true);
									}}
								/>
								<Button
									size="sm"
									variant="ghost"
									aria-label="Forget memory"
									className="size-10 min-h-10 hover:text-red phone:size-11 phone:min-h-11"
									icon={<IconTrash size={16} />}
									disabled={busy}
									onClick={() => void remove()}
								/>
							</div>
						</div>
					</div>
				)}
			</td>
			<td className="w-32 px-4 py-3 text-meta text-faint phone:col-start-1 phone:row-start-3 phone:mt-2 phone:w-auto phone:p-0">
				<div className="font-medium text-dim">{row.entry.by}</div>
				<div className="mt-0.5">{relativeTime(row.entry.at)}</div>
			</td>
		</tr>
	);
}

function MemoryTable({
	scopes,
	onChanged,
}: {
	scopes: MemoryScopeDto[];
	onChanged: () => void;
}) {
	const rows = scopes
		.flatMap((scoped) => scoped.entries.map((entry) => ({ scoped, entry })))
		.sort((left, right) => Date.parse(right.entry.at) - Date.parse(left.entry.at));
	const showScope = scopes.length > 1;

	if (!rows.length) {
		return <EmptyState placement="card">No memories in this category yet.</EmptyState>;
	}

	return (
		<SettingCard className="overflow-hidden">
			<div className="overflow-x-auto">
				<table className="w-full table-fixed border-collapse phone:block">
					<thead className="border-b border-line text-left text-label font-semibold text-faint phone:sr-only">
						<tr>
							{showScope && <th className="w-32 px-4 py-2.5">Scope</th>}
							<th className="px-4 py-2.5">Memory</th>
							<th className="w-32 px-4 py-2.5">Saved</th>
						</tr>
					</thead>
					<tbody className="phone:block">
						{rows.map((row) => (
							<MemoryRow
								key={`${row.scoped.scope.key}:${row.entry.id}`}
								row={row}
								showScope={showScope}
								onChanged={onChanged}
							/>
						))}
					</tbody>
				</table>
			</div>
		</SettingCard>
	);
}

function AddMemoryDialog({
	category,
	scopes,
	open,
	onOpenChange,
	onChanged,
}: {
	category: MemoryCategory;
	scopes: MemoryScopeDto[];
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onChanged: () => void;
}) {
	const [scopeKey, setScopeKey] = useState(scopes[0]?.scope.key || "");
	const [draft, setDraft] = useState("");
	const [busy, setBusy] = useState(false);

	useEffect(() => {
		if (open) {
			setScopeKey(scopes[0]?.scope.key || "");
			setDraft("");
		}
	}, [open, scopes]);

	async function add() {
		const text = draft.trim();
		if (!scopeKey || !text) return;
		setBusy(true);
		try {
			await addMemoryEntryApi(scopeKey, text, getCurrentUser() || "settings");
			toast("Memory saved", { variant: "success" });
			onOpenChange(false);
			onChanged();
		} catch (error: any) {
			toast(error?.message || "Failed to add memory", { variant: "error" });
		} finally {
			setBusy(false);
		}
	}

	return (
		<Modal.Root open={open} onOpenChange={onOpenChange}>
			<Modal.Content>
				<Modal.Header
					title={`Add ${category.title.toLowerCase()} memory`}
					description="Save a durable, self-contained fact for this scope."
				/>
				{scopes.length > 1 && (
					<Field label={category.targetLabel}>
						<Select value={scopeKey} onChange={(event) => setScopeKey(event.target.value)}>
							{scopes.map((scoped) => (
								<option key={scoped.scope.key} value={scoped.scope.key}>
									{scoped.scope.label}
								</option>
							))}
						</Select>
					</Field>
				)}
				<Field label="Memory">
					<Textarea
						rows={4}
						value={draft}
						autoFocus
						placeholder="A durable, self-contained fact…"
						onChange={(event) => setDraft(event.target.value)}
						onKeyDown={(event) => {
							if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) void add();
						}}
					/>
				</Field>
				<Modal.Footer>
					<Modal.Close render={<Button variant="ghost" disabled={busy}>Cancel</Button>} />
					<Button variant="primary" disabled={busy || !scopeKey || !draft.trim()} onClick={() => void add()}>
						{busy ? "Saving…" : "Save memory"}
					</Button>
				</Modal.Footer>
			</Modal.Content>
		</Modal.Root>
	);
}

function CategoryPage({
	category,
	scopes,
	onBack,
	onChanged,
}: {
	category: MemoryCategory;
	scopes: MemoryScopeDto[];
	onBack: () => void;
	onChanged: () => void;
}) {
	const [adding, setAdding] = useState(false);
	const count = memoryCount(scopes);
	const canAdd = scopes.length > 0;

	return (
		<SettingsPanel>
			<h2 className="relative z-20 m-0 hidden px-5 text-section-title font-semibold text-fg phone:block">
				{category.pageTitle}
			</h2>
			<SettingsHeader
				title={category.pageTitle}
				description={`${category.description} ${count} ${count === 1 ? "memory" : "memories"}.`}
				className="relative z-20 phone:mt-1.5"
			/>
			<div className="sticky top-0 z-10 mb-3 flex items-center justify-between gap-3 bg-surface px-5 py-2 before:pointer-events-none before:absolute before:inset-x-0 before:bottom-full before:h-11 before:bg-surface before:content-[''] after:pointer-events-none after:absolute after:inset-x-0 after:top-full after:h-6 after:bg-[linear-gradient(to_bottom,var(--bg),transparent)] after:content-[''] phone:before:h-4">
				<Button size="sm" variant="ghost" icon={<IconChevronLeft size={18} />} onClick={onBack}>
					Back
				</Button>
				<Button size="sm" icon={<IconPlus size={16} />} disabled={!canAdd} onClick={() => setAdding(true)}>
					Add memory
				</Button>
			</div>
			{!canAdd ? (
				<EmptyState placement="card">
					No {category.title.toLowerCase()} scopes exist yet. They appear here after that scope first stores a memory.
				</EmptyState>
			) : (
				<MemoryTable scopes={scopes} onChanged={onChanged} />
			)}
			<AddMemoryDialog
				category={category}
				scopes={scopes}
				open={adding}
				onOpenChange={setAdding}
				onChanged={onChanged}
			/>
		</SettingsPanel>
	);
}

export function MemoryPanel() {
	const [scopes, setScopes] = useState<MemoryScopeDto[] | null>(null);
	const [selectedKind, setSelectedKind] = useState<MemoryKind | null>(null);
	const [error, setError] = useState<string | null>(null);

	function reload() {
		fetchMemory()
			.then(async (response) => {
				// Configured Slack channels are valid memory scopes even before their
				// first entry creates a store file. Merge them into the UI model so the
				// existing POST /api/memory route can create that first entry without
				// any memory-storage or backend contract change.
				const channels = await fetch(`${BASE_PATH}/api/slack/channels`)
					.then((result) => result.ok ? result.json() : null)
					.then((body: { channels?: Array<{ id: string; name: string }> } | null) => body?.channels || [])
					.catch(() => []);
				const next = [...response.scopes];
				for (const channel of channels) {
					const key = `channel-${channel.id}`;
					if (!next.some((scoped) => scoped.scope.key === key)) {
						next.push({ scope: { key, kind: "channel", label: channel.name }, entries: [] });
					}
				}
				setScopes(next);
				setError(null);
			})
			.catch((fetchError) => setError(fetchError.message));
	}

	useEffect(reload, []);

	if (!scopes) {
		return (
			<SettingsPanel>
				<SettingsHeader
					title="Memories"
					description="Durable facts scoped to your workspace, repositories, team, and Slack channels."
				/>
				{error ? (
					<InlineAlert>{error}</InlineAlert>
				) : (
					<div className="grid gap-3">
						{MEMORY_CATEGORIES.map((category) => (
							<SettingCardSkeleton key={category.kind} rows={1} icon={40} label={`Loading ${category.title.toLowerCase()} memory`} />
						))}
					</div>
				)}
			</SettingsPanel>
		);
	}

	const selectedCategory = MEMORY_CATEGORIES.find((category) => category.kind === selectedKind);
	if (selectedCategory) {
		return (
			<CategoryPage
				category={selectedCategory}
				scopes={scopes.filter((scoped) => scoped.scope.kind === selectedCategory.kind)}
				onBack={() => setSelectedKind(null)}
				onChanged={reload}
			/>
		);
	}

	return (
		<SettingsPanel>
			<SettingsHeader
				title="Memories"
				description="Durable facts scoped to your workspace, repositories, team, and Slack channels."
			/>
			{error && <InlineAlert onDismiss={() => setError(null)}>{error}</InlineAlert>}
			<div className="grid gap-3">
				{MEMORY_CATEGORIES.map((category) => (
					<CategoryCard
						key={category.kind}
						category={category}
						scopes={scopes.filter((scoped) => scoped.scope.kind === category.kind)}
						onOpen={() => setSelectedKind(category.kind)}
					/>
				))}
			</div>
		</SettingsPanel>
	);
}
