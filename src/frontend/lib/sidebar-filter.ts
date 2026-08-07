import { DEFAULT_REPO_ID } from "./brand";
import type { Group } from "./sidebar-types";
import type { UnifiedSession } from "./types";
import { sessionRepoOr } from "./session-repo";
import { RepoTile } from "../components/RepoTile";

// Per-person group dots share the repo-tile swatch palette (RepoTile.tsx) —
// the same deterministic hash keeps each teammate's color stable.
// ── Support band: priority buckets + persisted filter ──
// Plain priorities are ints 0..3; unset buckets as Normal (Plain's default).
// Colors follow SupportTinder's priority palette (Urgent red / High yellow),
// with Normal on blue so the queue reads at a glance; `dot` colors the row
// circle of tickets that have no linked session (a session's live status
// still wins the dot).
export const SUPPORT_PRIORITY_GROUPS = [
	{ p: 0, label: "Urgent", cls: "text-red", dot: "var(--red)" },
	{ p: 1, label: "High", cls: "text-yellow", dot: "var(--yellow)" },
	{ p: 2, label: "Normal", cls: "text-blue", dot: "var(--blue)" },
	{ p: 3, label: "Low", cls: "text-faint", dot: "var(--text-faint)" },
] as const;
export const SUPPORT_PRIORITY_DOT: Record<number, string> = Object.fromEntries(
	SUPPORT_PRIORITY_GROUPS.map((g) => [g.p, g.dot]),
);

// ── Generic feed-band filters (the feeds design) ──
// Every band's filter menu is driven by the feed descriptor's FeedFilterSpec
// list: arg-mode specs feed the backing list tool (tella tags/playlists),
// meta-mode specs filter client-side over item.meta (plain assignee/labels,
// options derived from the items). Built-ins on every feed: "Linked session"
// and (non-lane feeds) "Sort". Selections persist per browser, per feed.
// This replaced plain's bespoke SupportFilterState menu.
export type FeedFilterValues = Record<string, string>;
export const FEED_FILTERS_KEY = "opensession-feed-filters";
export function readFeedFilters(): Record<string, FeedFilterValues> {
	try {
		const saved = JSON.parse(localStorage.getItem(FEED_FILTERS_KEY) || "{}");
		return saved && typeof saved === "object" ? saved : {};
	} catch {
		return {};
	}
}

/** `a.b` getter over item meta / option objects. */
export function dget(obj: unknown, path?: string): unknown {
	if (!path) return obj;
	let cur: any = obj;
	for (const seg of path.split(".")) {
		if (cur == null) return undefined;
		cur = cur[seg];
	}
	return cur;
}

export const EXPANDED_KEY = "opensession-sidebar-expanded";

export const DEFAULT_EXPANDED = [
	"recently",
	"pinned",
	"needsreview",
	"awaitingreview",
	"status:needsinput",
	"status:merged",
	"status:pending",
	"status:review",
	"status:inprogress",
	"status:snoozed",
];

export function readExpanded(): Set<string> {
	try {
		return new Set(
			JSON.parse(
				localStorage.getItem(EXPANDED_KEY) || JSON.stringify(DEFAULT_EXPANDED),
			),
		);
	} catch {
		return new Set(DEFAULT_EXPANDED);
	}
}

// ── Grouping / filtering controls (the filter popover) ─────────────────────
// The sidebar can be organized several ways ("Group by": Status, Repo as a
// flat Conductor-style list, Repo and status with lanes nested per repo,
// Repo and inbox with the activity bands nested per repo instead, Recently
// opened, or Inbox — an email-style flat list of two-line rows banded by
// activity), narrowed to a single repo ("Repo") or a single person
// ("Person"), and ordered by recency of activity or creation ("Sort by"). The
// choices persist together per browser; the default grouping is repo + status.
export type GroupBy =
	| "status"
	| "repo"
	| "repo-status"
	| "repo-inbox"
	| "recently"
	| "inbox";
export type SortBy = "updated" | "created";
// Session-less PR rows folded into the project lanes: the default shows your
// own PRs + explicit review requests (the retired PR band's default sources),
// "all" widens to everyone's open PRs (incl. automation output), "none" hides
// PR rows entirely.
export type PrsFilter = "default" | "all" | "none";
export const DEFAULT_PROJECT = DEFAULT_REPO_ID;
export const FILTER_KEY = "opensession-sidebar-filter";
// Bumped when the default grouping changes. Because setFilter persists the
// whole state, a stored "status" from before v2 is ambiguous — most people got
// it by touching Repo or Person, not by choosing it — so a pre-v2 blob keeps
// its repo/person/sort but takes the new default grouping once. Anything
// written after that carries v2 and is honoured verbatim.
export const FILTER_VERSION = 2;
export const DEFAULT_GROUP_BY: GroupBy = "repo-status";

export interface FilterState {
	groupBy: GroupBy;
	repo: string; // a repo id, or "all"
	// "me" (your workspaces — the default), "everyone" (literally all
	// workspaces), "unassigned" (the aggregate backlog view), or a lowercased
	// person key for a specific teammate.
	person: string;
	sort: SortBy;
	prs: PrsFilter;
}

export function readFilter(): FilterState {
	try {
		const v = JSON.parse(localStorage.getItem(FILTER_KEY) || "{}");
		const chosen = v.v === FILTER_VERSION;
		return {
			groupBy:
				v.groupBy === "repo" ||
				v.groupBy === "repo-status" ||
				v.groupBy === "repo-inbox" ||
				v.groupBy === "recently" ||
				v.groupBy === "inbox" ||
				(chosen && v.groupBy === "status")
					? v.groupBy
					: DEFAULT_GROUP_BY,
			repo: typeof v.repo === "string" ? v.repo : "all",
			// Legacy stored "all" behaved as "you" in the lanes — map it to "me"
			// so nobody's default flips to everyone.
			person:
				typeof v.person === "string" && v.person && v.person !== "all"
					? v.person
					: "me",
			sort: v.sort === "created" ? "created" : "updated",
			prs: v.prs === "all" || v.prs === "none" ? v.prs : "default",
		};
	} catch {
		return {
			groupBy: DEFAULT_GROUP_BY,
			repo: "all",
			person: "me",
			sort: "updated",
			prs: "default",
		};
	}
}

export function sessionRepo(s: UnifiedSession): string {
	// Repo-less feed/scratch sessions file under their feed's kind so they
	// don't mislabel as the default repo (the feeds design). Other surfaces
	// use different fallbacks on purpose — see lib/session-repo.
	return sessionRepoOr(s, s.externalRefs?.[0]?.kind || DEFAULT_PROJECT);
}

// Every `repo\nbranch` key a session's work can be reached by: its own checkout
// plus each PR / attached-repo / linked-PR ref it carries. Matching sessions to
// the open-PR list runs through this, so the PR-row dedupe and the live-review
// lookup below can't drift apart.
export function sessionPrKeys(c: UnifiedSession): string[] {
	const keys = c.branch ? [`${sessionRepo(c)}\n${c.branch}`] : [];
	for (const ref of [
		...(c.prs || []),
		...(c.attachedRepos || []),
		...(c.linkedPrs || []),
	])
		keys.push(`${ref.repo}\n${ref.branch}`);
	return keys;
}
