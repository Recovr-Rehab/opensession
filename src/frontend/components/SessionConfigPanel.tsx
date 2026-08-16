import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import {
	fetchSessionEffectiveConfig,
	relativeTime,
	type EffectiveConfigRow,
	type EffectiveConfigSection,
	type EffectiveStrippedTool,
	type SessionEffectiveConfig,
} from "../lib/api";
import {
	formatConfigValue,
	groupMcpExclusions,
	mcpCounts,
	mcpScopeSummary,
	type McpExclusionGroup,
} from "../lib/effective-config-format";
import {
	INFO_LABEL_CLASS,
	INFO_LIST_CLASS,
	INFO_SECTION_CLASS,
} from "../lib/session-viewer-classes";
import { Badge } from "../ui/badge";
import { cn } from "../ui/cn";
import { Collapsible, collapsiblePanelClasses } from "../ui/collapsible";
import { InlineAlert, LoadingState } from "../ui/state";
import { IconChevronRight } from "./icons";
import { getCurrentUser } from "./UserPicker";

/**
 * Effective config — a section of the session Info panel that answers the two
 * questions people actually arrive with: "why can this session not see tool
 * X" and "what model and account will the next turn really use".
 *
 * It reads GET /api/sessions/:id/effective-config (docs/effective-config.md),
 * which composes the real resolvers rather than restating them. That is also
 * why it is fetched on OPEN and never on render: the endpoint peeks the
 * account pool, filters the MCP catalog and evaluates the run gate, so a
 * session render must not pay for it.
 *
 * Ordering is the questions, not the payload: MCP visibility first, the model
 * route and account second, everything else behind a closed label. Every row
 * carries the file or code path that decided it, muted under the value —
 * without it a reader has a fact and nowhere to go to change it.
 *
 * Read-only by construction: the panel renders the dump and offers a refresh.
 * Nothing here writes.
 */

/** Rows inside a plate, at the panel's 12px content inset (4 of plate padding
    plus 8 here — the same arithmetic as INFO_LIST_CLASS + a `px-2` row). */
const ROW = "px-2 py-[5px]";

/** One more row in the plate, matching the Info panel's other "show the rest"
    affordances (INFO_MORE_BUTTON_CLASS in WorkspaceInfo). */
const MORE_ROW =
	"cursor-pointer bg-panel px-2 py-[7px] text-left text-label font-semibold text-faint transition-colors hover:bg-hover hover:text-fg";

/** How many rows of a long list stand in for it before "Show all". */
const PREVIEW = 6;

/**
 * A section of this panel that opens in place: the Info panel's own faint
 * label over its borderless plate, with the label doing the opening.
 *
 * Deliberately not `ui/disclosure.tsx`, whose trigger is a foreground-weight
 * row and whose panel pads its own children — both fight the label-over-plate
 * grammar every other section in this panel uses. It composes the same parts
 * from `ui/collapsible`, so the aria wiring and the measured-height animation
 * are the primitive's rather than a hand-rolled copy. The chevron sits on the
 * right so the label keeps the x every other label in the panel is aligned to.
 */
function ConfigSection({
	label,
	count,
	open,
	defaultOpen,
	onOpenChange,
	children,
}: {
	label: ReactNode;
	/** Answered at a glance, before anything opens. */
	count?: ReactNode;
	open?: boolean;
	defaultOpen?: boolean;
	onOpenChange?: (open: boolean) => void;
	children: ReactNode;
}) {
	return (
		<Collapsible.Root
			open={open}
			defaultOpen={defaultOpen}
			onOpenChange={(next) => onOpenChange?.(next)}
			className={INFO_SECTION_CLASS}
		>
			<Collapsible.Trigger
				className={cn(
					INFO_LABEL_CLASS,
					"focus-ring group flex w-full items-center gap-2 rounded-control py-0.5 text-left transition-colors hover:text-fg",
				)}
			>
				<span className="min-w-0 truncate">{label}</span>
				<span className="ml-auto flex shrink-0 items-center gap-1.5 tabular-nums">
					{count}
					<IconChevronRight
						size={12}
						className="shrink-0 transition-transform duration-[var(--dur-micro)] ease-[var(--ease)] group-data-[panel-open]:rotate-90"
					/>
				</span>
			</Collapsible.Trigger>
			<Collapsible.Panel className={collapsiblePanelClasses}>
				{children}
			</Collapsible.Panel>
		</Collapsible.Root>
	);
}

/** A row the dispatch can still re-resolve. The endpoint's own caveat, carried
    to the rows it is about instead of only sitting at the bottom. */
function Forecast() {
	return (
		<Badge
			tone="info"
			variant="outline"
			title="A forecast: this is re-resolved when the turn actually starts"
		>
			forecast
		</Badge>
	);
}

/** Value, then the file or code path that decided it. */
function ConfigRowView({
	label,
	row,
}: {
	label: string;
	row?: EffectiveConfigRow;
}) {
	if (!row) return null;
	// A list is rendered as lines: a dump's arrays are sets of names (required
	// models, memory scopes, instruction sources) that read as a stack, not as
	// one long comma sentence in a 300px panel.
	const list = Array.isArray(row.value) ? (row.value as unknown[]) : null;
	return (
		<div className={ROW}>
			<div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
				<span className="text-label text-dim">{label}</span>
				{(!list || list.length === 0) && (
					<span className="min-w-0 break-words text-label font-medium text-fg">
						{formatConfigValue(row.value)}
					</span>
				)}
				{row.stability === "load-dependent" && <Forecast />}
			</div>
			{list && list.length > 0 && (
				<ul className="m-0 mt-1 grid list-none gap-0.5 p-0">
					{list.map((item, i) => (
						<li key={i} className="break-words text-label text-fg">
							{formatConfigValue(item)}
						</li>
					))}
				</ul>
			)}
			<div className="mt-0.5 break-words text-meta leading-snug text-faint">
				{row.source}
			</div>
			{row.note && (
				<div className="mt-0.5 break-words text-meta leading-snug text-dim">
					{row.note}
				</div>
			)}
		</div>
	);
}

/** Every row of a section, in the order the server sent them. */
function SectionRows({ section }: { section?: EffectiveConfigSection }) {
	if (!section) return null;
	return (
		<>
			{Object.entries(section).map(([key, row]) => (
				<ConfigRowView key={key} label={rowLabel(key)} row={row} />
			))}
		</>
	);
}

/** camelCase key → sentence-case label ("poolDryReason" → "Pool dry reason"). */
function rowLabel(key: string): string {
	const words = key.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase();
	return words.charAt(0).toUpperCase() + words.slice(1);
}

/** The servers one gate hid, with that gate stated once. */
function ExclusionGroupRow({ group }: { group: McpExclusionGroup }) {
	return (
		<div className={ROW}>
			<div className="break-words text-label text-fg">{group.reason}</div>
			<ServerChips
				servers={group.names.map((name) => ({
					name,
					title: `${group.transports[name] ?? "unknown"} server`,
				}))}
			/>
			{group.sources.map((source) => (
				<div
					key={source}
					className="mt-1 break-words text-meta leading-snug text-faint"
				>
					{source}
				</div>
			))}
		</div>
	);
}

/** The servers the run can see. Names only: the allowlist row above already
    states the rule once, and repeating it on sixteen rows says nothing. */
function ServerChips({
	servers,
}: {
	servers: Array<{ name: string; title?: string }>;
}) {
	return (
		<div className="mt-1 flex flex-wrap gap-1">
			{servers.map((server) => (
				<Badge key={server.name} title={server.title}>
					{server.name}
				</Badge>
			))}
		</div>
	);
}

function StrippedToolRows({ tools }: { tools: EffectiveStrippedTool[] }) {
	const [expanded, setExpanded] = useState(false);
	const shown = expanded ? tools : tools.slice(0, PREVIEW);
	return (
		<>
			{shown.map((tool) => (
				<div key={tool.tool} className={ROW}>
					<div className="break-words text-label font-medium text-fg">
						{tool.tool}
					</div>
					<div className="mt-0.5 break-words text-meta leading-snug text-dim">
						{tool.reason}
					</div>
					<div className="mt-0.5 break-words text-meta leading-snug text-faint">
						{tool.source}
					</div>
				</div>
			))}
			{tools.length > PREVIEW && (
				<button
					type="button"
					className={MORE_ROW}
					onClick={() => setExpanded((value) => !value)}
				>
					{expanded ? "Show fewer tools" : `Show all ${tools.length} tools`}
				</button>
			)}
		</>
	);
}

export function SessionConfigPanel({ sessionId }: { sessionId: string }) {
	const [open, setOpen] = useState(false);
	const [data, setData] = useState<SessionEffectiveConfig | null>(null);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	// Only the newest request may land: a refresh during a slow one, or a
	// session switch while either is in flight.
	const requestRef = useRef(0);

	const load = useCallback(() => {
		const request = ++requestRef.current;
		setLoading(true);
		setError(null);
		fetchSessionEffectiveConfig(sessionId, getCurrentUser())
			.then((config) => {
				if (requestRef.current !== request) return;
				setData(config);
				setLoading(false);
			})
			.catch((cause: unknown) => {
				if (requestRef.current !== request) return;
				setError(
					cause instanceof Error ? cause.message : "Could not read the config",
				);
				setLoading(false);
			});
	}, [sessionId]);

	// A different session is a different answer: drop what we read, and close,
	// so nothing is ever shown under the wrong session's name.
	useEffect(() => {
		requestRef.current++;
		setOpen(false);
		setData(null);
		setError(null);
		setLoading(false);
	}, [sessionId]);

	function toggle(next: boolean) {
		setOpen(next);
		if (next && !data && !loading) load();
	}

	const counts = data ? mcpCounts(data.mcp.servers) : null;
	const excludedGroups = data ? groupMcpExclusions(data.mcp.servers) : [];
	const included = data?.mcp.servers.filter((server) => server.included) ?? [];
	const stripped =
		(data?.tools.stripped?.value as EffectiveStrippedTool[] | undefined) ?? [];
	const inProcess =
		(data?.mcp.inProcess.servers?.value as string[] | undefined) ?? [];

	return (
		<ConfigSection
			label="Effective config"
			count={
				counts ? (
					<span className="text-faint">
						{counts.included}/{counts.total} servers
					</span>
				) : undefined
			}
			open={open}
			onOpenChange={toggle}
		>
			<div className="grid gap-4">
				{loading && !data && (
					<div className={INFO_LIST_CLASS}>
						<LoadingState placement="row" className="px-2 py-2">
							Resolving this session's next turn…
						</LoadingState>
					</div>
				)}
				{error && !data && (
					<InlineAlert onRetry={load} retryLabel="Try again">
						{error}
					</InlineAlert>
				)}
				{data && (
					<>
						{error && (
							<InlineAlert variant="warn" onRetry={load}>
								Could not refresh: {error}
							</InlineAlert>
						)}

						{/* The hero: what this run can and cannot see. */}
						<div className={INFO_SECTION_CLASS}>
							<div
								className={cn(
									INFO_LABEL_CLASS,
									"flex items-center justify-between gap-2",
								)}
							>
								<span>MCP servers</span>
								<span className="tabular-nums">
									{counts?.included} of {counts?.total}
								</span>
							</div>
							<div className={INFO_LIST_CLASS}>
								<div className={ROW}>
									<div className="break-words text-label font-medium text-fg">
										{mcpScopeSummary(data.mcp.scope.value)}
									</div>
									<div className="mt-0.5 break-words text-meta leading-snug text-faint">
										{data.mcp.scope.source}
									</div>
								</div>
								{counts !== null && counts.excluded > 0 && (
									<>
										<div className={cn(ROW, "pb-0 pt-2 text-meta text-faint")}>
											Not visible to this run · {counts.excluded}
										</div>
										{excludedGroups.map((group) => (
											<ExclusionGroupRow
												key={group.reason}
												group={group}
											/>
										))}
									</>
								)}
								<div className={cn(ROW, "pt-2")}>
									<div className="text-meta text-faint">
										Visible · {included.length}
									</div>
									{included.length > 0 ? (
										<ServerChips
											servers={included.map((server) => ({
												name: server.name,
												title: server.reason,
											}))}
										/>
									) : (
										<div className="mt-1 text-label text-fg">
											No external MCP server reaches this run
										</div>
									)}
								</div>
								<div className={cn(ROW, "pt-2")}>
									<div className="text-meta text-faint">
										In-process ({formatConfigValue(
											data.mcp.inProcess.branch?.value,
										)}
										) · {inProcess.length}
									</div>
									{inProcess.length > 0 ? (
										<ServerChips
											servers={inProcess.map((name) => ({ name }))}
										/>
									) : (
										<div className="mt-1 text-label text-fg">
											None — the self-management servers are withheld from this
											run
										</div>
									)}
									<div className="mt-1 break-words text-meta leading-snug text-faint">
										{data.mcp.inProcess.servers?.source}
									</div>
								</div>
							</div>
						</div>

						{/* Second question: what will actually answer the next prompt. */}
						<div className={INFO_SECTION_CLASS}>
							<div className={INFO_LABEL_CLASS}>Model &amp; account</div>
							<div className={INFO_LIST_CLASS}>
								<ConfigRowView label="Requested" row={data.model.requested} />
								<ConfigRowView
									label="Dispatched as"
									row={data.model.dispatchModel}
								/>
								<ConfigRowView label="Engine" row={data.model.engine} />
								{data.model.preset?.value != null && (
									<ConfigRowView label="Preset" row={data.model.preset} />
								)}
								{data.model.effort?.value != null && (
									<ConfigRowView label="Effort" row={data.model.effort} />
								)}
								<ConfigRowView label="Fallback" row={data.model.fallbackModel} />
								<ConfigRowView label="Account" row={data.account.predicted} />
								{data.account.poolDryReason?.value != null && (
									<ConfigRowView
										label="Pool"
										row={data.account.poolDryReason}
									/>
								)}
							</div>
						</div>

						<ConfigSection
							label="Tools stripped from the model's list"
							count={
								<span className="text-faint">{stripped.length}</span>
							}
						>
							<div className={INFO_LIST_CLASS}>
								<ConfigRowView
									label="Unattended policy"
									row={data.tools.unattended}
								/>
								<ConfigRowView label="Bash" row={data.tools.bashPolicy} />
								{stripped.length > 0 && (
									<StrippedToolRows tools={stripped} />
								)}
							</div>
						</ConfigSection>

						<ConfigSection label="Execution">
							<div className={INFO_LIST_CLASS}>
								<SectionRows section={data.execution} />
							</div>
						</ConfigSection>

						<ConfigSection label="Run gate">
							<div className={INFO_LIST_CLASS}>
								<SectionRows section={data.gate} />
							</div>
						</ConfigSection>

						<ConfigSection label="Account pool">
							<div className={INFO_LIST_CLASS}>
								<SectionRows section={data.account} />
							</div>
						</ConfigSection>

						<ConfigSection label="Subagents">
							<div className={INFO_LIST_CLASS}>
								<SectionRows section={data.agents} />
							</div>
						</ConfigSection>

						<ConfigSection label="Memory">
							<div className={INFO_LIST_CLASS}>
								<SectionRows section={data.memory} />
							</div>
						</ConfigSection>

						<ConfigSection label="Placement">
							<div className={INFO_LIST_CLASS}>
								<SectionRows section={data.placement} />
							</div>
						</ConfigSection>

						<ConfigSection label="Identity">
							<div className={INFO_LIST_CLASS}>
								<SectionRows section={data.identity} />
							</div>
						</ConfigSection>

						<ConfigSection label="Instructions">
							<div className={INFO_LIST_CLASS}>
								<SectionRows section={data.instructions} />
							</div>
						</ConfigSection>

						<div className="grid gap-1 px-3">
							<div className="flex flex-wrap items-baseline gap-x-2 text-meta text-faint">
								<span>Resolved {relativeTime(data.resolvedAt)}</span>
								<button
									type="button"
									className="focus-ring rounded-sm underline underline-offset-2 transition-colors hover:text-fg"
									onClick={load}
									disabled={loading}
								>
									{loading ? "Refreshing…" : "Refresh"}
								</button>
							</div>
							<p className="m-0 text-meta leading-snug text-faint">
								{data.caveat}
							</p>
						</div>
					</>
				)}
			</div>
		</ConfigSection>
	);
}
