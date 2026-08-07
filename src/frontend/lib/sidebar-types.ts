import React from "react";
import { AGENT_NAME } from "./brand";
import type { ReviewQueueItem } from "./review-queue";
import type { FeedDescriptor, FeedItem, SupportThread, UnifiedSession, Workspace } from "./types";
import { TEAM } from "../components/UserPicker";

// Only recognized people get their own "people" section. Sessions whose
// `startedBy` is something other than a real teammate — test labels
// ("proof-test", "image-test"), action/integration names ("Slack",
// "Make Alice editor (action)"), or empty — are hidden rather than shown as
// stray sections. The agent persona counts as a person here.
export const KNOWN_PEOPLE = new Set([...TEAM, AGENT_NAME].map((n) => n.toLowerCase()));

export interface Props {
	sessions: UnifiedSession[];
	/** Local-profile-only chrome; false on the hosted app. */
	localMode: boolean;
	/** The configured cloud upstream did not answer the latest merged-list poll. */
	cloudUnreachable: boolean;
	/** Initial sessions + project metadata have loaded, so dependent queues can render. */
	workspaceDataReady: boolean;
	/** Workspace folders that group sessions. */
	workspaces: Workspace[];
	/** Notes (id + title), to render pinned-note rows. */
	notes: Array<{ id: string; title: string }>;
	selectedId: string | null;
	/** The note currently open (highlights its pinned row), or null. */
	activeNoteId: string | null;
	/** True while the Notes tool is open. */
	notesActive: boolean;
	/** Open the shared Notes tool. */
	onOpenNotes: () => void;
	/** True while the Home view is open — highlights the Home entry. */
	homeActive: boolean;
	/** Open the home worktree index. */
	onOpenHome: () => void;
	/** True while the Tasks tool is open. */
	tasksActive: boolean;
	/** Open the current user's task list. */
	onOpenTasks: () => void;
	/** Current open-task count. */
	taskCount?: number;
	/** Open one automation's settings (list + detail). Called with the
	    automation's NAME — session rows only carry the name, not the id. */
	onOpenAutomation: (name: string) => void;
	/** Open a PR row's workspace (resolve-or-create, Review tab default). */
	onOpenPrItem: (item: ReviewQueueItem) => void;
	/** The open workspace id (route or the open session's), for row selection. */
	selectedWorkspaceId?: string | null;
	/** True while the PR Tinder deck is open — highlights its entry. */
	prTinderActive: boolean;
	/** Open PR Tinder (swipe triage of the repo's open PRs). */
	onOpenPrTinder: () => void;
	/** True while the Support Tinder deck is open — highlights its entry. */
	supportTinderActive: boolean;
	/** Open Support Tinder (swipe triage of the Plain Todo queue). */
	onOpenSupportTinder: () => void;
	/** True while the recurring Reports surface is open. */
	reportsActive: boolean;
	/** Open automation-produced recurring reports. */
	onOpenReports: () => void;
	/** True while the Analytics surface is open. */
	analyticsActive: boolean;
	/** Open the Analytics view (sessions/tokens/models/PRs over time). */
	onOpenAnalytics: () => void;
	/** True while the Desk overlay is open. */
	deskActive: boolean;
	/** Summon the Desk overlay (the ⌘J concierge session). */
	onOpenDesk: () => void;
	onSelect: (session: UnifiedSession) => void;
	/** Foreground a session's Review view-tab (from a session row's context menu). */
	onOpenReview: (session: UnifiedSession) => void;
	/** Open a Support ticket's workspace (resolve-or-create, Conversation tab). */
	onOpenTicket: (t: SupportThread) => void;
	/** Open a feed item's workspace (resolve-or-create — the feeds design). */
	onOpenFeedItem: (feed: FeedDescriptor, item: FeedItem) => void;
	onNewSession: () => void;
	/** Start a new session with a repo pre-selected (the repo-band "+" action). */
	onNewSessionInRepo: (repo: string) => void;
	/** Open a project — its sessions surface in the top tab strip. */
	onOpenWorkspace: (id: string) => void;
	/** Rename a project folder. */
	onRenameWorkspace: (id: string, name: string) => void;
	/** Delete a project folder (its sessions become standalone). */
	onDeleteWorkspace: (id: string) => void;
	/** Open a note (pinned-note row click). */
	onOpenNote: (id: string) => void;
	onOpenArchived: () => void;
	/** True while the archived view is open — highlights the Archived row. */
	archivedActive: boolean;
	/** Open the catch-up swipe deck (walk through your unread workspaces). */
	onOpenCatchUp: () => void;
	/** True while the catch-up deck is open — highlights its entry. */
	catchUpActive: boolean;
	/**
	 * Archive a session. `next` is the session that follows it in the sidebar's
	 * visible order (or the previous one for the last row) — the caller uses it
	 * to keep a live session open when the active one is archived.
	 */
	onArchive: (session: UnifiedSession, next: UnifiedSession | null) => void;
	/**
	 * Archive every session in a workspace (the row's archive icon). `next` is the
	 * first session of the workspace row that follows it in the sidebar's visible
	 * order (or the previous one for the last row) — the caller opens it when
	 * the active workspace is archived away.
	 */
	onArchiveWorkspace: (
		sessions: UnifiedSession[],
		next: UnifiedSession | null,
	) => void;
	/**
	 * Bring every session of an archived row back (the Archived band's unarchive
	 * icon) — the exact inverse of `onArchiveWorkspace`, minus the "what opens
	 * next" dance: nothing is closing, so nothing needs replacing.
	 */
	onUnarchiveWorkspace: (sessions: UnifiedSession[]) => void;
	/** Rename a session (double-click its title); empty title resets it. */
	onRename: (session: UnifiedSession, title: string) => void;
	/**
	 * Pin a workspace's sessions into a sidebar lane (or clear back to derived with
	 * `null`). Applies to every session in the row so the aggregated row lands there.
	 */
	onSetStatus: (sessions: UnifiedSession[], status: LaneChoice | null) => void;
	/** Who's viewing what right now (global presence), for live People rows. */
	teamViewing?: Array<{ user: string; sessionId: string }>;
	/**
	 * The mobile top-bar's right-side actions slot. On phones the sidebar's
	 * filter button lives here (next to Search) instead of in the workspace
	 * header — the header's own filter/+ buttons are hidden on mobile.
	 */
	headerActionsEl?: HTMLElement | null;
	/** Show a transient toast (e.g. "Link copied"). */
	onToast?: (message: string) => void;
}

export interface SidebarHandle {
	archiveSelected: () => void;
}

// Groups are rendered in three visually separated bands (spacing between each):
//   "personal"    — My sessions (split by status), Pinned
//   "people"      — one group per other teammate (+ ownerless source groups)
//   "automations" — one group per automation
// Distinct from the *project* bands below (renderRepoGroups + the feed bands):
// a project is a source of work — a repo or a feed like Plain — and the rows
// inside it are workspaces. See CONCEPTS.md.
export type GroupBand = "personal" | "people" | "automations";

// The bands below the personal one get a text header ("People" / "Automations").
export function bandLabel(band: GroupBand): string | null {
	if (band === "people") return "People";
	if (band === "automations") return "Automations";
	return null;
}

export interface Group {
	key: string;
	label: string;
	dotColor: string | null;
	band: GroupBand;
	items: UnifiedSession[];
}

// "My sessions" is split, Conductor-style, into status buckets. Order + labels +
// dot color are defined here; a session is bucketed by the first rule it matches.
export type MineStatus =
	| "needsinput"
	| "merged"
	| "pending"
	| "review"
	| "inprogress";

// What a lane control can write: a forced status lane, "mine" (claimed into
// your sidebar, free to follow its live state), or null to drop the entry.
export type LaneChoice = MineStatus | "mine";

// The "review" key renders as "Ready to merge" since the PR-queue dissolution:
// the lane holds work whose PR is green and mergeable (plus anything manually
// pinned there). The key stays "review" because per-user lanes and the legacy
// manualStatus overrides persist it server-side.
export const MINE_STATUS_META: Array<{
	key: MineStatus;
	label: string;
	dotColor: string;
}> = [
	{ key: "needsinput", label: "Needs input", dotColor: "var(--blue)" },
	{ key: "inprogress", label: "In progress", dotColor: "var(--yellow)" },
	{ key: "review", label: "Ready to merge", dotColor: "var(--green)" },
	{ key: "pending", label: "Backlog", dotColor: "var(--text-faint)" },
	{ key: "merged", label: "Done", dotColor: "var(--purple)" },
];

// ── Right-click context menu (workspace / session / PR rows) ──────────────────
// A single presentational menu shared by every sidebar row that has one. Rows
// pass a flat list of entries; a `status` entry renders the "Set status" row
// with a hover flyout (the sub-panel is a sibling of the menu, not a child, so
// the menu's own overflow can't clip it).
export type CtxEntry =
	| {
			kind: "item";
			icon?: React.ReactNode;
			label: string;
			shortcut?: string;
			danger?: boolean;
			onClick: () => void;
	  }
	| { kind: "sep" }
	| {
			kind: "status";
			current: MineStatus | null;
			onPick: (status: MineStatus | null) => void;
	  }
	| {
			kind: "snooze";
			/** Active snooze expiry (ISO), or null when not snoozed. */
			until: string | null;
			/** ISO until to snooze, or null to unsnooze. */
			onPick: (until: string | null) => void;
	  };
