import { useEffect, useMemo, useState } from "react";
import {
	fetchLibrary,
	type LibraryEntry,
	type LibraryEntryType,
} from "../../lib/api/library";
import { BASE_PATH } from "../../lib/base";
import { displayName } from "../../brand-logos";
import { IconTile } from "../BrandTile";
import { useIsPhone } from "../../hooks/useIsPhone";
import {
	onSidebarToolsChanged,
	readHiddenSidebarTools,
	setSidebarToolVisible,
	toolFitsViewport,
	type SidebarToolId,
} from "../../lib/sidebar-tools";
import {
	SettingCard,
	SettingRow,
	SettingRowControl,
	SettingRowDescription,
	SettingRowText,
	SettingRowTitle,
	SettingsGroupLabel,
	SettingsHeader,
	SettingsHint,
	SettingsPanel,
	settingsInputClass,
} from "../../ui/settings";
import { EmptyState, InlineAlert, LoadingState } from "../../ui/state";
import { Switch } from "../../ui/switch";

// ── The library: one browsable catalog over the things this instance can be
// extended with. The server derives it (src/server/library.ts) from the
// recipes directory, the automation templates and the integration registry,
// so a new recipe file shows up here without an edit in this file.
//
// Installing deliberately does NOT happen here — each type keeps the install
// path it already has (a config seed, a pre-filled create form, credentials in
// Setup), and the card links into it. The one exception is a core tool, whose
// switch is client state today; see the caveat rendered under that group. ──

const TYPE_ORDER: LibraryEntryType[] = ["tool", "automation", "integration"];

const TYPE_LABELS: Record<LibraryEntryType, string> = {
	tool: "Tools",
	automation: "Automations",
	integration: "Integrations",
};

const TYPE_BLURB: Record<LibraryEntryType, string> = {
	tool: "Tools appear in your sidebar.",
	automation: "A prompt and a trigger: a schedule, an event, or a webhook.",
	integration: "Outside systems this instance can listen to and act in.",
};

const FILTERS: { key: "all" | LibraryEntryType; label: string }[] = [
	{ key: "all", label: "Everything" },
	{ key: "tool", label: "Tools" },
	{ key: "automation", label: "Automations" },
	{ key: "integration", label: "Integrations" },
];

function StatusChip({ children, tone }: { children: string; tone: "on" | "off" }) {
	return (
		<span
			className={
				tone === "on"
					? "whitespace-nowrap rounded-full bg-green-soft px-2 py-0.5 text-label font-medium text-green"
					: "whitespace-nowrap rounded-full bg-hover px-2 py-0.5 text-label font-medium text-dim"
			}
		>
			{children}
		</span>
	);
}

function EntryControl({
	entry,
	toolVisible,
	onToggleTool,
}: {
	entry: LibraryEntry;
	toolVisible: boolean;
	onToggleTool: (visible: boolean) => void;
}) {
	if (entry.type === "tool")
		return (
			<Switch
				checked={toolVisible}
				onCheckedChange={onToggleTool}
				aria-label={`Show ${entry.name} in the sidebar`}
			/>
		);

	if (entry.installed)
		return <StatusChip tone="on">{entry.type === "integration" ? "Enabled" : "Installed"}</StatusChip>;

	return (
		<a
			className="whitespace-nowrap rounded-md border border-line px-2.5 py-1 text-xs font-medium text-fg no-underline hover:bg-hover"
			href={`${BASE_PATH}${entry.href}`}
		>
			{entry.install === "guided"
				? "Set up"
				: entry.install === "draft"
					? "Use"
					: "Add"}
		</a>
	);
}

export function LibraryPanel() {
	const isPhone = useIsPhone();
	const [entries, setEntries] = useState<LibraryEntry[] | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [query, setQuery] = useState("");
	const [filter, setFilter] = useState<"all" | LibraryEntryType>("all");
	const [hiddenTools, setHiddenTools] = useState<Set<SidebarToolId>>(() =>
		readHiddenSidebarTools(),
	);

	useEffect(() => {
		let alive = true;
		fetchLibrary()
			.then((list) => alive && setEntries(list))
			.catch((e) => alive && setError(e.message));
		return () => {
			alive = false;
		};
	}, []);

	// Another surface (the sidebar's ••• menu, Settings) can flip the same
	// switches, so mirror rather than own the state.
	useEffect(() => onSidebarToolsChanged(() => setHiddenTools(readHiddenSidebarTools())), []);

	const groups = useMemo(() => {
		const needle = query.trim().toLowerCase();
		const matched = (entries || []).filter((entry) => {
			// A tool this width never shows can't be switched on here either.
			if (
				entry.type === "tool" &&
				!toolFitsViewport(entry.slug as SidebarToolId, isPhone)
			)
				return false;
			if (filter !== "all" && entry.type !== filter) return false;
			if (!needle) return true;
			return (
				entry.name.toLowerCase().includes(needle) ||
				entry.description.toLowerCase().includes(needle) ||
				entry.category.toLowerCase().includes(needle)
			);
		});
		return TYPE_ORDER.map((type) => ({
			type,
			entries: matched.filter((entry) => entry.type === type),
		})).filter((group) => group.entries.length > 0);
	}, [entries, query, filter, isPhone]);

	const header = (
		<SettingsHeader
			title="Library"
			description="Add tools, automations, and integrations to this instance. Nothing is on until you add it."
		/>
	);

	if (error)
		return (
			<SettingsPanel>
				{header}
				<InlineAlert>{error}</InlineAlert>
			</SettingsPanel>
		);

	if (!entries)
		return (
			<SettingsPanel>
				{header}
				<LoadingState>Loading the library…</LoadingState>
			</SettingsPanel>
		);

	return (
		<SettingsPanel>
			{header}

			<div className="flex flex-wrap items-center gap-2">
				<input
					className={`${settingsInputClass} min-w-0 flex-1`}
					placeholder="Search"
					value={query}
					onChange={(e) => setQuery(e.target.value)}
				/>
				<div className="flex shrink-0 items-center gap-1">
					{FILTERS.map((option) => (
						<button
							key={option.key}
							type="button"
							onClick={() => setFilter(option.key)}
							className={
								filter === option.key
									? "rounded-md bg-active px-2.5 py-1.5 text-xs font-medium text-fg"
									: "rounded-md px-2.5 py-1.5 text-xs font-medium text-dim hover:bg-hover hover:text-fg"
							}
						>
							{option.label}
						</button>
					))}
				</div>
			</div>

			{groups.length === 0 && (
				<EmptyState>Nothing in the library matches that.</EmptyState>
			)}

			{groups.map((group) => (
				<div key={group.type}>
					<SettingsGroupLabel>{TYPE_LABELS[group.type]}</SettingsGroupLabel>
					<SettingCard>
						{group.entries.map((entry) => {
							const visible =
								entry.type === "tool" &&
								!hiddenTools.has(entry.slug as SidebarToolId);
							return (
								<SettingRow key={entry.id}>
									{/* Only integrations have a brand to show; a letter tile next to
									    "Tasks" would be noise rather than recognition. */}
									{entry.type === "integration" && (
										<IconTile name={entry.slug} size={30} />
									)}
									<SettingRowText>
										<SettingRowTitle>
											<span className="flex flex-wrap items-center gap-2">
												{entry.name}
												{entry.source === "repo" && (
													<span className="rounded-full bg-hover px-2 py-0.5 text-label font-medium text-dim">
														Recipe
													</span>
												)}
												{entry.install === "draft" && (
													<span className="rounded-full bg-hover px-2 py-0.5 text-label font-medium text-dim">
														Template
													</span>
												)}
											</span>
										</SettingRowTitle>
										<SettingRowDescription>
											{entry.description}
											{entry.requires?.length
												? ` Needs ${entry.requires.map(displayName).join(" and ")}.`
												: ""}
										</SettingRowDescription>
									</SettingRowText>
									<SettingRowControl>
										<EntryControl
											entry={entry}
											toolVisible={visible}
											onToggleTool={(next) =>
												setSidebarToolVisible(entry.slug as SidebarToolId, next)
											}
										/>
									</SettingRowControl>
								</SettingRow>
							);
						})}
					</SettingCard>
					<SettingsHint>
						{group.type === "tool" ? (
							<>
								{TYPE_BLURB.tool} These switches are saved in this browser only,
								and a tool you turn off still sends its reminders and
								notifications.
							</>
						) : (
							TYPE_BLURB[group.type]
						)}
					</SettingsHint>
				</div>
			))}
		</SettingsPanel>
	);
}
