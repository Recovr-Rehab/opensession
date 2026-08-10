import { repoLabel } from "../lib/repo-label";
import { cn } from "../ui/cn";
import { FALLBACK_REPO, sessionRepoOr } from "../lib/session-repo";
import { sessionSourceLabel } from "../lib/brand";
import { SOURCE_CHIP, sourceChipTone } from "../lib/source-chip-classes";
import {
	ARCHIVED_LIST,
	ARCHIVED_ROW,
	ARCHIVED_ROW_ACTION,
	ARCHIVED_ROW_META,
	ARCHIVED_ROW_OPEN,
	ARCHIVED_ROW_TIME,
	ARCHIVED_ROW_TITLE,
} from "../lib/archived-classes";
import React, { useState, useMemo, useEffect } from "react";
import type { UnifiedSession } from "../lib/types";
import { relativeTime, archiveSessionApi } from "../lib/api";
import { useCurrentUser } from "./UserPicker";
import { docTitle, DEFAULT_DOC_TITLE } from "../lib/brand";
import { PageLayout } from "../ui/page";
import { Button } from "../ui/button";
import { Card, CardList } from "../ui/card";
import { Input } from "../ui/input";
import { Menu } from "../ui/menu";
import { EmptyState, ListSkeleton } from "../ui/state";
import { IconCheck, IconFilter, IconUnarchive } from "./icons";
import { RepoTile } from "./RepoTile";

interface Props {
	sessions: UnifiedSession[];
	/**
	 * Whether the archived index has landed. Archived sessions are no longer in
	 * the polled list — they're fetched separately, after first paint — so an
	 * empty `sessions` here means "not yet" as often as it means "none", and
	 * this page is the one place that difference is the whole screen.
	 */
	loaded: boolean;
	onSelect: (session: UnifiedSession) => void;
	onChanged: () => void;
}

// Same key the sidebar persists its group/repo/sort choices under, so the
// archived page opens with the repo filter the sidebar is already showing.
const SIDEBAR_FILTER_KEY = "opensession-sidebar-filter";

/** How many rows the list draws before asking for a narrower search. */
const PAGE_SIZE = 200;

type OwnerFilter = "mine" | "everyone";
type ReasonFilter = "all" | "manual" | "auto";

// Manual archiving is the only reason an old registry/file entry can be
// missing `archivedReason` (it predates the field) — treat unset as manual.
function isAutoReason(s: UnifiedSession): boolean {
	return !!s.archivedReason && s.archivedReason !== "manual";
}

// Repo-less sessions group under the literal FALLBACK_REPO bucket, not the
// sidebar's default-repo lane (see lib/session-repo for the fork rationale).
function sessionRepo(s: UnifiedSession): string {
	return sessionRepoOr(s, FALLBACK_REPO);
}

// The repo the sidebar is currently filtered to ("all" when unset), read fresh
// so we inherit it as the archived page's starting repo.
function sidebarRepo(): string {
	try {
		const v = JSON.parse(localStorage.getItem(SIDEBAR_FILTER_KEY) || "{}");
		return typeof v.repo === "string" ? v.repo : "all";
	} catch {
		return "all";
	}
}

/**
 * The chip naming where a session came from — rendered only when it says
 * something. An automation's name is worth a chip; so is a session that
 * arrived from Slack or Linear, or one that ran read-only. A code session
 * started here is the default and gets none: `os¹` on all six hundred rows is
 * a column of noise dressed as data.
 */
function originChip(s: UnifiedSession): { label: string; tone: string } | null {
	if (s.automation) return { label: s.automation, tone: "" };
	if (s.mode === "ask") return { label: "ask", tone: sourceChipTone("ask") };
	if (s.source && s.source !== "opensession") {
		return { label: sessionSourceLabel(s.source), tone: sourceChipTone(s.source) };
	}
	return null;
}

export function Archived({ sessions, loaded, onSelect, onChanged }: Props) {
	const currentUser = useCurrentUser();
	const [search, setSearch] = useState("");
	const [busy, setBusy] = useState<string | null>(null);
	// Scope: default to *my* archived sessions, and inherit the sidebar's
	// repo filter — both still adjustable here.
	const [owner, setOwner] = useState<OwnerFilter>("mine");
	const [repo, setRepo] = useState<string>(sidebarRepo);
	const [reason, setReason] = useState<ReasonFilter>("all");

	useEffect(() => {
		document.title = docTitle("Archived");
		return () => {
			document.title = DEFAULT_DOC_TITLE;
		};
	}, []);

	const allArchived = useMemo(
		() => sessions.filter((s) => s.archived),
		[sessions],
	);
	const hasAutoArchived = allArchived.some(isAutoReason);
	const activeFilterCount =
		(owner === "mine" ? 1 : 0) + (repo !== "all" ? 1 : 0) + (reason !== "all" ? 1 : 0);

	// Repos present in the archived set, most-used first — the repo dropdown options.
	const repos = useMemo(() => {
		const counts = new Map<string, number>();
		for (const s of allArchived) {
			const p = sessionRepo(s);
			counts.set(p, (counts.get(p) || 0) + 1);
		}
		return Array.from(counts.entries())
			.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
			.map(([name]) => name);
	}, [allArchived]);

	// If the inherited repo isn't among the archived sessions, fall back to "all"
	// so the list isn't mysteriously empty on open.
	useEffect(() => {
		if (repo !== "all" && !repos.includes(repo)) setRepo("all");
	}, [repo, repos]);

	const archived = useMemo(() => {
		const user = currentUser.toLowerCase();
		let list = allArchived;
		if (owner === "mine")
			list = list.filter(
				(s) =>
					!s.automation &&
					!!s.startedBy &&
					s.startedBy.toLowerCase() === user,
			);
		if (repo !== "all") list = list.filter((s) => sessionRepo(s) === repo);
		if (reason !== "all")
			list = list.filter((s) =>
				reason === "auto" ? isAutoReason(s) : !isAutoReason(s),
			);
		if (search.trim()) {
			const q = search.toLowerCase();
			list = list.filter(
				(s) =>
					s.title.toLowerCase().includes(q) ||
					sessionRepo(s).toLowerCase().includes(q) ||
					(s.branch || "").toLowerCase().includes(q) ||
					(s.startedBy || "").toLowerCase().includes(q) ||
					(s.automation || "").toLowerCase().includes(q),
			);
		}
		return list;
	}, [allArchived, owner, repo, reason, search, currentUser]);

	async function handleUnarchive(e: React.MouseEvent, id: string) {
		e.stopPropagation();
		setBusy(id);
		try {
			await archiveSessionApi(id, false);
			onChanged();
		} finally {
			setBusy(null);
		}
	}

	return (
		<PageLayout
			title="Archived"
			description={
				loaded
					? archived.length === allArchived.length
						? `${archived.length} archived session${archived.length === 1 ? "" : "s"}`
						: `${archived.length} of ${allArchived.length} archived sessions`
					: "Loading archived sessions"
			}
			actions={
				<div className="flex items-center gap-2 phone:w-full">
					<Input
						className="w-[240px] phone:min-w-0 phone:flex-1"
						type="search"
						aria-label="Search archived sessions"
						placeholder="Search archived…"
						value={search}
						onChange={(e) => setSearch(e.target.value)}
					/>
					<Menu.Root>
						<Menu.Trigger
							render={
								<Button
									icon={<IconFilter size={18} />}
									aria-label={`Filters, ${activeFilterCount} active`}
									className={activeFilterCount > 0 ? "text-fg" : undefined}
								>
									Filters{activeFilterCount > 0 ? ` ${activeFilterCount}` : ""}
								</Button>
							}
						/>
						<Menu.Popup align="end" className="min-w-[220px]">
							<Menu.Group>
								<Menu.GroupLabel>Owner</Menu.GroupLabel>
								<Menu.RadioGroup value={owner} onValueChange={(value) => setOwner(value as OwnerFilter)}>
									{(["mine", "everyone"] as const).map((value) => (
										<Menu.RadioItem key={value} value={value} closeOnClick>
											<span className="min-w-0 flex-1">{value === "mine" ? "My archived" : "Everyone"}</span>
											{owner === value && <IconCheck size={17} className="shrink-0 text-accent" />}
										</Menu.RadioItem>
									))}
								</Menu.RadioGroup>
							</Menu.Group>
							{repos.length > 1 && (
								<>
									<Menu.Separator />
									<Menu.Group>
										<Menu.GroupLabel>Repository</Menu.GroupLabel>
										<Menu.RadioGroup value={repo} onValueChange={(value) => setRepo(String(value))}>
											<Menu.RadioItem value="all" closeOnClick>
												<span className="size-[18px] shrink-0" />
												<span className="min-w-0 flex-1">All repos</span>
												{repo === "all" && <IconCheck size={17} className="shrink-0 text-accent" />}
											</Menu.RadioItem>
											{repos.map((name) => (
												<Menu.RadioItem key={name} value={name} closeOnClick>
													<RepoTile name={name} size={18} />
													<span className="min-w-0 flex-1 truncate">{repoLabel(name)}</span>
													{repo === name && <IconCheck size={17} className="shrink-0 text-accent" />}
												</Menu.RadioItem>
											))}
										</Menu.RadioGroup>
									</Menu.Group>
								</>
							)}
							{hasAutoArchived && (
								<>
									<Menu.Separator />
									<Menu.Group>
										<Menu.GroupLabel>Reason</Menu.GroupLabel>
										<Menu.RadioGroup value={reason} onValueChange={(value) => setReason(value as ReasonFilter)}>
											{(["all", "auto", "manual"] as const).map((value) => (
												<Menu.RadioItem key={value} value={value} closeOnClick>
													<span className="min-w-0 flex-1">{{ all: "All", auto: "Auto-archived", manual: "Manual" }[value]}</span>
													{reason === value && <IconCheck size={17} className="shrink-0 text-accent" />}
												</Menu.RadioItem>
											))}
										</Menu.RadioGroup>
									</Menu.Group>
								</>
							)}
							{activeFilterCount > 0 && (
								<>
									<Menu.Separator />
									<Menu.Item onClick={() => { setOwner("everyone"); setRepo("all"); setReason("all"); }}>
										Clear filters
									</Menu.Item>
								</>
							)}
						</Menu.Popup>
					</Menu.Root>
				</div>
			}
		>
			{archived.length === 0 && !loaded ? (
				// Not "nothing archived" — nothing YET. Claiming the list is empty
				// while it is still in flight is what makes a slow load read as data
				// loss. Same card, same row geometry, so the rows land where these sat.
				<CardList>
					<ListSkeleton
						variant="rows"
						rows={8}
						label="Loading archived sessions"
					/>
				</CardList>
			) : archived.length === 0 ? (
				<Card>
					<EmptyState>
						Nothing archived
						{search || owner === "mine" || repo !== "all" ? " matches" : " yet"}.
					</EmptyState>
				</Card>
			) : (
				<ul className={ARCHIVED_LIST}>
					{archived.slice(0, PAGE_SIZE).map((s) => {
						const chip = originChip(s);
						// A field the current filter already fixes is the same word on
						// every row, so each one only appears when it varies: who,
						// while looking at everyone's; why, while not filtered by
						// reason. The repo is the tile, which carries it in a glance.
						const meta = [
							chip && (
								<span key="chip" className={cn(SOURCE_CHIP, chip.tone)}>
									{chip.label}
								</span>
							),
							owner === "everyone" && s.startedBy && (
								<span key="by" className="truncate">
									{s.startedBy}
								</span>
							),
							reason === "all" && isAutoReason(s) && (
								<span
									key="auto"
									className={cn(SOURCE_CHIP, "bg-active text-dim")}
									title={`Auto-archived (${s.archivedReason})`}
								>
									auto
								</span>
							),
							// The phone row has no timestamp column beside it — the
							// action is always visible there and takes the space.
							<span key="when" className="hidden shrink-0 phone:inline">
								{relativeTime(s.lastActivity)}
							</span>,
						].filter(Boolean);
						return (
							<li key={s.id} className={ARCHIVED_ROW}>
								<RepoTile name={sessionRepo(s)} />
								<button
									type="button"
									className={ARCHIVED_ROW_OPEN}
									onClick={() => onSelect(s)}
								>
									<span className={ARCHIVED_ROW_TITLE}>{s.title}</span>
									{meta.length > 0 && (
										<span className={ARCHIVED_ROW_META}>{meta}</span>
									)}
								</button>
								<span className={ARCHIVED_ROW_TIME}>
									{relativeTime(s.lastActivity)}
								</span>
								<Button
									size="sm"
									className={ARCHIVED_ROW_ACTION}
									icon={<IconUnarchive size={15} className="phone:size-[17px]" />}
									aria-label="Restore session"
									disabled={busy === s.id}
									onClick={(e) => handleUnarchive(e, s.id)}
								>
									<span className="phone:hidden">Restore</span>
								</Button>
							</li>
						);
					})}
					{archived.length > PAGE_SIZE && (
						<li className="px-3.5 py-3 text-meta text-faint">
							Showing the first {PAGE_SIZE} of {archived.length}. Search to
							reach the older ones.
						</li>
					)}
				</ul>
			)}
		</PageLayout>
	);
}
