import React, { useEffect, useMemo, useState } from "react";
import type { Workspace, UnifiedSession } from "../lib/types";
import { fetchHomeStats, fetchRecentPrs, type HomeStats, type RecentPr } from "../lib/api";
import { prStatusMark } from "../lib/pr-status";
import {
  buildWorktreeRows,
  compactAge,
  compactDiff,
  dateGroup,
  personLabel,
  type WorktreeRow,
} from "../lib/pr-rows";
import { Button } from "../ui/button";
import { useCurrentUser } from "./UserPicker";
import { UserAvatar } from "./UserAvatar";
import { RepoTile, repoLabel } from "./RepoTile";
import { usePeople } from "../lib/people";
import { Menu } from "../ui/menu";
import { Tooltip } from "../ui/tooltip";
import { Input } from "../ui/input";
import { PageHeader, PageTitle } from "../ui/page-header";
import { EmptyState } from "../ui/state";
import {
  PR_GROUP_LABEL,
  PR_LIST,
  PR_ROW,
  PR_SECTION_LABEL,
} from "../lib/pr-list-classes";
import {
  IconArchive,
  IconCheck,
  IconDotsHorizontal,
  IconFolder,
  IconGitMerge,
  IconPeople,
  IconPlus,
  IconPullRequest,
  IconRepo,
} from "./icons";

interface Props {
  sessions: UnifiedSession[];
  workspaces: Workspace[];
  onSelect: (session: UnifiedSession) => void;
  onNewSession: () => void;
  onShowArchived: () => void;
  onOpenAnalytics?: () => void;
}

const compactFmt = new Intl.NumberFormat("en", {
  notation: "compact",
  maximumFractionDigits: 1,
});
const fmtCompact = (n: number) => compactFmt.format(n);
const HOME_STATS_CACHE_KEY = "opensession.homeStats.v1";

function readCachedHomeStats(): HomeStats | null {
  try {
    const cached = JSON.parse(
      localStorage.getItem(HOME_STATS_CACHE_KEY) || "null",
    ) as Partial<HomeStats> | null;
    return cached?.today && cached.week ? (cached as HomeStats) : null;
  } catch {
    return null;
  }
}

function cacheHomeStats(stats: HomeStats): void {
  try {
    localStorage.setItem(HOME_STATS_CACHE_KEY, JSON.stringify(stats));
  } catch {
    // Stats still render when storage is unavailable.
  }
}

function fmtAgentTime(ms: number): string {
  const hours = ms / 3_600_000;
  if (hours < 1) return `${Math.round(ms / 60_000)}m`;
  return `${hours >= 10 ? Math.round(hours) : hours.toFixed(1)}h`;
}

function StatCell({
  value,
  label,
  sub,
  title,
  dot,
  loading,
  divider,
  rowDivider,
}: {
  value: string;
  label: string;
  sub?: string;
  title?: string;
  dot?: "live" | "idle";
  loading?: boolean;
  divider?: string;
  rowDivider?: string;
}) {
  return (
    <div
      className="relative min-w-0 px-5 py-3 phone:px-4 phone:py-2.5"
      title={title}
    >
      <span
        aria-hidden="true"
        className={`absolute inset-y-3 left-0 w-px bg-line ${divider ?? "hidden"}`}
      />
      <span
        aria-hidden="true"
        className={`absolute inset-x-4 top-0 h-px bg-line ${rowDivider ?? "hidden"}`}
      />
      <div className="flex items-center gap-1.5">
        {loading ? (
          <span className="my-1 h-4 w-10 rounded-sm bg-line motion-safe:animate-pulse" />
        ) : (
          dot && (
            <span
              className={
                dot === "live"
                  ? "h-2 w-2 shrink-0 animate-pulse rounded-full bg-green"
                  : "h-2 w-2 shrink-0 rounded-full bg-line"
              }
            />
          )
        )}
        {!loading && (
          <span
            className="truncate text-section-title font-semibold leading-6 tabular-nums text-fg"
          >
            {value}
          </span>
        )}
      </div>
      <div className="truncate text-meta leading-4 text-dim">{label}</div>
      {loading ? (
        <div className="flex h-4 items-center">
          <span className="h-2.5 w-14 rounded-sm bg-line motion-safe:animate-pulse" />
        </div>
      ) : (
        sub && <div className="truncate text-meta leading-4 text-faint">{sub}</div>
      )}
    </div>
  );
}

function OverviewStrip({
  running,
  stats,
  onOpenAnalytics,
}: {
  running: number;
  stats: HomeStats | null;
  onOpenAnalytics?: () => void;
}) {
  const today = stats?.today;
  const week = stats?.week;
  return (
    <button
      type="button"
      onClick={onOpenAnalytics}
      title={stats ? "Open Analytics" : "Analytics are loading"}
      aria-busy={!stats}
      // One slab, one wash: the hover lights the whole strip rather than each
      // cell, so the empty grid cells left by the wrapped layouts don't read as
      // a hole punched in it.
      className="focus-ring grid w-full cursor-pointer grid-cols-5 overflow-hidden rounded-lg bg-raised p-0 text-left transition-colors hover:bg-hover max-[860px]:grid-cols-3 max-[560px]:grid-cols-2"
    >
      <StatCell
        value={fmtCompact(running)}
        label={running === 1 ? "agent running now" : "agents running now"}
        dot={running > 0 ? "live" : "idle"}
      />
      <StatCell
        value={today ? fmtCompact(today.sessions) : ""}
        label="sessions today"
        sub={week ? `${fmtCompact(week.sessions)} · 7d` : undefined}
        loading={!stats}
        divider="block"
      />
      <StatCell
        value={today ? fmtCompact(today.turns) : ""}
        label="turns today"
        sub={week ? `${fmtCompact(week.turns)} · 7d` : undefined}
        title={today ? `${today.errors.toLocaleString()} errors today` : undefined}
        loading={!stats}
        divider="block max-[560px]:hidden"
        rowDivider="hidden max-[560px]:block"
      />
      <StatCell
        value={today ? fmtAgentTime(today.durationMs) : ""}
        label="agent time today"
        sub={week ? `${fmtAgentTime(week.durationMs)} · 7d` : undefined}
        loading={!stats}
        divider="hidden min-[861px]:block max-[560px]:block"
        rowDivider="hidden max-[860px]:block"
      />
      <StatCell
        value={today ? fmtCompact(today.outputTokens) : ""}
        label="tokens out today"
        sub={week ? `${fmtCompact(week.outputTokens)} · 7d` : undefined}
        title={
          today
            ? `${today.inputTokens.toLocaleString()} input · ${today.cacheReadTokens.toLocaleString()} cache read today`
            : undefined
        }
        loading={!stats}
        divider="block max-[560px]:hidden"
        rowDivider="hidden max-[860px]:block"
      />
    </button>
  );
}

function StateIcon({ state }: { state: WorktreeRow["state"] }) {
  if (state === "MERGED") return <IconGitMerge size={20} />;
  if (state === "CLOSED") return <IconArchive size={20} />;
  return <IconPullRequest size={20} />;
}

export function Prs({
  sessions,
  workspaces,
  onSelect,
  onNewSession,
  onShowArchived,
  onOpenAnalytics,
}: Props) {
  const currentUser = useCurrentUser();
  const [query, setQuery] = useState("");
  const [workspaceId, setWorkspaceId] = useState("all");
  const [repo, setRepo] = useState("all");
  // Whose pull requests to show, and nothing more. This used to be the app's
  // person lens, so narrowing the list here also swapped the sidebar out from
  // under you. It is an ordinary filter now, alongside workspace and repo:
  // switching whose work the app is showing is the People page's job.
  const [person, setPerson] = useState("all");
  // Everyone, not only whoever the default request happened to return, because
  // picking someone fetches their pull requests below.
  const roster = usePeople();
  const people = [...roster].sort(
    (a, b) =>
      Number(b.name.toLowerCase() === currentUser.toLowerCase()) -
      Number(a.name.toLowerCase() === currentUser.toLowerCase()),
  );
  const [showArchived, setShowArchived] = useState(false);
  const [recentPrs, setRecentPrs] = useState<RecentPr[]>([]);
  const [personPrs, setPersonPrs] = useState<RecentPr[]>([]);
  const [stats, setStats] = useState<HomeStats | null>(readCachedHomeStats);

  useEffect(() => {
    let active = true;
    const load = () =>
      fetchHomeStats()
        .then((data) => {
          if (!active) return;
          setStats(data);
          cacheHomeStats(data);
        })
        .catch(() => {});
    load();
    const timer = setInterval(load, 60_000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, []);

  const running = useMemo(
    () => sessions.filter((s) => s.isRunning && !s.archived).length,
    [sessions],
  );

  useEffect(() => {
    let active = true;
    fetchRecentPrs()
      .then((prs) => active && setRecentPrs(prs))
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (person === "all") {
      setPersonPrs([]);
      return;
    }
    let active = true;
    fetchRecentPrs(person)
      .then((prs) => active && setPersonPrs(prs))
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [person]);

  const allWorktrees = useMemo(() => {
    const prs = new Map(recentPrs.map((pr) => [pr.url, pr]));
    for (const pr of personPrs) prs.set(pr.url, pr);
    return buildWorktreeRows([...prs.values()], sessions);
  }, [personPrs, recentPrs, sessions]);

  const worktrees = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return allWorktrees
      .filter((row) => {
        if (!showArchived && row.archived) return false;
        if (workspaceId === "standalone" && row.workspaceId) return false;
        if (workspaceId !== "all" && workspaceId !== "standalone" && row.workspaceId !== workspaceId)
          return false;
        if (repo !== "all" && row.repo !== repo) return false;
        if (person !== "all" && row.person !== person) return false;
        if (!needle) return true;
        return [row.title, row.repo, row.branch, row.author, row.number ? `#${row.number}` : ""]
          .join(" ")
          .toLowerCase()
          .includes(needle);
      });
  }, [allWorktrees, person, workspaceId, query, repo, showArchived]);

  const sections = useMemo(() => {
    const definitions: Array<{ state: WorktreeRow["state"]; label: string }> = [
      { state: "OPEN", label: "Open" },
      { state: "MERGED", label: "Merged" },
      { state: "CLOSED", label: "Closed" },
    ];
    return definitions.flatMap((definition) => {
      const rows = worktrees.filter((row) => row.state === definition.state);
      if (!rows.length) return [];
      const groups = new Map<string, WorktreeRow[]>();
      for (const row of rows) {
        const label = dateGroup(row.updatedAt);
        groups.set(label, [...(groups.get(label) || []), row]);
      }
      return [{ ...definition, rows, groups: [...groups.entries()] }];
    });
  }, [worktrees]);

  const workspaceOptions = useMemo(() => {
    const represented = new Set(sessions.filter((s) => s.prUrl || s.prs?.some((pr) => pr.url)).map((s) => s.workspaceId));
    return workspaces.filter((workspace) => represented.has(workspace.id));
  }, [workspaces, sessions]);

  const repoOptions = useMemo(
    () => [...new Set(allWorktrees.map((row) => row.repo).filter(Boolean))].sort(),
    [allWorktrees],
  );

  return (
    // The page frame every other list page in the app uses: one centred
    // column at the shared width and padding, a PageHeader on top.
    <div className="min-h-0 w-full flex-1 overflow-y-auto bg-surface">
      <div className="mx-auto w-full max-w-[920px] px-6 pb-15 pt-7 max-[560px]:px-4 max-[560px]:pb-12 max-[560px]:pt-[18px]">
        <PageHeader className="items-center max-[560px]:flex-col max-[560px]:items-start max-[560px]:gap-3.5">
          <PageTitle>Pull requests</PageTitle>
          <div className="flex min-w-0 items-center gap-3 max-[560px]:w-full max-[560px]:justify-end">
            {/* The page's one CTA carries its verb as a glyph as well as a
                word: at this size a label alone is a coloured rectangle you
                read, and the plus is what makes it scan as the button that
                makes something. */}
            <Button
              variant="primary"
              size="lg"
              icon={<IconPlus size={20} />}
              className="text-control-label font-medium"
              onClick={onNewSession}
            >
              New session
            </Button>
          </div>
        </PageHeader>
        <OverviewStrip running={running} stats={stats} onOpenAnalytics={onOpenAnalytics} />

        {/* Search and the two scopes, in the app's field-and-button vocabulary:
            a filter here is the same control it is on the archived page, not a
            line of bare text that only looks like one. */}
        <div className="mb-4 mt-[18px] flex flex-wrap items-center gap-2">
          <Input
            className="w-[260px] phone:min-w-0 phone:flex-1"
            type="search"
            aria-label="Search pull requests"
            placeholder="Search pull requests…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            spellCheck={false}
          />

          <div className="ml-auto flex items-center gap-2">
            {people.length > 0 && (
              <Menu.Root>
                <Menu.Trigger
                  render={
                    <Button variant="ghost" icon={<IconPeople size={18} />} caret>
                      <span className="max-w-[150px] truncate">
                        {person === "all" ? "From anyone" : `From ${personLabel(person)}`}
                      </span>
                    </Button>
                  }
                />
                <Menu.Popup align="end" className="min-w-[200px]">
                  <Menu.RadioGroup
                    value={person}
                    onValueChange={(value) => setPerson(String(value))}
                  >
                    <Menu.RadioItem value="all" closeOnClick>
                      {/* Sized to the faces below so every label shares one edge. */}
                      <span className="size-[18px] shrink-0" />
                      <span className="min-w-0 flex-1 truncate">Anyone</span>
                      {person === "all" && <IconCheck className="shrink-0 text-accent" size={17} />}
                    </Menu.RadioItem>
                    {people.map((who) => {
                      const key = who.name.toLowerCase();
                      return (
                        <Menu.RadioItem key={key} value={key} closeOnClick>
                          <UserAvatar name={who.name} size={18} />
                          <span className="min-w-0 flex-1 truncate">
                            {key === currentUser.toLowerCase()
                              ? `${who.fullName} (you)`
                              : who.fullName}
                          </span>
                          {person === key && (
                            <IconCheck className="shrink-0 text-accent" size={17} />
                          )}
                        </Menu.RadioItem>
                      );
                    })}
                  </Menu.RadioGroup>
                </Menu.Popup>
              </Menu.Root>
            )}

            <Menu.Root>
              <Menu.Trigger
                render={
                  <Button variant="ghost" icon={<IconFolder size={18} />} caret>
                    <span className="max-w-[150px] truncate">
                      {workspaceId === "all"
                        ? "In all workspaces"
                        : workspaceId === "standalone"
                          ? "Standalone"
                          : `In ${workspaceOptions.find((w) => w.id === workspaceId)?.name ?? "workspace"}`}
                    </span>
                  </Button>
                }
              />
              <Menu.Popup align="end" className="min-w-[200px]">
                <Menu.RadioGroup
                  value={workspaceId}
                  onValueChange={(value) => setWorkspaceId(String(value))}
                >
                  <Menu.RadioItem value="all" closeOnClick>
                    <span className="min-w-0 flex-1 truncate">All workspaces</span>
                    {workspaceId === "all" && <IconCheck className="shrink-0 text-accent" size={17} />}
                  </Menu.RadioItem>
                  {workspaceOptions.map((workspace) => (
                    <Menu.RadioItem key={workspace.id} value={workspace.id} closeOnClick>
                      <span className="min-w-0 flex-1 truncate">{workspace.name}</span>
                      {workspaceId === workspace.id && (
                        <IconCheck className="shrink-0 text-accent" size={17} />
                      )}
                    </Menu.RadioItem>
                  ))}
                  <Menu.RadioItem value="standalone" closeOnClick>
                    <span className="min-w-0 flex-1 truncate">Standalone</span>
                    {workspaceId === "standalone" && (
                      <IconCheck className="shrink-0 text-accent" size={17} />
                    )}
                  </Menu.RadioItem>
                </Menu.RadioGroup>
              </Menu.Popup>
            </Menu.Root>

            {repoOptions.length > 1 && (
              <Menu.Root>
                <Menu.Trigger
                  render={
                    <Button variant="ghost" icon={<IconRepo size={18} />} caret>
                      <span className="max-w-[150px] truncate">
                        {repo === "all" ? "In all repos" : `In ${repoLabel(repo)}`}
                      </span>
                    </Button>
                  }
                />
                <Menu.Popup align="end" className="min-w-[200px]">
                  <Menu.RadioGroup value={repo} onValueChange={(value) => setRepo(String(value))}>
                    <Menu.RadioItem value="all" closeOnClick>
                      {/* Sized to the tiles below so every label shares one edge. */}
                      <span className="size-[18px] shrink-0" />
                      <span className="min-w-0 flex-1 truncate">All repos</span>
                      {repo === "all" && <IconCheck className="shrink-0 text-accent" size={17} />}
                    </Menu.RadioItem>
                    {repoOptions.map((name) => (
                      <Menu.RadioItem key={name} value={name} closeOnClick>
                        <RepoTile name={name} size={18} />
                        <span className="min-w-0 flex-1 truncate">{repoLabel(name)}</span>
                        {repo === name && <IconCheck className="shrink-0 text-accent" size={17} />}
                      </Menu.RadioItem>
                    ))}
                  </Menu.RadioGroup>
                </Menu.Popup>
              </Menu.Root>
            )}

            {/* Archived is a rarely-flipped switch, so it lives behind the
                overflow menu rather than spending a slot in the bar. It keeps
                its own colour when on, so the bar still says it's narrowed. */}
            <Menu.Root>
              <Tooltip label="More filters">
                <Menu.Trigger
                  render={
                    <Button
                      variant="ghost"
                      aria-label="More filters"
                      icon={<IconDotsHorizontal size={18} />}
                      className={showArchived ? "text-fg" : undefined}
                    />
                  }
                />
              </Tooltip>
              <Menu.Popup align="end">
                <Menu.CheckboxItem
                  checked={showArchived}
                  onCheckedChange={(next) => {
                    setShowArchived(next);
                    if (next) onShowArchived();
                  }}
                  closeOnClick
                >
                  <IconArchive size={18} />
                  <span className="min-w-0 flex-1 truncate">Show archived</span>
                  {showArchived && <IconCheck className="shrink-0 text-accent" size={17} />}
                </Menu.CheckboxItem>
              </Menu.Popup>
            </Menu.Root>
          </div>
        </div>

        {sections.length === 0 ? (
          <EmptyState
            title={
              query
                ? "No matching pull requests"
                : person === "all"
                  ? "No pull requests yet"
                  : `Nothing open for ${personLabel(person)}`
            }
          >
            {query
              ? "Try another search or workspace."
              : person === "all"
                ? "Workspaces with pull requests appear here."
                : "Pick someone else, or set the filter back to anyone."}
          </EmptyState>
        ) : (
          <div className={PR_LIST}>
            {sections.map((section) => (
              <section key={section.state} className="mb-7">
                <h2 className={PR_SECTION_LABEL}>
                  {section.label}
                  <span className="text-label font-medium text-faint">{section.rows.length}</span>
                </h2>
                {section.groups.map(([label, rows]) => (
                  <div key={label} className="mb-4">
                    <h3 className={PR_GROUP_LABEL}>
                      {label}
                      <span className="font-medium">{rows.length}</span>
                    </h3>
                    <div>
                      {rows.map((row) => {
                        const status = prStatusMark(row);
                        return (
                          <button
                            key={row.key}
                            className={PR_ROW}
                            onClick={() =>
                              row.session ? onSelect(row.session) : row.url && window.open(row.url, "_blank", "noopener")
                            }
                            title={`${repoLabel(row.repo)} · ${row.branch}`}
                          >
                            <span className={`${status.className} flex items-center`} title={status.label}>
                              <StateIcon state={row.state} />
                            </span>
                            {person === "all" && row.person ? (
                              <UserAvatar name={personLabel(row.person)} size={20} title={personLabel(row.person)} />
                            ) : (
                              <RepoTile name={row.repo} size={20} />
                            )}
                            <span className="min-w-0">
                              <span className="flex min-w-0 items-baseline gap-2">
                                <span className="truncate text-item-title font-medium leading-[1.3] text-fg">
                                  {row.title}
                                </span>
                                {row.number && (
                                  <span className="shrink-0 text-meta tabular-nums text-faint">
                                    #{row.number}
                                  </span>
                                )}
                              </span>
                              <span className="mt-0.5 flex min-w-0 items-center gap-1.5 text-meta text-faint">
                                <span className="truncate">{row.branch}</span>
                              </span>
                            </span>
                            <span className="justify-self-end text-meta tabular-nums phone:hidden">
                              {row.additions !== undefined && (
                                <span className="text-green">+{compactDiff(row.additions)}</span>
                              )}
                              {row.deletions !== undefined && (
                                <span className="ml-2 text-red">−{compactDiff(row.deletions)}</span>
                              )}
                            </span>
                            <span className="justify-self-end text-meta tabular-nums text-faint">
                              {compactAge(row.updatedAt)}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </section>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
