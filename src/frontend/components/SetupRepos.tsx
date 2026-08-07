import React, { useEffect, useMemo, useState } from "react";
import { Button } from "../ui/button";
import { cn } from "../ui/cn";
import { EmptyState, InlineAlert, LoadingState } from "../ui/state";
import {
	SettingCard,
	SettingRow,
	SettingRowDescription,
	SettingRowText,
	SettingRowTitle,
	SettingsGroupLabel,
	SettingsHint,
	SettingsSection,
	settingsInputClass,
} from "../ui/settings";
import { toast } from "../ui/toast";
import { IconPlus, IconRepo } from "./icons";
import {
	StateChip,
	repoLifecycleState,
	setupRequest,
	type BrowseRepo,
	type SetupStatus,
} from "./setup-shared";

// Settings → Setup → Repositories: the registered repos sessions work in,
// plus an add flow. With a GitHub credential (a connected account or the bot
// token) the add flow browses the reachable repos; without one it falls back
// to a manual owner/name entry. When the code.storage integration is
// configured, its org's repos are offered in their own section alongside
// GitHub. Registering clones the repo server-side, so an add can take tens of
// seconds — the row keeps a working state the whole way and nothing here
// times out early.

export function ReposSection({
	repos,
	onChanged,
}: {
	repos: SetupStatus["repos"];
	onChanged: () => void | Promise<void>;
}) {
	const [pickerOpen, setPickerOpen] = useState(false);
	return (
		<>
			<SettingsGroupLabel
				actions={
					<Button
						size="sm"
						icon={<IconPlus size={16} />}
						onClick={() => setPickerOpen((o) => !o)}
					>
						{pickerOpen ? "Close" : "Add repository"}
					</Button>
				}
			>
				Repositories
			</SettingsGroupLabel>
			{pickerOpen && <AddRepoPicker onAdded={onChanged} />}
			<SettingCard>
				{repos.length === 0 ? (
					<EmptyState placement="row">
						No repositories registered — sessions need at least one repo to work
						in. Add one above.
					</EmptyState>
				) : (
					repos.map((r) => {
						const lifecycle = repoLifecycleState(r);
						return (
							<SettingRow key={r.id}>
								<span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-active text-dim">
									<IconRepo size={16} />
								</span>
								<SettingRowText>
									<SettingRowTitle>{r.label}</SettingRowTitle>
									<SettingRowDescription className="truncate font-mono text-meta">
										{r.path}
									</SettingRowDescription>
									<SettingRowDescription>
										{lifecycle.description}
									</SettingRowDescription>
								</SettingRowText>
								<StateChip tone={lifecycle.tone} label={lifecycle.label} />
							</SettingRow>
						);
					})
				)}
			</SettingCard>
			<SettingsHint>
				Registering clones the repo onto the server; sessions then branch into
				isolated worktrees of it. New repos are usable right away — no restart.
				A repo that commits <code>.opensession/setup.sh</code> and{" "}
				<code>.opensession/start.sh</code> provisions its own worktrees and
				boots its dev server, so previews work and agents can check their UI
				changes in a real browser — see docs/repo-lifecycle.md.
			</SettingsHint>
		</>
	);
}

interface BrowseResult {
	source: "user" | "bot" | null;
	repos: BrowseRepo[];
}

/** GET /api/setup/codestorage/repos — `source: null` when the code.storage
 * integration isn't configured (the wizard probes it unconditionally). */
interface CsBrowseResult {
	source: "org" | null;
	repos: BrowseRepo[];
}

type RepoSource = "github" | "codestorage";

function filterRepos(repos: BrowseRepo[], filter: string): BrowseRepo[] {
	const q = filter.trim().toLowerCase();
	if (!q) return repos;
	return repos.filter(
		(r) =>
			r.fullName.toLowerCase().includes(q) ||
			(r.description ?? "").toLowerCase().includes(q),
	);
}

function RepoPickRow({
	repo,
	registered,
	working,
	disabled,
	onAdd,
}: {
	repo: BrowseRepo;
	registered: boolean;
	working: boolean;
	disabled: boolean;
	onAdd: () => void;
}) {
	return (
		<div className="flex items-center gap-3 border-b border-line px-1 py-2 last:border-b-0">
			<div className="min-w-0 flex-1">
				<div className="flex min-w-0 items-baseline gap-2">
					<span className="truncate text-control-label font-medium text-fg">
						{repo.fullName}
					</span>
					{repo.private && (
						<span className="shrink-0 rounded-sm bg-active px-1.5 py-px text-meta text-dim">
							private
						</span>
					)}
				</div>
				{repo.description && (
					<div className="mt-0.5 truncate text-meta text-faint">
						{repo.description}
					</div>
				)}
			</div>
			<Button
				size="sm"
				variant={registered ? "ghost" : "default"}
				disabled={registered || disabled}
				onClick={onAdd}
			>
				{registered ? "Added" : working ? "Cloning…" : "Add"}
			</Button>
		</div>
	);
}

function AddRepoPicker({ onAdded }: { onAdded: () => void | Promise<void> }) {
	const [browse, setBrowse] = useState<BrowseResult | null>(null);
	const [browseFailed, setBrowseFailed] = useState(false);
	// code.storage list, probed alongside GitHub. Stays null until the probe
	// answers; an unconfigured integration answers `source: null` (no section).
	const [csBrowse, setCsBrowse] = useState<CsBrowseResult | null>(null);
	const [filter, setFilter] = useState("");
	const [addingRepo, setAddingRepo] = useState<string | null>(null);
	const [added, setAdded] = useState<ReadonlySet<string>>(new Set());
	const [error, setError] = useState<string | null>(null);
	const [manual, setManual] = useState("");

	useEffect(() => {
		let cancelled = false;
		(async () => {
			try {
				const body = await setupRequest<BrowseResult>("/api/setup/github/repos");
				if (!cancelled) setBrowse(body);
			} catch {
				if (!cancelled) setBrowseFailed(true);
			}
		})();
		(async () => {
			try {
				const body = await setupRequest<CsBrowseResult>(
					"/api/setup/codestorage/repos",
				);
				if (!cancelled) setCsBrowse(body);
			} catch {
				// Treated like "not configured" — the GitHub flow is unaffected.
			}
		})();
		return () => {
			cancelled = true;
		};
	}, []);

	const filtered = useMemo(
		() => filterRepos(browse?.repos ?? [], filter),
		[browse, filter],
	);
	const csFiltered = useMemo(
		() => filterRepos(csBrowse?.repos ?? [], filter),
		[csBrowse, filter],
	);
	const csConfigured = csBrowse?.source === "org";

	async function addRepo(fullName: string, source: RepoSource = "github") {
		if (addingRepo) return;
		const key = `${source}:${fullName}`;
		setAddingRepo(key);
		setError(null);
		try {
			// Registering clones server-side — can take tens of seconds. No client
			// timeout; the button holds its working state until the server answers.
			// code.storage repos reuse the same submit shape with a source marker.
			await setupRequest("/api/setup/repos", {
				method: "POST",
				json:
					source === "codestorage" ? { source, fullName } : { fullName },
			});
			setAdded((prev) => new Set(prev).add(key));
			setManual("");
			toast(`${fullName} registered`);
			await onAdded();
		} catch (e: any) {
			setError(e.message);
		} finally {
			setAddingRepo(null);
		}
	}

	const manualValid = /^[^/\s]+\/[^/\s]+$/.test(manual.trim());
	const totalListed =
		(browse?.source ? browse.repos.length : 0) +
		(csConfigured ? (csBrowse?.repos.length ?? 0) : 0);

	return (
		<SettingsSection className="mb-3">
			{!browse && !browseFailed ? (
				<LoadingState placement="row">Looking up your GitHub repositories…</LoadingState>
			) : browse && browse.source !== null ? (
				<>
					<input
						className={settingsInputClass}
						value={filter}
						onChange={(e) => setFilter(e.target.value)}
						placeholder={`Filter ${totalListed || browse.repos.length} ${
							(totalListed || browse.repos.length) === 1
								? "repository"
								: "repositories"
						}…`}
						aria-label="Filter repositories"
						autoCapitalize="none"
						spellCheck={false}
					/>
					<div className="mt-2 max-h-[320px] overflow-y-auto">
						{filtered.length === 0 ? (
							<EmptyState placement="row" className="px-1">
								No repositories match.
							</EmptyState>
						) : (
							filtered.map((r) => (
								<RepoPickRow
									key={r.fullName}
									repo={r}
									registered={r.registered || added.has(`github:${r.fullName}`)}
									working={addingRepo === `github:${r.fullName}`}
									disabled={addingRepo !== null}
									onAdd={() => addRepo(r.fullName)}
								/>
							))
						)}
					</div>
					<div className="mt-2 text-meta text-faint">
						Browsing as the {browse.source === "user" ? "connected account" : "bot"} —
						only repos that credential can reach are listed.
					</div>
				</>
			) : (
				<>
					<div className="text-supporting leading-relaxed text-dim">
						{browseFailed ? (
							<>Couldn&rsquo;t load the GitHub repo list right now.</>
						) : (
							<>
								No GitHub credential yet, so the repo list can&rsquo;t be browsed
								— connect your account under Workspace → Connections, or set{" "}
								<code className="rounded-sm bg-surface px-1.5 py-0.5 font-mono text-[0.92em] text-fg">
									GITHUB_API_TOKEN
								</code>{" "}
								via the GitHub integration card below.
							</>
						)}{" "}
						You can still register a repo by name:
					</div>
					<div className="mt-2.5 flex items-center gap-2">
						<input
							className={cn(settingsInputClass, "flex-1 font-mono")}
							value={manual}
							onChange={(e) => setManual(e.target.value)}
							placeholder="owner/name"
							aria-label="Repository full name"
							autoCapitalize="none"
							spellCheck={false}
							onKeyDown={(e) => {
								if (e.key === "Enter" && manualValid && !addingRepo)
									addRepo(manual.trim());
							}}
						/>
						<Button
							variant="primary"
							disabled={!manualValid || addingRepo !== null}
							onClick={() => addRepo(manual.trim())}
						>
							{addingRepo ? "Cloning…" : "Add"}
						</Button>
					</div>
				</>
			)}
			{csConfigured && (
				<>
					<div className="mt-3 border-t border-line pt-3 text-meta font-medium text-dim">
						code.storage
					</div>
					<div className="mt-1 max-h-[240px] overflow-y-auto">
						{csFiltered.length === 0 ? (
							<EmptyState placement="row" className="px-1">
								{filter.trim()
									? "No code.storage repositories match."
									: "No repositories visible to the org's signing key."}
							</EmptyState>
						) : (
							csFiltered.map((r) => (
								<RepoPickRow
									key={r.fullName}
									repo={r}
									registered={
										r.registered || added.has(`codestorage:${r.fullName}`)
									}
									working={addingRepo === `codestorage:${r.fullName}`}
									disabled={addingRepo !== null}
									onAdd={() => addRepo(r.fullName, "codestorage")}
								/>
							))
						)}
					</div>
				</>
			)}
			{error && <InlineAlert className="mt-2.5">{error}</InlineAlert>}
		</SettingsSection>
	);
}
