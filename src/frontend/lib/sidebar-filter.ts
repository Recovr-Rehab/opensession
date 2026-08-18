import React from "react";
import { DEFAULT_REPO_ID } from "./brand";
import type { Group } from "./sidebar-types";
import type { UnifiedSession } from "./types";
import { sessionRepoOr } from "./session-repo";
import { onRepoCountChanged, repoCount } from "./repo-count";
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
	"approvedreview",
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
// How the list is built is two questions, not one. "Lanes" says what the
// groups inside it are: an inbox's activity bands (Needs action / Recent /
// Yesterday / …, on two-line rows), the status lanes (Needs input / In
// progress / …), or none at all — one plain list where each row's own mark
// carries its status. "Group by" says whether those sit inside one band per
// project.
//
// This replaced a single menu whose five entries were the two answers written
// as one ("Status", "Project", "Project and status", "Project and inbox",
// "Inbox"), where changing the project banding meant re-picking the lanes
// along with it.
//
// The list is narrowed to a single repo ("Repo") or a single person
// ("Person"), and ordered by recency of activity or creation ("Sort by"). The
// choices persist together per browser.
export type Lanes = "inbox" | "status" | "none";
export type GroupBy = "none" | "repo";
export type SortBy = "updated" | "created";
// Session-less PR rows folded into the project lanes: the default shows your
// own PRs + explicit review requests (the retired PR band's default sources),
// "all" widens to everyone's open PRs (incl. automation output), "none" hides
// PR rows entirely.
export type PrsFilter = "default" | "all" | "none";
// Workspaces an agent started for itself through the automation machine
// identity. They sit in the ordinary lanes and say so with a robot beside the
// name (components/sidebar/AutoCreatedMark), so this is the way to get them out
// of the list on a day when there are more of them than you can read.
export type AutoCreatedFilter = "show" | "hide";
// A registered project with no work in it still draws a band, so a repo you
// just connected has somewhere to start from (see renderRepoGroups). On an
// instance with more projects than you work in, that is a screen of empty
// headings, and this takes them out. Scoping the list to one project still
// shows that project's band: asking for it by name is not clutter.
export type EmptyProjectsFilter = "show" | "hide";
export const DEFAULT_PROJECT = DEFAULT_REPO_ID;
export const FILTER_KEY = "opensession-sidebar-filter";
// Bumped when the grouping's shape or its default changes. Because setFilter
// persists the whole state, a grouping stored before the bump is ambiguous —
// most people got it by touching Repo or Person, not by choosing it — so a
// blob carrying the default of its day keeps its repo/person/sort but takes
// the new default. Anything written at the current version says what it
// means: since v3, "auto" is what an unpicked axis stores. v4 split the one
// grouping into the `lanes` / `groupBy` pair.
export const FILTER_VERSION = 4;

const LANES: Lanes[] = ["inbox", "status", "none"];
const GROUP_BYS: GroupBy[] = ["none", "repo"];

/**
 * The lanes to use when nobody picked any. A list of work you have not read
 * yet is an inbox; the status lanes are the deliberate choice, so they are
 * the one you ask for.
 */
export function defaultLanes(): Lanes {
	return "inbox";
}

/**
 * Whether to band by project when nobody said. A single project has nothing
 * to group by, so its lanes stand on their own; several get one band each. It
 * re-decides as projects are added, since the choice is stored as "auto"
 * rather than as its answer.
 *
 * The count is only unknown on the very first load, before `/api/repos`
 * answers (lib/repo-count) — assume several then, so an instance that has them
 * doesn't paint a flat list and regroup a moment later.
 */
export function defaultGroupBy(): GroupBy {
	const count = repoCount();
	return count !== null && count <= 1 ? "none" : "repo";
}

export interface FilterState {
	lanes: Lanes;
	groupBy: GroupBy;
	repo: string; // a repo id, or "all"
	// "me" (your workspaces — the default), "everyone" (literally all
	// workspaces), "unassigned" (the aggregate backlog view), or a lowercased
	// person key for a specific teammate.
	person: string;
	sort: SortBy;
	prs: PrsFilter;
	autoCreated: AutoCreatedFilter;
	emptyProjects: EmptyProjectsFilter;
}

/** What either axis can be on disk: a pick, or "auto" for nobody's pick. */
export type StoredLanes = Lanes | "auto";
export type StoredGroupBy = GroupBy | "auto";

export interface StoredFilterState
	extends Omit<FilterState, "lanes" | "groupBy"> {
	lanes: StoredLanes;
	groupBy: StoredGroupBy;
}

/**
 * The person lens is shared, not the sidebar's private business: the People
 * page, the facepiles and the sidebar's lanes read and write this one value,
 * so the person you pick is the sidebar you land in. Everything else in
 * `FilterState` still only has one reader (the sidebar's own popover), but it
 * rides along here because the whole state persists as one blob.
 */
const CHANGE_EVENT = "opensession-sidebar-filter-changed";
// What is stored (grouping possibly "auto") and what the app reads (that
// resolved against the project count). Both are cached; a write, another tab,
// or a change in the number of projects drops the resolved one.
let stored: StoredFilterState | null = null;
let current: FilterState | null = null;

export function getFilter(): FilterState {
	if (!current) {
		stored ||= readStoredFilter();
		current = {
			...stored,
			lanes: stored.lanes === "auto" ? defaultLanes() : stored.lanes,
			groupBy: stored.groupBy === "auto" ? defaultGroupBy() : stored.groupBy,
		};
	}
	return current;
}

export function setFilter(patch: Partial<FilterState>) {
	getFilter();
	// Picking a grouping from the menu makes it explicit: it stores the value
	// rather than "auto", so adding a project won't move it afterwards.
	const next: StoredFilterState = { ...stored!, ...patch };
	stored = next;
	current = null;
	localStorage.setItem(FILTER_KEY, JSON.stringify({ ...next, v: FILTER_VERSION }));
	window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function onFilterChanged(handler: () => void): () => void {
	window.addEventListener(CHANGE_EVENT, handler);
	return () => window.removeEventListener(CHANGE_EVENT, handler);
}

// Another tab's write: drop the cache so subscribers re-read from storage.
// Guarded because this module is reached from plain `bun test` runs (the pull
// request list's row-merging test imports the component), where there is no
// window to listen on and a module-scope call throws before the first test runs.
if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
	window.addEventListener("storage", (event) => {
		if (event.key !== FILTER_KEY) return;
		stored = null;
		current = null;
		window.dispatchEvent(new Event(CHANGE_EVENT));
	});
	// The project list landing (or a project being added) can change what
	// "auto" means, so the sidebar re-reads it.
	onRepoCountChanged(() => {
		if (stored?.groupBy !== "auto") return;
		if (current?.groupBy === defaultGroupBy()) return;
		current = null;
		window.dispatchEvent(new Event(CHANGE_EVENT));
	});
}

export function useSidebarFilter(): FilterState {
	const [state, setState] = React.useState(getFilter);
	React.useEffect(() => onFilterChanged(() => setState(getFilter())), []);
	return state;
}

/**
 * The lens as a page that only knows about people reads it — a lowercased
 * person key, or "all" when the filter is on everyone (or nobody is signed
 * in, where "me" can't resolve to a name).
 */
export function personScope(person: string, currentUser: string): string {
	if (person === "me") {
		const me = currentUser.trim().toLowerCase();
		return !me || me === "anonymous" ? "all" : me;
	}
	return person === "everyone" || person === "unassigned" ? "all" : person;
}

/** The reverse: your own face is stored as the default lens, so the filter
 *  keeps meaning "mine" if the signed-in user changes. */
export function personFilterFor(key: string, currentUser: string): string {
	return key === currentUser.trim().toLowerCase() ? "me" : key;
}

// The person lens is picked from several places: the People page, the pull
// request list's header, and the sidebar's People row. The mapping between
// "what the menu is showing" and "what the filter stores" lives here rather
// than once per surface.

/** The lens as the menu spells it: a person key, or "everyone" / "unassigned". */
export function personLensValue(person: string, currentUser: string): string {
	if (person === "unassigned") return "unassigned";
	const scope = personScope(person, currentUser);
	return scope === "all" ? "everyone" : scope;
}

/** What the menu's pick stores on the filter. */
export function personLensFilter(picked: string, currentUser: string): string {
	return picked === "all" || picked === "everyone"
		? "everyone"
		: personFilterFor(picked, currentUser);
}

/** The single grouping v3 and earlier stored, as the pair it always meant.
 *  "recently" is absent on purpose: it was never in the menu, and the sidebar
 *  drew it as the plain status lanes, so it reads as unset like any other
 *  value nobody recognises. */
const LEGACY_GROUPINGS: Record<string, StoredGrouping> = {
	status: { lanes: "status", groupBy: "none" },
	repo: { lanes: "none", groupBy: "repo" },
	"repo-status": { lanes: "status", groupBy: "repo" },
	"repo-inbox": { lanes: "inbox", groupBy: "repo" },
	inbox: { lanes: "inbox", groupBy: "none" },
};

interface StoredGrouping {
	lanes: StoredLanes;
	groupBy: StoredGroupBy;
}

/**
 * Which lanes and project banding a stored blob is actually asking for.
 * "auto" on an axis means nobody chose it, so the default decides and keeps
 * deciding.
 *
 * v4 stores the two separately and says what it means. Older blobs stored one
 * compound value, and since setFilter persists the whole state that value may
 * only be the default of its day — so v2's "repo-status" and pre-v2's
 * "status" read as unset, and every other value decomposes into the pair it
 * stood for. v3 is exempt: it already stored "auto" for an unpicked grouping,
 * so whatever it names is a real choice.
 */
function storedGrouping(v: any): StoredGrouping {
	const unset: StoredGrouping = { lanes: "auto", groupBy: "auto" };
	if (v?.v === FILTER_VERSION)
		return {
			lanes: LANES.includes(v.lanes) ? v.lanes : "auto",
			groupBy: GROUP_BYS.includes(v.groupBy) ? v.groupBy : "auto",
		};
	const legacy = LEGACY_GROUPINGS[v?.groupBy];
	if (!legacy) return unset;
	if (v.v === 3) return legacy;
	if (v.groupBy === "repo-status") return unset;
	if (v.groupBy === "status" && v.v !== 2) return unset;
	return legacy;
}

export function readStoredFilter(): StoredFilterState {
	try {
		const v = JSON.parse(localStorage.getItem(FILTER_KEY) || "{}");
		return {
			...storedGrouping(v),
			repo: typeof v.repo === "string" ? v.repo : "all",
			// Legacy stored "all" behaved as "you" in the lanes — map it to "me"
			// so nobody's default flips to everyone.
			person:
				typeof v.person === "string" && v.person && v.person !== "all"
					? v.person
					: "me",
			sort: v.sort === "created" ? "created" : "updated",
			prs: v.prs === "all" || v.prs === "none" ? v.prs : "default",
			autoCreated: v.autoCreated === "hide" ? "hide" : "show",
			emptyProjects: v.emptyProjects === "hide" ? "hide" : "show",
		};
	} catch {
		return {
			lanes: "auto",
			groupBy: "auto",
			repo: "all",
			person: "me",
			sort: "updated",
			prs: "default",
			autoCreated: "show",
			emptyProjects: "show",
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
