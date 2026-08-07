import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "../ui/button";
import { Popover } from "../ui/popover";
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
import { IconPlus } from "./icons";
import { RepoTile } from "./RepoTile";
import { REPO_TILE_COLORS } from "../lib/repo-colors";
import { fetchRepos, setRepoAppearanceApi, type RepoInfo } from "../lib/api";
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
	// Tile appearance rides on the repo list rather than the setup status: the
	// same payload every tile in the app reads, so what this page shows and
	// what the sidebar paints can't drift apart.
	const [appearance, setAppearance] = useState<Map<string, RepoInfo>>(new Map());
	const loadAppearance = useCallback(async () => {
		const list = await fetchRepos().catch(() => []);
		setAppearance(new Map(list.map((r) => [r.id, r])));
	}, []);
	useEffect(() => {
		loadAppearance();
	}, [loadAppearance, repos]);
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
								<RepoTileButton
									repo={appearance.get(r.id)}
									id={r.id}
									onChanged={loadAppearance}
								/>
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

/**
 * The repo's tile, and the controls behind it. The tile is the trigger because
 * it's the thing being edited — a separate "edit tile" button would say less
 * than the picture it changes.
 *
 * A repo shows a colored letter by default. That's deliberate: the art GitHub
 * has is the OWNER's avatar, so taking it automatically put the same tile on
 * every repo in an org. Here it's a choice, per repo.
 */
function RepoTileButton({
	id,
	repo,
	onChanged,
}: {
	id: string;
	repo: RepoInfo | undefined;
	onChanged: () => Promise<void>;
}) {
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);

	async function apply(patch: {
		color?: string | null;
		icon?: "github" | null;
	}) {
		if (busy) return;
		setBusy(true);
		setError(null);
		try {
			await setRepoAppearanceApi(id, patch);
			await onChanged();
		} catch (e: any) {
			setError(e.message);
		} finally {
			setBusy(false);
		}
	}

	return (
		<Popover.Root>
			<Popover.Trigger
				className="shrink-0 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent,#6b8afd)]"
				aria-label={`Change ${id}'s tile`}
			>
				<RepoTile name={id} size={28} />
			</Popover.Trigger>
			<Popover.Popup className="w-[248px] p-3" initialFocus>
				<div className="mb-2 text-meta font-medium text-dim">Tile color</div>
				<div className="grid grid-cols-8 gap-1.5">
					{REPO_TILE_COLORS.map((color) => {
						const active = repo?.color === color;
						return (
							<button
								key={color}
								type="button"
								disabled={busy}
								onClick={() => apply({ color })}
								aria-label={color}
								aria-pressed={active}
								className={cn(
									"h-6 w-6 rounded-md outline-none transition-transform",
									"hover:scale-110 focus-visible:ring-2 focus-visible:ring-[var(--accent,#6b8afd)]",
									active && "ring-2 ring-fg ring-offset-2 ring-offset-panel",
								)}
								style={{ background: color }}
							/>
						);
					})}
				</div>
				{repo?.colorChosen && (
					<Button
						size="sm"
						variant="ghost"
						className="mt-2"
						disabled={busy}
						onClick={() => apply({ color: null })}
					>
						Use the assigned color
					</Button>
				)}
				<div className="mt-3 mb-2 border-t border-line pt-3 text-meta font-medium text-dim">
					Icon
				</div>
				<div className="flex flex-wrap gap-1.5">
					<Button
						size="sm"
						disabled={busy || !repo?.ghRepo}
						onClick={() => apply({ icon: "github" })}
					>
						{busy ? "Working…" : "Fetch from GitHub"}
					</Button>
					{repo?.hasIcon && (
						<Button
							size="sm"
							variant="ghost"
							disabled={busy}
							onClick={() => apply({ icon: null })}
						>
							Remove
						</Button>
					)}
				</div>
				<div className="mt-2 text-meta leading-relaxed text-faint">
					{repo?.ghRepo
						? `Takes ${repo.ghRepo.split("/")[0]}’s avatar — the same picture for every repo that owner has, so it suits the one that IS the product.`
						: "No GitHub repository configured, so there’s no avatar to take."}
				</div>
				{error && <InlineAlert className="mt-2">{error}</InlineAlert>}
			</Popover.Popup>
		</Popover.Root>
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
	// Configured-but-failing (bad key path, API outage): the route answers 502
	// with the server's error — distinct from "not configured", which hides the
	// section entirely.
	const [csError, setCsError] = useState<string | null>(null);
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
			} catch (e: any) {
				// A throw means configured-but-failing (the route answers 200 with
				// source: null when unconfigured) — surface the server's error
				// instead of silently hiding the section. GitHub is unaffected.
				if (!cancelled)
					setCsError(e?.message || "Couldn’t reach code.storage right now.");
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
			{(csConfigured || csError) && (
				<>
					<div className="mt-3 border-t border-line pt-3 text-meta font-medium text-dim">
						code.storage
					</div>
					{csError ? (
						<InlineAlert className="mt-1.5">
							code.storage is configured but its repo list failed: {csError}
						</InlineAlert>
					) : (
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
					)}
				</>
			)}
			{error && <InlineAlert className="mt-2.5">{error}</InlineAlert>}
		</SettingsSection>
	);
}
