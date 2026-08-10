import { repoLabel } from "../lib/repo-label";
import { cn } from "../ui/cn";
import { FALLBACK_REPO, sessionRepoOr } from "../lib/session-repo";
import { sessionSourceLabel } from "../lib/brand";
import { SOURCE_CHIP, sourceChipTone } from "../lib/source-chip-classes";
import React, { useState, useMemo, useEffect } from "react";
import type { UnifiedSession } from "../lib/types";
import { relativeTime, archiveSessionApi } from "../lib/api";
import { useCurrentUser } from "./UserPicker";
import { docTitle, DEFAULT_DOC_TITLE } from "../lib/brand";
import { PageLayout } from "../ui/page";
import { EmptyState, ListSkeleton } from "../ui/state";

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

/** An archived session row. `rounded-control` is the exact token the legacy
 *  rule spelled (`calc(10px * var(--rf))`) and, unlike `rounded-full`, still
 *  matches base.css's squircle rule — so the corner keeps its shape and not
 *  just its radius. Taller and tighter on phones, where it is a tap target. */
const ROW =
  "flex w-full min-w-0 items-center gap-3 rounded-control border border-line bg-panel px-3.5 py-[11px] " +
  "text-left text-fg hover:border-line-strong hover:bg-hover " +
  "phone:gap-2 phone:px-[11px] phone:py-3";

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
        <>
          {/* A count is a claim. Until the index lands there is nothing to
              count, and "0 archived sessions" above a loading list is the
              same false statement the empty state used to make. */}
          {loaded &&
            `${archived.length} archived session${archived.length === 1 ? "" : "s"}. `}
          Done Plain tickets and anything idle for over a week land here
          automatically.
        </>
      }
      actions={
        <input
          className="sidebar-search"
          style={{ maxWidth: 260 }}
          placeholder="Search archived…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      }
      filters={
        <>
          <div className="inline-flex gap-0.5 rounded-md bg-[var(--bg-hover)] p-0.5" role="group" aria-label="Owner">
            <button
              className={cn("cursor-pointer rounded-sm border-none bg-transparent px-2.5 py-1 text-label font-medium whitespace-nowrap hover:text-dim phone:px-[13px] phone:py-[9px] phone:text-body", owner === "mine" ? "bg-active text-fg" : "text-faint")}
              onClick={() => setOwner("mine")}
            >
              My archived
            </button>
            <button
              className={cn("cursor-pointer rounded-sm border-none bg-transparent px-2.5 py-1 text-label font-medium whitespace-nowrap hover:text-dim phone:px-[13px] phone:py-[9px] phone:text-body", owner === "everyone" ? "bg-active text-fg" : "text-faint")}
              onClick={() => setOwner("everyone")}
            >
              Everyone
            </button>
          </div>
          {repos.length > 1 && (
            <div className="inline-flex gap-0.5 rounded-md bg-[var(--bg-hover)] p-0.5" role="group" aria-label="Repo">
              <button
                className={cn("cursor-pointer rounded-sm border-none bg-transparent px-2.5 py-1 text-label font-medium whitespace-nowrap hover:text-dim phone:px-[13px] phone:py-[9px] phone:text-body", repo === "all" ? "bg-active text-fg" : "text-faint")}
                onClick={() => setRepo("all")}
              >
                All repos
              </button>
              {repos.map((name) => (
                <button
                  key={name}
                  className={cn("cursor-pointer rounded-sm border-none bg-transparent px-2.5 py-1 text-label font-medium whitespace-nowrap hover:text-dim phone:px-[13px] phone:py-[9px] phone:text-body", repo === name ? "bg-active text-fg" : "text-faint")}
                  onClick={() => setRepo(name)}
                >
                  {repoLabel(name)}
                </button>
              ))}
            </div>
          )}
          <div className="inline-flex gap-0.5 rounded-md bg-[var(--bg-hover)] p-0.5" role="group" aria-label="Reason">
            <button
              className={cn("cursor-pointer rounded-sm border-none bg-transparent px-2.5 py-1 text-label font-medium whitespace-nowrap hover:text-dim phone:px-[13px] phone:py-[9px] phone:text-body", reason === "all" ? "bg-active text-fg" : "text-faint")}
              onClick={() => setReason("all")}
            >
              All
            </button>
            <button
              className={cn("cursor-pointer rounded-sm border-none bg-transparent px-2.5 py-1 text-label font-medium whitespace-nowrap hover:text-dim phone:px-[13px] phone:py-[9px] phone:text-body", reason === "auto" ? "bg-active text-fg" : "text-faint")}
              onClick={() => setReason("auto")}
            >
              Auto-archived
            </button>
            <button
              className={cn("cursor-pointer rounded-sm border-none bg-transparent px-2.5 py-1 text-label font-medium whitespace-nowrap hover:text-dim phone:px-[13px] phone:py-[9px] phone:text-body", reason === "manual" ? "bg-active text-fg" : "text-faint")}
              onClick={() => setReason("manual")}
            >
              Manual
            </button>
          </div>
        </>
      }
    >
      {archived.length === 0 && !loaded ? (
        // Not "nothing archived" — nothing YET. Claiming the list is empty
        // while it is still in flight is what makes a slow load read as data
        // loss. Matches ROW's geometry so the rows land where these sat.
        <ListSkeleton
          label="Loading archived sessions"
          rowClassName="phone:px-[11px] phone:py-3"
        />
      ) : archived.length === 0 ? (
        <EmptyState>
          Nothing archived{search || owner === "mine" || repo !== "all" ? " matches" : " yet"}.
        </EmptyState>
      ) : (
        <div className="flex flex-col gap-1.5">
          {archived.slice(0, 200).map((s) => (
            <button key={s.id} className={ROW} onClick={() => onSelect(s)}>
              <span className="flex min-w-0 flex-1 flex-col gap-1">
                <span className="truncate text-label font-medium phone:text-[15px]">
                  {s.title}
                </span>
                <span className="flex min-w-0 items-center gap-2.5 text-meta text-faint phone:text-[12px]">
                  <span
                    className={cn(
                      SOURCE_CHIP,
                      sourceChipTone(s.mode === "ask" ? "ask" : s.source),
                    )}
                  >
                    {s.automation ||
                      (s.mode === "ask" ? "ask" : sessionSourceLabel(s.source))}
                  </span>
                  {s.startedBy && <span>{s.startedBy}</span>}
                  <span>{relativeTime(s.lastActivity)}</span>
                  {isAutoReason(s) && (
                    <span className={SOURCE_CHIP} title={`Auto-archived (${s.archivedReason})`}>
                      auto
                    </span>
                  )}
                </span>
              </span>
              <span
                className="inline-flex cursor-pointer rounded-control border border-line-strong px-2.5 py-[3px] text-xs text-dim hover:border-faint hover:text-fg"
                role="button"
                onClick={(e) => handleUnarchive(e, s.id)}
              >
                {busy === s.id ? "…" : "Unarchive"}
              </span>
            </button>
          ))}
          {archived.length > 200 && (
            <div className="px-1 py-3.5 text-label text-faint">
              Showing the first 200. Refine your search to find older ones.
            </div>
          )}
        </div>
      )}
    </PageLayout>
  );
}
