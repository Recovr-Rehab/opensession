import React, { useState, useMemo, useEffect, useLayoutEffect, useRef } from "react";
import { createPortal } from "react-dom";
import type {
	UnifiedSession,
	Workspace,
	SupportThread,
	FeedDescriptor,
	FeedItem,
} from "../lib/types";
import { isScratchWorkspace } from "../lib/sidebar-workspaces";
import type { ReviewQueueItem } from "../lib/review-queue";
import {
	fetchOpenPrs,
	fetchFeeds,
	fetchFeedItems,
	closePrPreviewApi,
	PR_CLOSED_EVENT,
	PR_REVIEW_SUBMITTED_EVENT,
	setPlainThreadStatusApi,
	type PrClosedDetail,
	type OpenPr,
} from "../lib/api";
import { useCurrentUser, TEAM } from "./UserPicker";
import { getLane, getLanes, onLanesChanged } from "../lib/lanes";
import { getPins, onPinsChanged, togglePin, reorderPins, unpin } from "../lib/pins";
import { clearSnooze, getSnoozes, onSnoozesChanged, setSnooze } from "../lib/snoozes";
import {
	clearHides,
	getHides,
	onHidesChanged,
	partitionHidden,
	setHide,
} from "../lib/hides";
import { Reorder } from "motion/react";
import { getRecents, onRecentsChanged } from "../lib/recents";
import { getReads, isUnread, markRead, markUnread, onReadsChanged } from "../lib/reads";
import { usePeople } from "../lib/people";
import { TeamPresencePopover, useTeamPresence } from "./TeamPresence";
import { sessionPath, absoluteLink, copyToClipboard } from "../lib/share-link";
import { hasDraft, onDraftsChanged } from "../lib/drafts";
import { getWsTimePref, onWsTimeChanged } from "../lib/workspace-time";
import { getSidebarOrder, onSidebarOrderChanged } from "../lib/sidebar-order";
import {
	getRepoOrder,
	mergeRepoOrder,
	normalizeRepoOrder,
	onRepoOrderChanged,
	replaceVisibleRepoOrder,
	setRepoOrder,
} from "../lib/repo-order";
import { UserAvatar, githubLoginFor } from "./UserAvatar";
import { shortTime } from "../lib/time";
import {
	IconChevronDown,
	IconArchive,
	IconUnarchive,
	IconBell,
	IconFilter,
	IconX,
	IconGear,
	IconCheck,
	IconFlame,
	IconInbox,
	IconPencil,
	IconPlus,
	IconEye,
	IconEyeOff,
	IconStack,
	IconPin,
	IconLink,
	IconMail,
	IconTrash,
	IconChart,
	IconFile,
	IconDotsHorizontal,
	IconGlobe,
	IconHome,
	IconListChecks,
} from "./icons";
import { Tooltip } from "../ui/tooltip";
import { ContextMenu, Menu } from "../ui/menu";
import { Popover } from "../ui/popover";
import { cn } from "../ui/cn";
import { pointerCanHover, RowCardPopup } from "./SidebarRowCards";
import { RepoTile, repoLabel } from "./RepoTile";
import { useIsPhone } from "../hooks/useIsPhone";
import { PrRow } from "./PrRow";
import { buildReviewQueue, reviewRowMatchesPersonFilter } from "../lib/review-queue";
import {
	readHiddenSidebarTools,
	setSidebarToolVisible,
	hideAllSidebarTools,
	onSidebarToolsChanged,
	SIDEBAR_TOOL_LABELS,
	type SidebarToolId,
} from "../lib/sidebar-tools";
import {
	onSidebarFeedsChanged,
	readHiddenSidebarFeeds,
	setSidebarFeedVisible,
} from "../lib/sidebar-feeds";
import {
	DEFAULT_GROUP_BY,
	DEFAULT_PROJECT,
	EXPANDED_KEY,
	FEED_FILTERS_KEY,
	FILTER_KEY,
	FILTER_VERSION,
	SUPPORT_PRIORITY_GROUPS,
	dget,
	readExpanded,
	readFeedFilters,
	readFilter,
	sessionPrKeys,
	sessionRepo,
	type FeedFilterValues,
	type FilterState,
} from "../lib/sidebar-filter";
import {
	isClaimed,
	mineStatus,
	ownedBy,
	pinnedLane,
	prLaneForSessions,
	stripPrTitlePrefix,
	wsPrApproved,
	wsPrMerged,
	wsPrReviewGivenBy,
} from "../lib/sidebar-lanes";
import { sessionHasPr } from "../lib/session-prs";
import { sessionHasWorkspace } from "../lib/session-workspace";
import {
	ARCHIVE_SHORTCUT_KEYS,
	ARCHIVE_WS_SHORTCUT_KEYS,
	LONG_PRESS_MS,
	LONG_PRESS_SLOP,
	SWIPE_AXIS_LOCK_PX,
	SWIPE_COMMIT_MS,
	SWIPE_OPEN_THRESHOLD,
	SWIPE_REVEAL_PX,
	clampSwipe,
	editableSwallowsArchiveChord,
	fullSwipeThreshold,
	isArchiveChord,
	swipeCommitOffset,
	type SwipeAction,
	type SwipeState,
} from "../lib/sidebar-swipe";
import { isApple } from "../lib/platform";
import {
	KNOWN_PEOPLE,
	MINE_STATUS_META,
	type CtxEntry,
	type Group,
	type GroupBand,
	type MineStatus,
	type Props,
	type SidebarHandle,
} from "../lib/sidebar-types";
import { FeedFilterMenu, FeedRow, SupportRow } from "./sidebar/FeedRows";
import { FilterPopover, RepoFilterChip } from "./sidebar/Filters";
import {
	RunTicker,
	SnoozeBadge,
	WsCardBody,
	WsMobileSheet,
	WsPrStatusMark,
	WsStatusMark,
} from "./sidebar/HoverCards";
import { SidebarCtxMenu } from "./sidebar/SidebarCtxMenu";
import { SidebarItem } from "./sidebar/SidebarItem";

// Re-exported for App.tsx, which holds the sidebar ref.
export type { SidebarHandle } from "../lib/sidebar-types";

const AUTOMATION_COLOR = "#d29922";

export const Sidebar = React.forwardRef<SidebarHandle, Props>(function Sidebar({
	sessions,
	localMode,
	cloudUnreachable,
	workspaceDataReady,
	workspaces,
	notes,
	selectedId,
	activeNoteId,
	notesActive,
	onOpenNotes,
	homeActive,
	onOpenHome,
	tasksActive,
	onOpenTasks,
	taskCount = 0,
	onOpenAutomation,
	onOpenPrItem,
	selectedWorkspaceId = null,
	prTinderActive,
	onOpenPrTinder,
	supportTinderActive,
	onOpenSupportTinder,
	reportsActive,
	onOpenReports,
	analyticsActive,
	onOpenAnalytics,
	onSelect,
	onOpenReview,
	onOpenTicket,
	onOpenFeedItem,
	onNewSession,
	onNewSessionInRepo,
	onOpenWorkspace,
	onRenameWorkspace,
	onDeleteWorkspace,
	onOpenNote,
	onOpenArchived,
	archivedActive,
	onOpenCatchUp,
	catchUpActive,
	onArchive,
	onArchiveWorkspace,
	onUnarchiveWorkspace,
	onRename,
	onSetStatus,
	teamViewing = [],
	headerActionsEl = null,
	onToast,
}, ref) {
	const isPhone = useIsPhone();
	const [search, setSearch] = useState("");
	// Groups are collapsed by default; the expanded set persists per browser
	const [expanded, setExpanded] = useState<Set<string>>(readExpanded);
	const [hiddenTools, setHiddenTools] = useState(readHiddenSidebarTools);
	const [hiddenFeeds, setHiddenFeeds] = useState(readHiddenSidebarFeeds);
	const [sidebarOrder, setSidebarOrder] = useState(getSidebarOrder);
	useEffect(
		() => onSidebarOrderChanged(() => setSidebarOrder(getSidebarOrder())),
		[],
	);
	// Tools stay at flex order 0, so only these bands move beneath it.
	const sectionOrder = (section: (typeof sidebarOrder)[number]) =>
		sidebarOrder.indexOf(section) + 1;
	const [savedRepoOrder, setSavedRepoOrder] = useState(getRepoOrder);
	useEffect(
		() => onRepoOrderChanged(() => setSavedRepoOrder(getRepoOrder())),
		[],
	);
	const [repoOrderDraft, setRepoOrderDraft] = useState<string[] | null>(null);
	const repoOrderAtDragStart = useRef<string[] | null>(null);
	const repoOrderPending = useRef<string[] | null>(null);
	const repoVisualOrder = useRef<string[] | null>(null);
	const repoDragging = useRef<string | null>(null);
	const [repoDragKey, setRepoDragKey] = useState<string | null>(null);
	const repoAutoScrollFrame = useRef<number | null>(null);
	const repoAutoScrollSpeed = useRef(0);
	const repoAutoScrollContainer = useRef<HTMLElement | null>(null);
	const repoJustDragged = useRef(false);
	const stopRepoAutoScroll = () => {
		if (repoAutoScrollFrame.current !== null)
			cancelAnimationFrame(repoAutoScrollFrame.current);
		repoAutoScrollFrame.current = null;
		repoAutoScrollSpeed.current = 0;
		repoAutoScrollContainer.current = null;
	};
	const tickRepoAutoScroll = () => {
		const container = repoAutoScrollContainer.current;
		if (!container || repoAutoScrollSpeed.current === 0) {
			repoAutoScrollFrame.current = null;
			return;
		}
		container.scrollTop += repoAutoScrollSpeed.current;
		repoAutoScrollFrame.current = requestAnimationFrame(tickRepoAutoScroll);
	};
	const handleRepoAutoScroll = (event: React.DragEvent<HTMLDivElement>) => {
		if (!repoDragging.current) return;
		event.preventDefault();
		const container = event.currentTarget;
		const rect = container.getBoundingClientRect();
		const edge = Math.min(96, rect.height * 0.18);
		const fromTop = event.clientY - rect.top;
		const fromBottom = rect.bottom - event.clientY;
		const maxSpeed = 18;
		let speed = 0;
		if (fromTop < edge)
			speed = -Math.ceil(maxSpeed * (1 - Math.max(0, fromTop) / edge));
		else if (fromBottom < edge)
			speed = Math.ceil(maxSpeed * (1 - Math.max(0, fromBottom) / edge));
		if (speed === 0) {
			stopRepoAutoScroll();
			return;
		}
		repoAutoScrollContainer.current = container;
		repoAutoScrollSpeed.current = speed;
		if (repoAutoScrollFrame.current === null)
			repoAutoScrollFrame.current = requestAnimationFrame(tickRepoAutoScroll);
	};
	useEffect(
		() => () => {
			if (repoAutoScrollFrame.current !== null)
				cancelAnimationFrame(repoAutoScrollFrame.current);
		},
		[],
	);
	const [pins, setPins] = useState<string[]>(getPins);
	// Per-user workspace snoozes (row key → ISO until). An overlay like pins:
	// actively-snoozed rows park in the Snoozed section; the wake sweep below
	// prunes lapsed entries and marks their rows unread.
	const [snoozes, setSnoozesState] = useState<Record<string, string>>(
		getSnoozes,
	);
	// Per-user sidebar hides (row key → ISO hidden-at). The personal
	// counterpart to Archive, which is global: a hidden row leaves only THIS
	// user's sidebar, and the session keeps running for everyone else.
	const [hides, setHidesState] = useState<Record<string, string>>(getHides);
	// Drag-to-reorder in the Pinned band. onReorder fires continuously during a
	// drag, so the in-flight order lives in local state (pinOrderDraft) and only
	// commits to the pins store on drop — mirroring the composer queue's pattern.
	// pinDragKey marks the floating row (background + stacking); pinJustDragged
	// swallows the click that lands on the row right after a drop.
	const [pinOrderDraft, setPinOrderDraft] = useState<string[] | null>(null);
	const pinOrderPending = useRef<string[] | null>(null);
	const [pinDragKey, setPinDragKey] = useState<string | null>(null);
	const pinJustDragged = useRef(false);
	// Drag-into-lane: while a Pinned row is mid-drag, the status lanes below
	// double as drop targets (per-repo lanes only for the row's own repo).
	// pinDragMeta carries the dragged entry's sessions/repo/pin keys; laneDropHover
	// marks the lane under the pointer. Both keep a ref twin so the drag-end
	// commit never reads a stale closure mid-batch.
	type PinDragMeta = {
		repo: string | null;
		sessions: UnifiedSession[];
		pinKeys: string[];
	};
	type LaneDropTarget = { gkey: string; lane: MineStatus };
	const [pinDragMeta, setPinDragMeta] = useState<PinDragMeta | null>(null);
	const pinDragMetaRef = useRef<PinDragMeta | null>(null);
	const [laneDropHover, setLaneDropHover] = useState<LaneDropTarget | null>(
		null,
	);
	const laneDropHoverRef = useRef<LaneDropTarget | null>(null);

	// Hit-test the pointer against the lane drop targets below the Pinned band
	// (they carry data-lane-* attributes while a drag is live). Geometric rect
	// checks instead of elementFromPoint — the dragged row itself rides under
	// the pointer and would swallow the hit.
	function updateLaneDropHover(clientX: number, clientY: number) {
		const meta = pinDragMetaRef.current;
		let next: LaneDropTarget | null = null;
		if (meta && meta.sessions.length > 0) {
			const targets =
				sidebarScrollRef.current?.querySelectorAll<HTMLElement>(
					"[data-lane-drop]",
				) ?? [];
			for (const el of targets) {
				const r = el.getBoundingClientRect();
				const inside =
					clientX >= r.left &&
					clientX <= r.right &&
					clientY >= r.top &&
					clientY <= r.bottom;
				if (!inside) continue;
				// Per-repo lanes only take rows of their own repo; the global
				// lanes (no data-lane-repo) take anything.
				const laneRepo = el.dataset.laneRepo || "";
				if (laneRepo && laneRepo !== meta.repo) continue;
				next = {
					gkey: el.dataset.laneDrop!,
					lane: el.dataset.laneStatus as MineStatus,
				};
				break;
			}
		}
		if (laneDropHoverRef.current?.gkey !== next?.gkey) {
			laneDropHoverRef.current = next;
			setLaneDropHover(next);
		}
	}
	const [recents, setRecents] = useState<string[]>(getRecents);
	// Per-session last-read marks, driving the unread dot. Kept in sync via the
	// same event the viewer fires when it marks a session read.
	const [reads, setReads] = useState(getReads);
	const currentUser = useCurrentUser();
	// Team directory (GET /api/people) — the always-on People band roster.
	const roster = usePeople();
	// The same roster with live status attached, for the Home entry's face pile.
	const team = useTeamPresence({ sessions, teamViewing, currentUser });
	// Per-person latest session + any-running, keyed by lowercased first name —
	// what a People row shows when the person isn't live right now.
	const personActivity = useMemo(() => {
		const m = new Map<
			string,
			{ id: string; title: string; last: string; running: boolean }
		>();
		for (const s of sessions) {
			if (s.archived || s.automation) continue;
			const key = (s.startedBy || "").toLowerCase();
			if (!key) continue;
			const cur = m.get(key);
			const running = (cur?.running ?? false) || s.isRunning === true;
			if (!cur || (s.lastActivity || "") > cur.last) {
				m.set(key, {
					id: s.id,
					title: s.title || "",
					last: s.lastActivity || "",
					running,
				});
			} else if (running !== cur.running) {
				m.set(key, { ...cur, running });
			}
		}
		return m;
	}, [sessions]);
	useEffect(
		() => onSidebarToolsChanged(() => setHiddenTools(readHiddenSidebarTools())),
		[],
	);
	useEffect(
		() => onSidebarFeedsChanged(() => setHiddenFeeds(readHiddenSidebarFeeds())),
		[],
	);
	const sidebarScrollRef = useRef<HTMLDivElement>(null);

	// CSS has no interoperable :stuck selector. Track the shared sidebar
	// scrollport instead so section/lane labels can stay transparent in-flow and
	// gain an opaque surface only while position:sticky is actively pinning them.
	useLayoutEffect(() => {
		const root = sidebarScrollRef.current;
		if (!root) return;
		let frame = 0;
		const selector = [
			".sidebar-sticky-head",
			".sidebar-status-group > .sidebar-group-header",
			".sidebar-group--pinned > .sidebar-group-header",
			".sidebar-group--review > .sidebar-group-header",
			".sidebar-repo-group > .sidebar-repo-head",
		].join(",");

		const update = () => {
			frame = 0;
			const rootTop = root.getBoundingClientRect().top;
			root.querySelectorAll<HTMLElement>(selector).forEach((header) => {
				const style = getComputedStyle(header);
				const parent = header.parentElement;
				if (style.position !== "sticky" || !parent) {
					header.classList.remove("is-stuck");
					return;
				}
				const stickyTop = Number.parseFloat(style.top) || 0;
				const rect = header.getBoundingClientRect();
				const pinned = rect.top <= rootTop + stickyTop + 0.5;
				// Pin-line position alone also matches a header that naturally
				// RESTS at its sticky offset (the first section at scrollTop 0 —
				// the solid-pill-while-unscrolled bug), so additionally require
				// real displacement from the parent. All of these headers sit
				// flush with their parent's top in static layout, so a positive
				// delta means sticky is actively holding the header back. (Don't
				// try offsetTop for this: Chromium reports the displaced sticky
				// position there, not static layout.)
				const displaced =
					rect.top - parent.getBoundingClientRect().top > 1.5;
				header.classList.toggle("is-stuck", pinned && displaced);
			});
		};
		const schedule = () => {
			if (!frame) frame = requestAnimationFrame(update);
		};

		update();
		root.addEventListener("scroll", schedule, { passive: true });
		window.addEventListener("resize", schedule);
		const resizeObserver = new ResizeObserver(schedule);
		resizeObserver.observe(root);
		const mutationObserver = new MutationObserver(schedule);
		mutationObserver.observe(root, { childList: true, subtree: true });

		return () => {
			root.removeEventListener("scroll", schedule);
			window.removeEventListener("resize", schedule);
			resizeObserver.disconnect();
			mutationObserver.disconnect();
			if (frame) cancelAnimationFrame(frame);
		};
	}, []);

	// Filter popover (group by / repo / sort) — its choices persist together.
	const [filter, setFilterState] = useState<FilterState>(readFilter);
	const [filterOpen, setFilterOpen] = useState(false);
	const filterBtnRef = useRef<HTMLButtonElement>(null);
	// The phone stand-in for the header filter button (portaled into the top
	// bar next to Search). The popover anchors to whichever button is live.
	const mobileFilterBtnRef = useRef<HTMLButtonElement>(null);
	function setFilter(patch: Partial<FilterState>) {
		setFilterState((prev) => {
			const next = { ...prev, ...patch };
			localStorage.setItem(
				FILTER_KEY,
				JSON.stringify({ ...next, v: FILTER_VERSION }),
			);
			return next;
		});
	}

	// The active repo-filter chip prefers to sit inline in the "My sessions"
	// header (right after the title); it drops to its own row only when the
	// sidebar is too narrow to fit it there. `repoInline` is decided by measuring
	// the header against an off-layout probe copy of the chip, so toggling it can't
	// feed back into the measurement (title/actions/probe widths don't depend on
	// where the real chip lands).
	const [repoInline, setRepoInline] = useState(true);
	const headRef = useRef<HTMLDivElement>(null);
	const titleRef = useRef<HTMLSpanElement>(null);
	const actionsRef = useRef<HTMLDivElement>(null);
	const probeRef = useRef<HTMLSpanElement>(null);
	// Client-observed run starts, keyed by workspace-row key — the fallback when
	// the server hasn't stamped runStartedAt yet (external CLI runs, or the brief
	// gap between isRunning flipping via WS and the next sessions poll). Entries
	// are pruned once a row stops running so a later run starts its clock fresh.
	const runStartSeen = useRef<Map<string, number>>(new Map());
	useLayoutEffect(() => {
		if (filter.repo === "all") return;
		const measure = () => {
			const head = headRef.current;
			const title = titleRef.current;
			const actions = actionsRef.current;
			const probe = probeRef.current;
			if (!head || !title || !actions || !probe) return;
			const GAP = 6; // .sidebar-workspace-head gap
			const MARGIN = 8; // breathing room so it never crowds the buttons
			const avail =
				head.clientWidth -
				title.offsetWidth -
				actions.offsetWidth -
				GAP * 2 -
				MARGIN;
			setRepoInline(probe.offsetWidth <= avail);
		};
		measure();
		const ro = new ResizeObserver(measure);
		if (headRef.current) ro.observe(headRef.current);
		return () => ro.disconnect();
		// filter.person changes the title text ("X's workspaces"), so re-measure.
	}, [filter.repo, filter.person]);

	useEffect(() => onPinsChanged(() => setPins(getPins())), []);
	useEffect(() => onSnoozesChanged(() => setSnoozesState(getSnoozes())), []);
	useEffect(() => onHidesChanged(() => setHidesState(getHides())), []);
	// Per-user lanes (lib/lanes.ts). mineStatus/pinnedLane read the lib cache
	// directly; this state exists to re-render (and re-derive the memos below)
	// when your lanes change.
	const [lanes, setLanesState] = useState<Record<string, string>>(getLanes);
	useEffect(() => onLanesChanged(() => setLanesState(getLanes())), []);
	useEffect(() => onRecentsChanged(() => setRecents(getRecents())), []);
	useEffect(() => onReadsChanged(() => setReads(getReads())), []);
	// Re-render when a composer draft appears/disappears — rows check hasDraft()
	// during render to show the Slack-style "unsent draft" pencil.
	const [, setDraftsRev] = useState(0);
	useEffect(() => onDraftsChanged(() => setDraftsRev((v) => v + 1)), []);
	// Opt-in "last used" time badge on workspace rows (off / always / on hover).
	const [wsTimePref, setWsTimePref] = useState(getWsTimePref);
	useEffect(() => onWsTimeChanged(() => setWsTimePref(getWsTimePref())), []);

	// Right-click menu on a workspace row (mark unread / pin / status / rename /
	// copy link / delete), and inline rename (double-click the project name).
	const [workspaceMenu, setWorkspaceMenu] = useState<{
		id: string;
		x: number;
		y: number;
	} | null>(null);
	const [editingWorkspaceId, setEditingWorkspaceId] = useState<string | null>(null);
	const [workspaceDraft, setWorkspaceDraft] = useState("");
	function commitWorkspaceRename() {
		if (editingWorkspaceId) {
			const name = workspaceDraft.trim();
			if (name) onRenameWorkspace(editingWorkspaceId, name);
		}
		setEditingWorkspaceId(null);
	}
	// Inline rename for workspace-less rows (slack/linear/solo sessions). These
	// used window.prompt(), which iOS standalone PWAs silently suppress —
	// Rename tapped, nothing happened. Same inline editor as workspace rows;
	// an empty commit clears the manual title back to the derived one.
	const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
	const [sessionDraft, setSessionDraft] = useState("");
	function startSessionRename(session: { id: string; title: string }) {
		setSessionDraft(session.title);
		setEditingSessionId(session.id);
	}
	function commitSessionRename(session: UnifiedSession) {
		if (editingSessionId) onRename(session, sessionDraft.trim());
		setEditingSessionId(null);
	}
	/** Is this row's title currently being inline-edited (workspace or session)? */
	function rowRenameEditing(row: WsRow): boolean {
		return row.workspace
			? editingWorkspaceId === row.workspace.id
			: !!row.sessions[0] && editingSessionId === row.sessions[0].id;
	}
	useEffect(() => {
		if (!workspaceMenu) return;
		const close = () => setWorkspaceMenu(null);
		window.addEventListener("click", close);
		window.addEventListener("scroll", close, true);
		return () => {
			window.removeEventListener("click", close);
			window.removeEventListener("scroll", close, true);
		};
	}, [workspaceMenu]);

	// The Archived row counts *my* archived sessions (the current user's), and honors
	// the active repo filter — same lens as the archived page it opens.
	const archivedCount = useMemo(() => {
		const user = currentUser.toLowerCase();
		return sessions.filter(
			(s) =>
				s.archived &&
				!s.automation &&
				s.startedBy &&
				s.startedBy.toLowerCase() === user &&
				(filter.repo === "all" || sessionRepo(s) === filter.repo),
		).length;
	}, [sessions, currentUser, filter.repo]);

	// Catch-up badge: how many of *my* unread workspaces the deck would walk
	// through (distinct workspace groups, same grouping the deck uses) — so the
	// count matches the "N Left" it opens on.
	const catchUpCount = useMemo(() => {
		const user = currentUser.toLowerCase();
		const groups = new Set<string>();
		for (const s of sessions) {
			if (s.archived || s.automation) continue;
			if (!s.startedBy || s.startedBy.toLowerCase() !== user) continue;
			if (!isUnread(s.id, s.lastActivity, reads)) continue;
			groups.add(s.workspaceId ? `ws:${s.workspaceId}` : `session:${s.id}`);
		}
		return groups.size;
	}, [sessions, currentUser, reads]);

	// The repo-wide open-PR list (every open PR, session or not), from the
	// server's batched cache. Null until the first fetch lands — the rows memo
	// falls back to session-derived PRs so the section still renders if the
	// endpoint is unreachable.
	const [openPrs, setOpenPrs] = useState<OpenPr[] | null>(null);
	const prCloseGeneration = useRef(0);
	const closedPrTombstones = useRef(new Map<string, number>());
	const openPrRequestSequence = useRef(0);
	const latestOpenPrResponse = useRef(0);
	useEffect(() => {
		let alive = true;
		const load = () => {
			const requestSequence = ++openPrRequestSequence.current;
			const requestGeneration = prCloseGeneration.current;
			return (
				fetchOpenPrs()
					.then((prs) => {
						if (!alive) return;
						if (requestSequence < latestOpenPrResponse.current) return;
						latestOpenPrResponse.current = requestSequence;
						for (const [url, closeGeneration] of closedPrTombstones.current) {
							if (closeGeneration <= requestGeneration)
								closedPrTombstones.current.delete(url);
						}
						setOpenPrs(
							prs.filter((pr) => !closedPrTombstones.current.has(pr.url)),
						);
					})
					.catch(() => {})
			);
		};
		load();
		const onReviewSubmitted = () => void load();
		window.addEventListener(PR_REVIEW_SUBMITTED_EVENT, onReviewSubmitted);
		// The response is backed by the server's PR cache, but also carries live
		// Open Session review state. Poll it often enough that a PR moves in and out
		// of "Review running" promptly without triggering extra GitHub requests.
		const t = setInterval(load, 15_000);
		return () => {
			alive = false;
			clearInterval(t);
			window.removeEventListener(PR_REVIEW_SUBMITTED_EVENT, onReviewSubmitted);
		};
	}, []);
	useEffect(() => {
		const onClosed = (event: Event) => {
			const { repo, branch, url } = (event as CustomEvent<PrClosedDetail>).detail;
			if (url) {
				prCloseGeneration.current++;
				closedPrTombstones.current.set(url, prCloseGeneration.current);
			}
			setOpenPrs((current) =>
				current?.filter(
					(pr) =>
						!(url && pr.url === url) &&
						!(!url && repo === pr.repo && branch === pr.branch),
				) ?? null,
			);
		};
		window.addEventListener(PR_CLOSED_EVENT, onClosed);
		return () => window.removeEventListener(PR_CLOSED_EVENT, onClosed);
	}, []);

	// Generic feed bands (Tella videos, … — the feeds design): descriptors
	// once on mount. Hidden feeds remain available to Settings but do not poll.
	const [feeds, setFeeds] = useState<FeedDescriptor[]>([]);
	const [feedItems, setFeedItems] = useState<Record<string, FeedItem[]>>({});
	useEffect(() => {
		let alive = true;
		fetchFeeds()
			.then((descriptors) => {
				if (!alive) return;
				setFeeds(descriptors);
			})
			.catch(() => {});
		return () => {
			alive = false;
		};
	}, []);
	const visibleFeeds = useMemo(
		() => feeds.filter((feed) => !hiddenFeeds.has(feed.id)),
		[feeds, hiddenFeeds],
	);

	// The Support queue now arrives through the generic feeds poll: the plain
	// feed's items carry the full SupportThreadSummary in meta, so all the
	// bespoke Support UI (SupportRow, filters, Tinder hand-offs) keeps working
	// off the same derived shape (the feeds design W5).
	const supportThreads = useMemo<SupportThread[] | null>(() => {
		const items = feedItems["plain"];
		if (!items) return null;
		return items.map((i) => i.meta as unknown as SupportThread);
	}, [feedItems]);

	// Newest live session per feed item (keyed `<kind>:<id>`) — a feed row with
	// one wears that session's status dot.
	const feedSessionByRef = useMemo(() => {
		const m = new Map<string, UnifiedSession>();
		for (const s of sessions) {
			if (s.archived || !s.externalRefs?.length) continue;
			for (const r of s.externalRefs) {
				const key = `${r.kind}:${r.id}`;
				const prev = m.get(key);
				if (!prev || s.lastActivity > prev.lastActivity) m.set(key, s);
			}
		}
		return m;
	}, [sessions]);

	// Per-feed filter selections (generic — see FeedFilterMenu). Arg-mode
	// changes refetch that feed immediately; meta/builtin ones just re-derive.
	const [feedFilters, setFeedFiltersState] = useState<
		Record<string, FeedFilterValues>
	>(readFeedFilters);
	const feedFiltersRef = useRef(feedFilters);
	feedFiltersRef.current = feedFilters;
	const argFiltersFor = (feed: FeedDescriptor, all = feedFiltersRef.current) =>
		Object.fromEntries(
			(feed.filters || [])
				.filter((f) => f.mode !== "meta")
				.map((f) => [f.key, (all[feed.id] || {})[f.key] || ""])
				.filter(([, v]) => v),
		) as Record<string, string>;
	const setFeedFilter = (feed: FeedDescriptor, key: string, value: string) => {
		setFeedFiltersState((prev) => {
			const next = {
				...prev,
				[feed.id]: { ...(prev[feed.id] || {}), [key]: value },
			};
			try {
				localStorage.setItem(FEED_FILTERS_KEY, JSON.stringify(next));
			} catch {}
			const spec = (feed.filters || []).find((f) => f.key === key);
			if (spec && spec.mode !== "meta")
				fetchFeedItems(feed.id, argFiltersFor(feed, next))
					.then((items) =>
						setFeedItems((p) => ({ ...p, [feed.id]: items })),
					)
					.catch(() => {});
			return next;
		});
	};
	// Items use the same gentle 60s cadence as Support (the server caches ~60s).
	// Re-enabling a source loads it immediately; hiding one tears its timer down.
	useEffect(() => {
		if (visibleFeeds.length === 0) return;
		let alive = true;
		const load = () => {
			for (const feed of visibleFeeds) {
				fetchFeedItems(feed.id, argFiltersFor(feed))
					.then((items) => {
						if (alive)
							setFeedItems((prev) => ({ ...prev, [feed.id]: items }));
					})
					.catch(() => {});
			}
		};
		load();
		const timer = setInterval(load, 60_000);
		return () => {
			alive = false;
			clearInterval(timer);
		};
	}, [visibleFeeds]);

	// Newest live session per Plain thread — a Support row with one opens that
	// session instead of the session-less ticket preview.
	const supportSessionByThread = useMemo(() => {
		const m = new Map<string, UnifiedSession>();
		for (const s of sessions) {
			if (s.archived || !s.plainThreadId) continue;
			const prev = m.get(s.plainThreadId);
			if (!prev || s.lastActivity > prev.lastActivity)
				m.set(s.plainThreadId, s);
		}
		return m;
	}, [sessions]);

	// Distinct repos across the (non-archived) sessions, most-used first, for the
	// Repo filter dropdown. Built off every session (not the search-filtered set)
	// so the options don't churn while you type.
	const discoveredRepos = useMemo(() => {
		const counts = new Map<string, number>();
		for (const s of sessions) {
			if (s.archived || s.mode === "scratch") continue;
			const p = sessionRepo(s);
			counts.set(p, (counts.get(p) || 0) + 1);
		}
		for (const pr of openPrs || [])
			counts.set(pr.repo, (counts.get(pr.repo) || 0) + 1);
		return Array.from(counts.entries())
			.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
			.map(([name]) => name);
	}, [sessions, openPrs]);
	const repos = useMemo(
		() => mergeRepoOrder(repoOrderDraft ?? savedRepoOrder, discoveredRepos),
		[repoOrderDraft, savedRepoOrder, discoveredRepos],
	);
	const completeRepoOrder = useMemo(() => {
		const next = normalizeRepoOrder(savedRepoOrder);
		const seen = new Set(next);
		for (const repo of discoveredRepos) {
			if (!seen.has(repo)) {
				seen.add(repo);
				next.push(repo);
			}
		}
		return next;
	}, [savedRepoOrder, discoveredRepos]);
	useEffect(() => {
		if (
			savedRepoOrder.length > 0 &&
			JSON.stringify(completeRepoOrder) !== JSON.stringify(savedRepoOrder)
		)
			setRepoOrder(completeRepoOrder);
	}, [savedRepoOrder, completeRepoOrder]);

	// Distinct people who started sessions, most-active first, for the Person
	// filter dropdown. Only recognized teammates (see KNOWN_PEOPLE) are offered;
	// keyed by lowercased name to merge casing, with the first-seen spelling as
	// the display label. Built off every session so options don't churn on search.
	const people = useMemo(() => {
		const entries = new Map<string, { label: string; count: number }>();
		for (const s of sessions) {
			if (s.archived || s.automation || !s.startedBy) continue;
			const key = s.startedBy.toLowerCase();
			if (!KNOWN_PEOPLE.has(key)) continue;
			const e = entries.get(key) || { label: s.startedBy, count: 0 };
			e.count++;
			entries.set(key, e);
		}
		for (const pr of openPrs || []) {
			if (!pr.person || entries.has(pr.person)) continue;
			const label =
				TEAM.find((name) => name.toLowerCase() === pr.person) || pr.person;
			entries.set(pr.person, { label, count: 1 });
		}
		return Array.from(entries.entries())
			.sort((a, b) => b[1].count - a[1].count || a[1].label.localeCompare(b[1].label))
			.map(([key, { label }]) => ({ key, label }));
	}, [sessions, openPrs]);

	// Every non-archived session, narrowed by the repo/person filters and search.
	// Rows are built per-workspace below; a session matching the filter surfaces its
	// whole workspace row.
	const filtered = useMemo(() => {
		let visible = sessions.filter((s) => !s.archived);
		if (filter.repo !== "all") {
			// A workspace can span repos, and a session's own repo is just the
			// checkout it runs from — so a session also matches when its workspace
			// is the filtered repo. Without this, narrowing to a repo hides the
			// very workspaces that belong to it.
			const wsRepo = new Map(workspaces.map((p) => [p.id, p.repo]));
			visible = visible.filter(
				(s) =>
					s.mode !== "scratch" &&
					(sessionRepo(s) === filter.repo ||
						(!!s.workspaceId && wsRepo.get(s.workspaceId) === filter.repo)),
			);
		}
		// Only a specific teammate narrows the sessions themselves. "me" and
		// "everyone" keep every session so workspace rows stay whole (your
		// workspaces can contain teammates' sessions, and pinned rows survive) —
		// the owner lens is applied per-row in focusWsRows instead.
		if (
			filter.person !== "me" &&
			filter.person !== "everyone" &&
			filter.person !== "unassigned"
		)
			visible = visible.filter(
				(s) =>
					!s.automation &&
					!!s.startedBy &&
					s.startedBy.toLowerCase() === filter.person,
			);
		if (!search) return visible;
		const q = search.toLowerCase();
		return visible.filter(
			(s) =>
				s.title.toLowerCase().includes(q) ||
				(s.branch || "").toLowerCase().includes(q) ||
				(s.startedBy || "").toLowerCase().includes(q) ||
				(s.automation || "").toLowerCase().includes(q),
		);
	}, [sessions, workspaces, search, filter.repo, filter.person]);

	// Sort order applied to every group's items: newest activity or newest
	// creation first. Groups read from this pre-sorted list so ordering is uniform.
	const sorted = useMemo(() => {
		const key = filter.sort === "created" ? "createdAt" : "lastActivity";
		return [...filtered].sort(
			(a, b) => new Date(b[key]).getTime() - new Date(a[key]).getTime(),
		);
	}, [filtered, filter.sort]);

	// PRs with an automated Open Session review in flight, keyed `repo\nbranch`
	// — the same signal the PR rows spell out as "Review running". The review
	// itself runs in a `bks-ghpr-*` session that lives in the Automations band, so
	// the workspace lanes below can't see it in their own sessions.
	const activeReviewPrKeys = useMemo(() => {
		const keys = new Set<string>();
		for (const pr of openPrs || [])
			if (pr.reviewActive) keys.add(`${pr.repo}\n${pr.branch}`);
		return keys;
	}, [openPrs]);

	// ── Workspace rows ──────────────────────────────────────────────────────
	// The sidebar's main list is Workspaces (not individual sessions): one row per
	// workspace, plus one implicit row per not-yet-wrapped standalone session (the
	// pre-migration case — the data migration wraps those 1:1). A row's status
	// dot is derived from its most urgent session; clicking opens the first session.
	interface WsRow {
		/** Pin/menu key: `workspace:<id>` for real workspaces, the session id solo. */
		key: string;
		/** Real workspace record, or null for an implicit single-session row. */
		workspace: Workspace | null;
		name: string;
		sessions: UnifiedSession[]; // createdAt asc — sessions[0] is "the first session"
		status: MineStatus;
		lastActivity: string;
		createdAt: string;
		unread: boolean;
		running: boolean;
		/** Lowercased owner (workspace creator, else the first session's starter). */
		owner: string;
	}

	// Most-urgent-first for the row dot: a blocked question beats everything,
	// a live run beats a ready-to-merge PR, merged/pending are quiet states.
	const STATUS_PRIORITY: MineStatus[] = [
		"needsinput",
		"inprogress",
		"review",
		"merged",
		"pending",
	];
	const STATUS_DOT: Record<MineStatus, string> = Object.fromEntries(
		MINE_STATUS_META.map((m) => [m.key, m.dotColor]),
	) as Record<MineStatus, string>;

	const allWsRows = useMemo(() => {
		const rows: WsRow[] = [];
		const byWs = new Map<string, UnifiedSession[]>();
		const solo: UnifiedSession[] = [];
		for (const s of filtered) {
			// Automations render in their own band — EXCEPT runs YOU claimed
			// (right-click → Add to my workspaces / Set status): those graduate
			// into the workspace rows and take part in your lanes like your own
			// work, sitting in In progress while they run and Backlog once idle.
			// Lanes are per-user, so a claimed run moves only for the user who
			// claimed it (legacy global overrides still count for all).
			if (s.automation && !isClaimed(s)) continue;
			if (s.desk) continue; // the Desk session lives in the ⌘J overlay, not the sidebar
			if (s.workspaceId) {
				const list = byWs.get(s.workspaceId) || [];
				list.push(s);
				byWs.set(s.workspaceId, list);
			} else solo.push(s);
		}
		const mkRow = (
			key: string,
			workspace: Workspace | null,
			name: string,
			sessions: UnifiedSession[],
		): WsRow => {
			sessions.sort((a, b) => (a.createdAt || "").localeCompare(b.createdAt || ""));
			// Spawned workers are implementation details of their parent session. A failed
			// oracle/task must not leave the whole workspace looking blocked after the
			// parent recovered, but live workers still make the workspace actively busy.
			// Fall back for an unusual child-only workspace.
			const stateSessions = sessions.filter((c) => !c.parentSessionId);
			const statusSources = stateSessions.length > 0 ? stateSessions : sessions;
			const workerRunning = sessions.some((c) => c.parentSessionId && c.isRunning);
			// Automated PR reviews run in a separate bks-ghpr-* automation session,
			// so the workspace's own sessions never carry isRunning for that work.
			// The PR feed is the authoritative live signal for both its lane and
			// its leading spinner.
			const reviewRunning = sessions.some((c) =>
				sessionPrKeys(c).some((k) => activeReviewPrKeys.has(k)),
			);
			let status =
				STATUS_PRIORITY.find((st) =>
					statusSources.some((c) => mineStatus(c) === st),
				) ||
				"pending";
			// A running worker is live workspace activity even though child failures and
			// blocked states stay isolated from the parent. Needs-input and explicit
			// human lanes still win, matching mineStatus's priority rules.
			if (
				workerRunning &&
				status !== "needsinput" &&
				!sessions.some((c) => pinnedLane(c))
			)
				status = "inprogress";
			// An idle row's lane follows its PR lifecycle (ready → Ready to
			// merge, otherwise-open → In progress). A human-pinned lane wins —
			// deliberately parking a row in Backlog must stick.
			if (status === "pending" && !sessions.some((c) => pinnedLane(c))) {
				// …unless an automated review is still running. The row already
				// wears the spinner for it (see `running` below), and a spinning
				// row parked outside In progress reads as a contradiction. The
				// review can still come back requesting changes, so no PR lane is
				// trustworthy until it lands — including when the live review is
				// on a sibling PR (a cross-repo port, say) while the fronting PR
				// has already merged.
				status = reviewRunning
					? "inprogress"
					: (prLaneForSessions(statusSources) ?? status);
			}
			return {
				key,
				workspace,
				name,
				sessions,
				status,
				lastActivity: sessions.reduce(
					(m, c) => (c.lastActivity > m ? c.lastActivity : m),
					"",
				),
				createdAt: sessions[0]?.createdAt || "",
				unread: sessions.some(
					(c) => c.id !== selectedId && isUnread(c.id, c.lastActivity, reads),
				),
				running: sessions.some((c) => c.isRunning) || reviewRunning,
				owner: (workspace?.createdBy || sessions[0]?.startedBy || "").toLowerCase(),
			};
		};
		for (const [wsId, sessions] of byWs) {
			const ws = workspaces.find((p) => p.id === wsId) || null;
			rows.push(
				mkRow(`workspace:${wsId}`, ws, ws?.name || sessions[0].title, sessions),
			);
		}
		// A workspace with no sessions gets NO row. Workspaces are minted with their
		// first session (or by the PR/ticket resolvers, which park them under Pull
		// requests / Support until a session joins), so a sessionless one is a leftover —
		// its sessions were archived or deleted — not a place to start work.
		//
		// Automation runs are the one session kind that lives outside a workspace: a
		// workspace per run would bury every real one, so they render in the
		// Automations band instead. A *claimed* run is pulled into this list, and
		// groups by shared isolated worktree — the SAME rule the tab strip uses —
		// so the sidebar and tabs agree on what belongs together. Every other session
		// carries a workspace (server-side invariant: see session-workspace.ts), so
		// these fallback rows stay empty in practice.
		const byWorktree = new Map<string, UnifiedSession[]>();
		const loose: UnifiedSession[] = [];
		for (const s of solo) {
			if (s.worktreeDir?.includes("/worktrees/")) {
				const list = byWorktree.get(s.worktreeDir) || [];
				list.push(s);
				byWorktree.set(s.worktreeDir, list);
			} else loose.push(s);
		}
		for (const [dir, sessions] of byWorktree) {
			sessions.sort((a, b) => (a.createdAt || "").localeCompare(b.createdAt || ""));
			// The branch is the row's stable name (session titles drift as generated
			// titles land; the branch names the shared piece of work). A manual
			// rename is explicit user intent though — it wins over the branch,
			// otherwise renaming a slack/linear session looks like a no-op.
			const renamed = sessions.find((c) => c.titleOverridden);
			rows.push(
				mkRow(
					`wt:${dir}`,
					null,
					renamed?.title || sessions[0].branch || sessions[0].title,
					sessions,
				),
			);
		}
		for (const s of loose) rows.push(mkRow(s.id, null, s.title, [s]));
		const key = filter.sort === "created" ? "createdAt" : "lastActivity";
		rows.sort((a, b) => (b[key] || "").localeCompare(a[key] || ""));
		return rows;
		// `lanes` feeds mineStatus/pinnedLane (read via the lib cache).
	}, [filtered, sessions, workspaces, selectedId, reads, search, filter, lanes, activeReviewPrKeys]);

	// ── Hidden rows ─────────────────────────────────────────────────────────
	// "Hide from my sidebar" is the personal counterpart to Archive: archiving
	// is global (archive.ts), so it's the wrong tool when a teammate is still
	// working in the session. A hide drops the row from THIS user's sidebar only,
	// and every band below derives from `wsRows` — so hiding removes it from
	// pins, lanes, review and snoozed in one go.
	//
	// The one exception: a hidden row resurfaces while any of its sessions is
	// blocked on a question, so a hide can never swallow work waiting on you.
	// Resurfacing consumes the entry (see the sweep below), which keeps the
	// rule "it came back because it needed me, and stays back until I hide it
	// again" instead of flickering as questions get asked and answered.
	//
	// Otherwise you get a hidden row back by opening one of its sessions — ⌘K
	// still finds it — which resurfaces the row (below) so its menu can offer
	// "Restore to my sidebar"; prompting in it clears the hide outright
	// (SessionViewer → unhideForSession). There is no Hidden band: hiding is
	// removal from your sidebar, not a folder to browse.
	const { hiddenKeys: hiddenRowKeys, resurfaced: resurfacedRows } = useMemo(
		() => partitionHidden(allWsRows, hides),
		[allWsRows, hides],
	);
	// The open session's row always shows, hidden or not — the same rule that keeps
	// it from disappearing inside a collapsed band. It's what makes hiding
	// reversible without a Hidden band to browse: ⌘K finds a hidden session (the
	// palette ignores hides), opening it brings its row back, and the row menu
	// then offers "Restore to my sidebar".
	const wsRows = useMemo(
		() =>
			allWsRows.filter(
				(r) =>
					!hiddenRowKeys.has(r.key) ||
					r.sessions.some((c) => c.id === selectedId),
			),
		[allWsRows, hiddenRowKeys, selectedId],
	);
	// Consume the hide of any row that just resurfaced (blocked on a question),
	// marking its sessions unread so the return reads as fresh activity — the same
	// shape as the snooze wake above. Idempotent: clearHides ignores keys that
	// another tab already dropped.
	useEffect(() => {
		if (!resurfacedRows.length) return;
		for (const r of resurfacedRows) r.sessions.forEach((c) => markUnread(c.id));
		clearHides(resurfacedRows.map((r) => r.key));
	}, [resurfacedRows]);

	// Automations keep their own collapsible band, one group per automation —
	// hundreds of one-shot runs would drown the Workspaces list otherwise.
	const groups = useMemo(() => {
		const out: Group[] = [];
		const byAutomation = new Map<string, UnifiedSession[]>();
		for (const s of sorted) {
			if (!s.automation) continue;
			// A run you claimed (or a legacy global override) lives in the
			// workspace rows instead — don't render it twice.
			if (isClaimed(s)) continue;
			const list = byAutomation.get(s.automation) || [];
			list.push(s);
			byAutomation.set(s.automation, list);
		}
		for (const name of Array.from(byAutomation.keys()).sort()) {
			out.push({
				key: `auto:${name}`,
				label: name,
				dotColor: AUTOMATION_COLOR,
				band: "automations",
				items: byAutomation.get(name)!,
			});
		}
		return out;
		// `lanes` feeds pinnedLane (read via the lib cache).
	}, [sorted, lanes]);

	// Sessions in sidebar order (pinned rows first, then each group's items) —
	// used to hand onArchive the row that should become active when the open
	// session is archived away.
	const flatOrder = useMemo(() => {
		const pinned = pins
			.filter((e) => !e.startsWith("note:"))
			.map((id) =>
				sessions.find((s) => s.id === id || s.aliasIds?.includes(id)),
			)
			.filter((s): s is UnifiedSession => !!s);
		return [...pinned, ...groups.flatMap((g) => g.items)];
	}, [pins, sessions, groups]);

	function archiveWithNext(s: UnifiedSession) {
		const idx = flatOrder.findIndex((x) => x.id === s.id);
		const rest = flatOrder.filter((x) => x.id !== s.id);
		const next =
			idx >= 0 ? (rest[Math.min(idx, rest.length - 1)] ?? null) : (rest[0] ?? null);
		onArchive(s, next);
	}
	function sessionPinState(s: UnifiedSession) {
		const keys = [s.id, ...(s.aliasIds || [])].filter(
			(k, i, a) => pins.includes(k) && a.indexOf(k) === i,
		);
		const pinned = keys.length > 0;
		const toggle = () => {
			if (pinned) {
				let next = pins;
				for (const k of keys) next = togglePin(k);
				setPins(next);
			} else {
				setPins(togglePin(s.id));
			}
		};
		return { pinned, toggle };
	}
	function workspacePinState(row: WsRow) {
		const pinKey = row.workspace ? `workspace:${row.workspace.id}` : row.key;
		const keys = [
			pinKey,
			row.key,
			...row.sessions.flatMap((c) => [c.id, ...(c.aliasIds || [])]),
		].filter((k, i, a) => pins.includes(k) && a.indexOf(k) === i);
		const pinned = keys.length > 0;
		const toggle = () => {
			if (pinned) {
				let next = pins;
				for (const k of keys) next = togglePin(k);
				setPins(next);
			} else {
				setPins(togglePin(pinKey));
			}
		};
		return { pinned, toggle };
	}

	// Pinned rows (pinned via their own key or a legacy pin on a member session)
	// and the focus person's rows — shared by the list rendering below and by
	// archive-next, so both always agree on what's actually in the sidebar.
	// Rows a teammate flagged for YOUR review (the info panel's Reviewer picker).
	// Explicit teammate filters stay owner-scoped, while the default "Me" view
	// also includes cross-owner work that was sent to or requested by you.
	// ── Snoozed rows ────────────────────────────────────────────────────────
	// A row with an active snooze leaves every band (review, pinned, status
	// lanes) and parks in the Snoozed section, soonest wake first. The sweep
	// below prunes lapsed entries — marking the row's sessions unread first, so
	// the wake surfaces like fresh activity — which re-derives membership.
	const activeSnoozeKeys = useMemo(() => {
		const now = Date.now();
		return new Set(
			Object.entries(snoozes)
				.filter(([, until]) => Date.parse(until) > now)
				.map(([key]) => key),
		);
	}, [snoozes]);
	const snoozedWsRows = useMemo(
		() =>
			wsRows
				.filter((r) => activeSnoozeKeys.has(r.key))
				.sort(
					(a, b) =>
						Date.parse(snoozes[a.key] || "") -
						Date.parse(snoozes[b.key] || ""),
				),
		[wsRows, activeSnoozeKeys, snoozes],
	);
	useEffect(() => {
		if (Object.keys(snoozes).length === 0) return;
		const sweep = () => {
			const now = Date.now();
			for (const [key, until] of Object.entries(snoozes)) {
				if (Date.parse(until) > now) continue;
				const row = wsRows.find((r) => r.key === key);
				row?.sessions.forEach((c) => markUnread(c.id));
				clearSnooze(key);
			}
		};
		sweep();
		const t = setInterval(sweep, 30_000);
		return () => clearInterval(t);
	}, [snoozes, wsRows]);

	const reviewScopeRows = useMemo(() => {
		return wsRows.filter(
			(r) =>
				!activeSnoozeKeys.has(r.key) &&
				reviewRowMatchesPersonFilter(
					r.owner,
					r.sessions.map((session) => session.reviewRequest),
					filter.person,
					currentUser,
				),
		);
	}, [wsRows, activeSnoozeKeys, filter.person, currentUser]);
	const needsReviewRows = useMemo(() => {
		const me = currentUser.toLowerCase();
		return reviewScopeRows.filter(
			(r) =>
				!wsPrMerged(r) &&
				!wsPrApproved(r) &&
				// You already reviewed the PR on GitHub (approve/changes/comment,
				// no re-request since) → your part is done, so hide the row.
				!wsPrReviewGivenBy(r, me) &&
				r.sessions.some(
					(c) =>
						c.reviewRequest?.to?.toLowerCase() === me &&
						!c.reviewRequest?.accepted,
				),
		);
	}, [reviewScopeRows, currentUser]);
	// The mirror of "Needs review": workspaces where YOU asked a teammate to
	// review (the info panel's Reviewer picker, `reviewRequest.by === me`). They
	// get their own band so a session you've sent out for review moves out of the
	// status lanes and into one place you can track what you're waiting on. A row
	// where you're also the reviewer stays in Needs review (a direct ask of you
	// wins), so we exclude those keys.
	const awaitingReviewRows = useMemo(() => {
		const me = currentUser.toLowerCase();
		const needsKeys = new Set(needsReviewRows.map((r) => r.key));
		return reviewScopeRows.filter(
			(r) =>
				!needsKeys.has(r.key) &&
				!wsPrMerged(r) &&
				!wsPrApproved(r) &&
				r.sessions.some(
					(c) =>
						c.reviewRequest?.by?.toLowerCase() === me &&
						!c.reviewRequest?.accepted &&
						// The reviewer already gave their review on GitHub → the
						// request landed, so it leaves the sidebar.
						!wsPrReviewGivenBy(r, c.reviewRequest.to.toLowerCase()),
				),
		);
	}, [reviewScopeRows, currentUser, needsReviewRows]);
	// Completed reviews are hidden from the sidebar, but their keys still need to
	// be excluded from the normal status lanes. A fresh or reopened request clears
	// the completion state and makes the row actionable again. Completion can come
	// from the info panel's "Mark as reviewed" (`reviewRequest.accepted`), approval
	// on GitHub (`prReviewDecision === "APPROVED"`, wsPrApproved), or submitted
	// their review on GitHub in any form (approve/changes/comment, no pending
	// re-request — wsPrReviewGivenBy). A merged PR skips this hidden set because it
	// belongs in the "Done" status lane.
	const completedReviewRows = useMemo(() => {
		const me = currentUser.toLowerCase();
		return reviewScopeRows.filter((r) => {
			if (wsPrMerged(r)) return false;
			const mineRequest = r.sessions.some((c) => {
				const rq = c.reviewRequest;
				return (
					rq && (rq.by.toLowerCase() === me || rq.to.toLowerCase() === me)
				);
			});
			if (!mineRequest) return false;
			return (
				r.sessions.some((c) => c.reviewRequest?.accepted) ||
				wsPrApproved(r) ||
				r.sessions.some(
					(c) =>
						c.reviewRequest &&
						wsPrReviewGivenBy(r, c.reviewRequest.to.toLowerCase()),
				)
			);
		});
	}, [reviewScopeRows, currentUser]);
	// Every workspace with active or completed review state is excluded from the
	// pinned/status lanes. Completed rows therefore disappear rather than falling
	// back into Backlog.
	const reviewBandKeys = useMemo(
		() =>
			new Set([
				...needsReviewRows.map((r) => r.key),
				...awaitingReviewRows.map((r) => r.key),
				...completedReviewRows.map((r) => r.key),
			]),
		[needsReviewRows, awaitingReviewRows, completedReviewRows],
	);
	const pinnedWsRows = useMemo(() => {
		const pinSet = new Set(pins);
		const pinIdx = new Map(pins.map((p, i) => [p, i] as const));
		// A row's slot in the band = its first matching key's position in the
		// pins array (rows can be pinned via their workspace key or a legacy
		// member-session pin) — pins order is user-controlled (drag-to-reorder), so
		// it wins over wsRows' recency order.
		const rowIdx = (r: WsRow) => {
			const hits = [r.key, ...r.sessions.map((c) => c.id)]
				.map((k) => pinIdx.get(k))
				.filter((i): i is number => i !== undefined);
			return hits.length ? Math.min(...hits) : Infinity;
		};
		return wsRows
			.filter(
				(r) =>
					!reviewBandKeys.has(r.key) &&
					!activeSnoozeKeys.has(r.key) &&
					(pinSet.has(r.key) || r.sessions.some((c) => pinSet.has(c.id))),
			)
			.sort((a, b) => rowIdx(a) - rowIdx(b));
	}, [wsRows, pins, reviewBandKeys, activeSnoozeKeys]);
	// Feed workspaces (repo-less, externalRefs — Tella videos, PostHog
	// dashboards) are represented by their feed band's rows. They only join
	// the status lanes when they demand attention (running / needs input) —
	// an idle one in Backlog is a duplicate of its feed row.
	const feedRefKinds = useMemo(
		() => new Set(feeds.map((f) => f.refKind)),
		[feeds],
	);
	const rowIsFeedOnly = (r: WsRow) =>
		!r.workspace?.repo &&
		!!r.workspace?.externalRefs?.length &&
		feedRefKinds.has(r.workspace.externalRefs[0].kind);
	const focusWsRows = useMemo(() => {
		const focus =
			filter.person === "me" ? currentUser.toLowerCase() : filter.person;
		// Pinned rows are NOT excluded here: Pinned is quick access, not a
		// status, so a pinned in-progress session still shows under In
		// progress and Add-to-backlog on a pinned row still lands it in
		// Backlog (with auto-pin-new on, hiding pinned rows emptied the lanes).
		return wsRows.filter(
			(r) =>
				(focus === "everyone" ||
					(focus === "unassigned"
						? r.status === "pending"
						: // A row YOU lane-pinned belongs in your own lens no matter who
							// owns it — lanes are per-user triage, so filing a teammate's
							// PR workspace into your Backlog must show it in YOUR Backlog.
							// Ownerless rows (automation runs with no startedBy) ride the
							// same rule under any personal lens; a legacy global override
							// still surfaces only under Everyone.
							r.owner === focus ||
							// Ownership follows the people in the room, not whoever
							// opened the door: a PR/ticket workspace is minted by an
							// automation, so its creator is a bot even when the work
							// inside is yours. Your own session in it makes the row yours.
							r.sessions.some(
								(c) =>
									!c.automation &&
									(c.startedBy || "").toLowerCase() === focus,
							) ||
							((r.owner === "" || focus === currentUser.toLowerCase()) &&
								r.sessions.some((c) => getLane(c.id))))) &&
				!reviewBandKeys.has(r.key) &&
				!activeSnoozeKeys.has(r.key) &&
				// Idle feed workspaces stay out of the lanes (their feed row is
				// the representation); attention states still surface.
				(!rowIsFeedOnly(r) || r.running || r.status === "needsinput"),
		);
	}, [
		wsRows,
		filter.person,
		currentUser,
		reviewBandKeys,
		activeSnoozeKeys,
		lanes,
	]);

	// ── PR rows in the project lanes ────────────────────────────────────────
	// The retired standalone Pull-requests band dissolved into the project
	// groups: every open PR classifies into a lane (ready → Ready to merge,
	// attention → In progress, drafts → Backlog, the rest → In progress).
	const githubLogin = githubLoginFor(currentUser);
	const reviewQueueItems = useMemo(
		() => buildReviewQueue(openPrs || [], sessions, currentUser, githubLogin),
		[openPrs, sessions, currentUser, githubLogin],
	);
	// Session-backed PRs ride their workspace row (which already wears the PR
	// state); a PR row renders only when no rendered workspace row carries the
	// same repo+branch. Dedupe is against the rows in view — not all wsRows —
	// so a teammate's PR outside your person lens can still surface as a PR
	// row when the PR filter includes it.
	const prRowItems = useMemo(() => {
		if (!workspaceDataReady || filter.prs === "none") return [];
		const q = search.trim().toLowerCase();
		const covered = new Set<string>();
		const rowsInView = [
			...focusWsRows,
			...pinnedWsRows,
			...snoozedWsRows,
			...needsReviewRows,
			...awaitingReviewRows,
		];
		for (const r of rowsInView)
			for (const c of r.sessions) for (const k of sessionPrKeys(c)) covered.add(k);
		return reviewQueueItems.filter((item) => {
			if (covered.has(`${item.pr.repo}\n${item.pr.branch}`)) return false;
			if (filter.repo !== "all" && item.pr.repo !== filter.repo)
				return false;
			if (
				q &&
				![item.pr.title, item.pr.branch, item.pr.author].some((v) =>
					v.toLowerCase().includes(q),
				)
			)
				return false;
			// The person lens: a specific teammate shows their PRs; the
			// aggregate Backlog lens has no authored-PR meaning. "Me" and
			// "Everyone" fall through to the PR-source preset.
			if (filter.person === "unassigned") return false;
			if (filter.person !== "me" && filter.person !== "everyone")
				return item.pr.person === filter.person;
			if (filter.prs === "all") return true;
			return item.source === "mine" || item.source === "requested";
		});
	}, [
		reviewQueueItems,
		workspaceDataReady,
		focusWsRows,
		pinnedWsRows,
		snoozedWsRows,
		needsReviewRows,
		awaitingReviewRows,
		filter.repo,
		filter.person,
		filter.prs,
		search,
	]);

	// Which lane a PR row files under: ready → Ready to merge, everything else
	// → Backlog. In progress is reserved for live runs — a PR that needs a
	// hand signals through its red/yellow glyph and hover card instead.
	function prItemLane(item: ReviewQueueItem): MineStatus {
		return item.bucket === "ready" ? "review" : "pending";
	}

	// Closing a PR from a row's context menu — optimistic spinner per URL; the
	// PR_CLOSED_EVENT listener above prunes the open-PR list on success.
	const [closingPrUrls, setClosingPrUrls] = useState<Set<string>>(
		() => new Set(),
	);
	async function closePrRow(item: ReviewQueueItem) {
		if (!window.confirm(`Close PR #${item.pr.number} without merging it?`))
			return;
		setClosingPrUrls((current) => new Set(current).add(item.pr.url));
		try {
			await closePrPreviewApi(item.pr.repo, item.pr.branch);
		} catch (error: any) {
			onToast?.(error.message || `Failed to close PR #${item.pr.number}.`);
		} finally {
			setClosingPrUrls((current) => {
				const next = new Set(current);
				next.delete(item.pr.url);
				return next;
			});
		}
	}

	// A PR row is selected while the open workspace carries its PR.
	function prRowSelected(item: ReviewQueueItem): boolean {
		const ws = selectedWorkspaceId
			? workspaces.find((p) => p.id === selectedWorkspaceId)
			: null;
		return (
			!!ws &&
			(ws.repo || DEFAULT_PROJECT) === item.pr.repo &&
			(ws.prNumber === item.pr.number || ws.branch === item.pr.branch)
		);
	}

	function renderPrRow(item: ReviewQueueItem) {
		const pinKey = `pr:${item.pr.url}`;
		return (
			<PrRow
				key={item.pr.url}
				item={item}
				selected={prRowSelected(item)}
				pinned={pins.includes(pinKey)}
				onTogglePin={() => setPins(togglePin(pinKey))}
				onOpen={() => onOpenPrItem(item)}
				onClose={() => void closePrRow(item)}
				closing={closingPrUrls.has(item.pr.url)}
			/>
		);
	}

	// GitHub review requests pointed at YOU are a notification, not a lane
	// item: they render in the "Needs review" band at the top, alongside the
	// internal review requests (both are the same ask of you), and stay out of
	// the project lanes below.
	const requestedPrItems = prRowItems.filter(
		(item) => item.source === "requested",
	);
	const lanePrItems = prRowItems.filter(
		(item) => item.source !== "requested",
	);

	// Workspace rows in the sidebar's visual order (Pinned band first, then the
	// status lanes) — archiveWorkspaceWithNext walks this to pick the row that
	// should open when the active workspace is archived away.
	const wsRowOrder = useMemo(
		() => {
			// Pinned rows appear in the Pinned band AND their status lane —
			// dedupe by key so the archive-next walk sees each row once.
			const seen = new Set<string>();
			return [
				...needsReviewRows,
				...awaitingReviewRows,
				...pinnedWsRows,
				...MINE_STATUS_META.flatMap((meta) =>
					focusWsRows.filter((r) => r.status === meta.key),
				),
				...snoozedWsRows,
			].filter((r) => (seen.has(r.key) ? false : (seen.add(r.key), true)));
		},
		[
			needsReviewRows,
			awaitingReviewRows,
			pinnedWsRows,
			focusWsRows,
			snoozedWsRows,
		],
	);
	const hasWorkspaceFilter =
		!!search || filter.repo !== "all" || filter.person !== "me";
	const workspaceListEmpty =
		needsReviewRows.length === 0 &&
		awaitingReviewRows.length === 0 &&
		pinnedWsRows.length === 0 &&
		focusWsRows.length === 0 &&
		snoozedWsRows.length === 0 &&
		prRowItems.length === 0;

	function archiveWorkspaceWithNext(row: WsRow) {
		// Sessionless rows can't be opened, so they're not "next" candidates.
		const candidates = wsRowOrder.filter((r) => r.sessions.length > 0);
		const idx = candidates.findIndex((r) => r.key === row.key);
		const rest = candidates.filter((r) => r.key !== row.key);
		const next =
			idx >= 0 ? (rest[Math.min(idx, rest.length - 1)] ?? null) : (rest[0] ?? null);
		onArchiveWorkspace(row.sessions, next?.sessions[0] ?? null);
	}

	/**
	 * Hide a row from THIS user's sidebar, leaving the sessions untouched for
	 * everyone else (the point of the feature — see `hiddenRowKeys`). Drops the
	 * row's pins and any snooze first: a pinned-but-hidden row would snap to the
	 * top of Pinned the moment it resurfaced, and a snooze wake would resurface
	 * a row the user just hid. Lane membership is deliberately kept, so a
	 * restored row returns to where it was.
	 */
	function hideRow(row: WsRow) {
		const pinnedKeys = [
			row.key,
			...row.sessions.flatMap((c) => [c.id, ...(c.aliasIds || [])]),
		].filter((k, i, a) => pins.includes(k) && a.indexOf(k) === i);
		if (pinnedKeys.length) {
			let next = pins;
			for (const k of pinnedKeys) next = togglePin(k);
			setPins(next);
		}
		clearSnooze(row.key);
		// Keep something open if the row being hidden owns the active session.
		if (row.sessions.some((c) => c.id === selectedId)) {
			const candidates = wsRowOrder.filter((r) => r.sessions.length > 0);
			const idx = candidates.findIndex((r) => r.key === row.key);
			const rest = candidates.filter((r) => r.key !== row.key);
			const next =
				idx >= 0
					? (rest[Math.min(idx, rest.length - 1)] ?? null)
					: (rest[0] ?? null);
			if (next) onSelect(next.sessions[0]);
		}
		setHide(row.key);
	}

	// Archive just the open session and pick what becomes active. We resolve the open
	// session through wsRowOrder (the rendered workspace rows) rather than flatOrder
	// — flatOrder only carries pinned + automation sessions, so a normal open session
	// isn't in it. If the session has siblings in its workspace, land on one of them;
	// otherwise the row empties out, so land on the next workspace's first session.
	function archiveOpenSessionWithNext() {
		const candidates = wsRowOrder.filter((r) => r.sessions.length > 0);
		const rowIdx = candidates.findIndex((r) =>
			r.sessions.some((c) => c.id === selectedId),
		);
		if (rowIdx < 0) {
			// The open session can be hidden by the current person/repo/search lens.
			// Archiving the active session must not depend on it being rendered.
			const session = sessions.find((s) => s.id === selectedId && !s.archived);
			if (session) onArchive(session, null);
			return;
		}
		const row = candidates[rowIdx];
		const session = row.sessions.find((c) => c.id === selectedId);
		if (!session) return;
		let next: UnifiedSession | null;
		const siblings = row.sessions.filter((c) => c.id !== selectedId);
		if (siblings.length > 0) {
			const sessionIdx = row.sessions.findIndex((c) => c.id === selectedId);
			next = siblings[Math.min(sessionIdx, siblings.length - 1)] ?? null;
		} else {
			const rest = candidates.filter((r) => r.key !== row.key);
			next = rest[Math.min(rowIdx, rest.length - 1)]?.sessions[0] ?? null;
		}
		onArchive(session, next);
	}

	React.useImperativeHandle(ref, () => ({
		archiveSelected: archiveOpenSessionWithNext,
	}));

	// ⌘E (or the legacy ⌘⇧A) archives the open session and lands on the next entry
	// in the sidebar, rather than dropping back to Home. This lives here (not in
	// the viewer) because the sidebar owns the row ordering that defines "next".
	// The viewer keeps the same chord only for the unarchive toggle on an
	// already-archived session — that session isn't in this list, so this
	// handler no-ops on it and the two never both fire. ⌘⌥⇧A below escalates to
	// the whole workspace.
	useEffect(() => {
		function onKeyDown(e: KeyboardEvent) {
			if (e.defaultPrevented || !isArchiveChord(e)) return;
			if (
				document.querySelector(
					".palette-backdrop, .composer-schedule-modal-backdrop, .session-delete-overlay",
				)
			)
				return;
			if (editableSwallowsArchiveChord(e.target)) return;
			const canArchive = sessions.some(
				(s) => s.id === selectedId && !s.archived,
			);
			if (!canArchive) return;
			e.preventDefault();
			closeWsHover();
			archiveOpenSessionWithNext();
		}
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, [wsRowOrder, sessions, selectedId, onArchive]);

	// ⌘⌥⇧A escalates the session archive (⌘E/⌘⇧A) to the whole active workspace.
	// The Alt modifier is the only thing that separates the two handlers, so
	// exactly one fires. Targets the workspace holding the open session.
	useEffect(() => {
		function onKeyDown(e: KeyboardEvent) {
			if (
				e.defaultPrevented ||
				e.key.toLowerCase() !== "a" ||
				!(e.metaKey || e.ctrlKey) ||
				!e.shiftKey ||
				!e.altKey
			)
				return;
			if (editableSwallowsArchiveChord(e.target)) return;
			const row = wsRowOrder.find(
				(r) => r.sessions.length > 0 && r.sessions.some((c) => c.id === selectedId),
			);
			if (!row) return;
			e.preventDefault();
			closeWsHover();
			archiveWorkspaceWithNext(row);
		}
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, [wsRowOrder, selectedId, onArchiveWorkspace]);

	// ⌘↓/⌘↑ cycle through the sidebar's rendered items in visual order (down =
	// next row), wrapping at the ends. Reading the DOM here is intentional: each
	// section owns its filtering and collapsed state, so rendered buttons are the
	// single source of truth for what keyboard navigation can reach.
	// Deliberately fires while the composer is focused (unlike the archive
	// chords): jumping workspaces without leaving the keyboard is the point,
	// and that costs the textarea its ⌘-arrow caret-to-start/end moves. Alt is
	// excluded so ⌘⌥ arrows stay free for the reasoning-effort chord
	// (SessionViewer); Shift so ⌘⇧-arrow text selection keeps working.
	useEffect(() => {
		function onKeyDown(e: KeyboardEvent) {
			if (
				e.defaultPrevented ||
				(e.key !== "ArrowUp" && e.key !== "ArrowDown") ||
				!(e.metaKey || e.ctrlKey) ||
				e.altKey ||
				e.shiftKey
			)
				return;
			if (
				document.querySelector(
					".palette-backdrop, .composer-schedule-modal-backdrop, .session-delete-overlay",
				)
			)
				return;
			const candidates = Array.from(
				document.querySelectorAll<HTMLButtonElement>(
					".sidebar-list button.sidebar-item",
				),
			);
			if (candidates.length === 0) return;
			const idx = candidates.findIndex((item) =>
				item.classList.contains("sidebar-item-selected"),
			);
			const dir = e.key === "ArrowDown" ? 1 : -1;
			// No selected sidebar item (e.g. Home): enter from the edge.
			const next =
				idx < 0
					? dir === 1
						? candidates[0]
						: candidates[candidates.length - 1]
					: candidates[(idx + dir + candidates.length) % candidates.length];
			if (!next) return;
			e.preventDefault();
			closeWsHover();
			next.scrollIntoView({ block: "nearest" });
			next.click();
		}
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, []);

	// ── Workspace hover card ────────────────────────────────────────────────
	// The same card every sidebar row raises, driven by hand: workspace rows
	// come out of a render function rather than a component, so one card serves
	// the whole list (only one row can be dwelled on at a time) and the hovered
	// row is its anchor. The card carries actions (Archive, PR link,
	// thumbnails), so leaving the row schedules the close with a short grace
	// period and entering the card cancels it — the pointer can travel the 8px
	// gap without the card vanishing under it.
	const wsHoverOpenT = useRef<ReturnType<typeof setTimeout> | null>(null);
	const wsHoverCloseT = useRef<ReturnType<typeof setTimeout> | null>(null);
	// The row element itself is the anchor — the popover tracks it, so a
	// scrolling list repositions the card instead of dropping it.
	const [wsHover, setWsHover] = useState<{ row: WsRow; el: HTMLElement } | null>(
		null,
	);
	// Mobile long-press sheet (the touch stand-in for the hover card).
	const [wsSheet, setWsSheet] = useState<WsRow | null>(null);

	function cancelWsHoverTimers() {
		if (wsHoverOpenT.current) clearTimeout(wsHoverOpenT.current);
		if (wsHoverCloseT.current) clearTimeout(wsHoverCloseT.current);
		wsHoverOpenT.current = null;
		wsHoverCloseT.current = null;
	}
	function wsRowHoverEnter(row: WsRow, el: HTMLElement) {
		if (rowRenameEditing(row) || !pointerCanHover()) return;
		cancelWsHoverTimers();
		if (wsHover) {
			setWsHover({ row, el });
			return;
		}
		wsHoverOpenT.current = setTimeout(() => {
			setWsHover({ row, el });
		}, 380);
	}
	function scheduleWsHoverClose() {
		if (wsHoverOpenT.current) clearTimeout(wsHoverOpenT.current);
		wsHoverOpenT.current = null;
		if (wsHoverCloseT.current) clearTimeout(wsHoverCloseT.current);
		wsHoverCloseT.current = setTimeout(() => setWsHover(null), 140);
	}
	function closeWsHover() {
		cancelWsHoverTimers();
		setWsHover(null);
	}
	useEffect(() => cancelWsHoverTimers, []);

	// Mobile: tap-to-open a workspace row fires from `touchend`, not the
	// synthesized click — same trick as SessionRow. The row has :hover styles
	// (the reveal-on-hover pin/archive swap, the hover background) plus a
	// mouseenter hover card, and iOS treats the first tap on such an element as
	// a hover-in, swallowing the click — so a click-driven open needs a second
	// tap. A hold that stays roughly in place for LONG_PRESS_MS opens the
	// workspace menu (the touch stand-in for right-click); real finger travel
	// (a scroll) cancels both. Only one touch happens at a time, so one set of
	// refs serves every row.
	const wsPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
	const wsPressOrigin = useRef<{ x: number; y: number } | null>(null);
	const wsLongPressed = useRef(false);
	const wsMoved = useRef(false);
	const wsSwipeOrigin = useRef<{ x: number; y: number; width: number } | null>(
		null,
	);
	const wsSwiping = useRef(false);
	const wsSwipeOffset = useRef(0);
	const [wsSwipe, setWsSwipe] = useState<SwipeState | null>(null);
	const [wsDraggingKey, setWsDraggingKey] = useState<string | null>(null);
	// Which action the in-flight drag is revealing. Split from wsSwipe so a
	// touchmove only re-renders when the side FLIPS — the per-frame offset is
	// written straight to the DOM in wsRowTouchMove.
	const [wsDragSide, setWsDragSide] = useState<SwipeAction | null>(null);
	useEffect(() => {
		if (!isPhone) {
			setWsSwipe(null);
			wsSwipeOffset.current = 0;
			setWsDraggingKey(null);
			setWsDragSide(null);
		}
	}, [isPhone]);
	useEffect(() => {
		setWsSwipe(null);
		wsSwipeOffset.current = 0;
		setWsDraggingKey(null);
		setWsDragSide(null);
	}, [selectedId]);

	function clearWsPress() {
		if (wsPressTimer.current) clearTimeout(wsPressTimer.current);
		wsPressTimer.current = null;
		wsPressOrigin.current = null;
	}
	function wsRowTouchStart(row: WsRow, e: React.TouchEvent) {
		if (rowRenameEditing(row)) return;
		if (e.touches.length !== 1) return;
		const t = e.touches[0];
		wsLongPressed.current = false;
		wsMoved.current = false;
		wsSwiping.current = false;
		clearWsPress();
		if (wsSwipe?.key && wsSwipe.key !== row.key) setWsSwipe(null);
		// After clearWsPress (which nulls it) so it survives to move/end.
		wsPressOrigin.current = { x: t.clientX, y: t.clientY };
		wsSwipeOrigin.current = {
			x: t.clientX - (wsSwipe?.key === row.key ? wsSwipe.offset : 0),
			y: t.clientY,
			width: e.currentTarget.clientWidth,
		};
		wsPressTimer.current = setTimeout(() => {
			wsLongPressed.current = true;
			closeWsHover();
			navigator.vibrate?.(10);
			// The touch stand-in for both the hover card AND right-click: a
			// bottom sheet with the overview block plus every workspace action.
			setWsSheet(row);
		}, LONG_PRESS_MS);
	}
	function wsRowTouchMove(row: WsRow, e: React.TouchEvent) {
		if (e.touches.length !== 1) return;
		const t = e.touches[0];
		const swipeO = wsSwipeOrigin.current;
		if (swipeO && !wsLongPressed.current) {
			const dx = t.clientX - swipeO.x;
			const dy = t.clientY - swipeO.y;
			if (
				wsSwiping.current ||
				(Math.abs(dx) > SWIPE_AXIS_LOCK_PX && Math.abs(dx) > Math.abs(dy))
			) {
				wsSwiping.current = true;
				wsMoved.current = true;
				setWsDraggingKey(row.key);
				clearWsPress();
				e.preventDefault();
				const offset = clampSwipe(dx, swipeO.width);
				wsSwipeOffset.current = offset;
				// Per-frame position goes straight to the DOM: a setState here
				// re-rendered the entire sidebar on every touchmove, which
				// phones can't do at 60fps. React only hears about drag start
				// and side flips; touchend reconciles the settled state.
				const btn = e.currentTarget as HTMLElement;
				btn.style.setProperty("--swipe-x", `${offset}px`);
				btn.parentElement?.style.setProperty(
					"--swipe-action-w",
					`${Math.max(SWIPE_REVEAL_PX, Math.abs(offset))}px`,
				);
				setWsDragSide(offset < 0 ? "archive" : offset > 0 ? "star" : null);
				return;
			}
		}
		const o = wsPressOrigin.current;
		if (!o) return;
		if (
			Math.abs(t.clientX - o.x) > LONG_PRESS_SLOP ||
			Math.abs(t.clientY - o.y) > LONG_PRESS_SLOP
		) {
			wsMoved.current = true;
			clearWsPress();
		}
	}
	// What a row click opens. `review` rows — the ones under the "Needs review"
	// band — land on the workspace's Review tab, because the whole reason that
	// band exists is that someone asked you to look at the diff. Every other
	// place the same workspace appears (status lanes, Pinned, search) still
	// opens the session.
	function openWsRow(row: WsRow, review: boolean) {
		// …as long as there's something to review: a PR (even one opened on a
		// branch the session doesn't own), or its own branch/worktree to diff.
		// Anything else falls through to the session rather than landing on an
		// empty pane.
		const reviewable =
			row.workspace?.prNumber !== undefined ||
			row.sessions.some((s) => sessionHasPr(s) || sessionHasWorkspace(s));
		if (review && reviewable && row.sessions[0]) onOpenReview(row.sessions[0]);
		else if (row.workspace) onOpenWorkspace(row.workspace.id);
		else if (row.sessions[0]) onSelect(row.sessions[0]);
	}
	function wsRowTouchEnd(row: WsRow, e: React.TouchEvent, review = false) {
		const hadOrigin = wsPressOrigin.current !== null;
		const wasSwiping = wsSwiping.current;
		const rowWidth = wsSwipeOrigin.current?.width ?? e.currentTarget.clientWidth;
		// Read the committed distance straight off the ref (like SessionRow),
		// gated on the `wasSwiping` ref — NOT the `wsSwipe` state. Touch events are
		// continuous, so React can batch the last touchmove's setWsSwipe and not
		// re-render before touchend; a `wsSwipe?.key === row.key` gate would then
		// read stale state, collapse the offset to 0, and silently drop the swipe
		// (the intermittent "slide didn't archive"). The ref is always current.
		const swipeOffset = isPhone && wasSwiping ? wsSwipeOffset.current : 0;
		clearWsPress();
		wsSwipeOrigin.current = null;
		wsSwiping.current = false;
		setWsDraggingKey(null);
		setWsDragSide(null);
		// The drag wrote --swipe-x / --swipe-action-w straight onto the DOM;
		// React never owned them, so a re-render with an undefined style prop
		// won't remove them. Clear here — the settled wsSwipe state (if any)
		// re-applies them through the style props on this same flush.
		const rowEl = e.currentTarget as HTMLElement;
		rowEl.style.removeProperty("--swipe-x");
		rowEl.parentElement?.style.removeProperty("--swipe-action-w");
		if (rowRenameEditing(row)) return;
		if (wasSwiping) {
			e.preventDefault();
			if (Math.abs(swipeOffset) >= fullSwipeThreshold(rowWidth)) {
				const action: SwipeAction = swipeOffset < 0 ? "archive" : "star";
				setWsSwipe({
					key: row.key,
					offset: swipeCommitOffset(action, rowWidth),
					action,
				});
				window.setTimeout(() => {
					if (action === "archive") archiveWorkspaceWithNext(row);
					else {
						workspacePinState(row).toggle();
						setWsSwipe({ key: row.key, offset: 0, action });
						window.setTimeout(() => setWsSwipe(null), SWIPE_COMMIT_MS);
					}
					wsSwipeOffset.current = 0;
				}, SWIPE_COMMIT_MS);
				return;
			}
			setWsSwipe(
				(() => {
					const snapped =
						Math.abs(swipeOffset) > SWIPE_OPEN_THRESHOLD
							? swipeOffset > 0
								? SWIPE_REVEAL_PX
								: -SWIPE_REVEAL_PX
							: 0;
					wsSwipeOffset.current = snapped;
					return snapped ? { key: row.key, offset: snapped } : null;
				})(),
			);
			return;
		}
		// A clean tap: started on this row, never became a long-press, never
		// turned into a scroll. Open now and swallow the ghost click — which
		// also keeps the synthesized mouseenter from opening the hover card.
		if (hadOrigin && !wsLongPressed.current && !wsMoved.current) {
			e.preventDefault();
			if (wsSwipe?.key === row.key && wsSwipe.offset !== 0) {
				setWsSwipe(null);
				wsSwipeOffset.current = 0;
				return;
			}
			openWsRow(row, review);
		} else if (wsLongPressed.current) {
			// Release after a long-press: the workspace sheet is already up —
			// swallow any ghost click so it can't land on the sheet (or its
			// backdrop's close handler) and immediately dismiss it.
			e.preventDefault();
		}
	}

	// Repo, review, project and support groups are open by default (grouping is
	// itself the point), so we track their *collapsed* state under a
	// "collapsed:" key; every other group is closed by default and tracked
	// directly. This list must match isOpen's — a key toggled here but read
	// bare there (or vice versa) makes its chevron a no-op.
	const collapseKey = (key: string) =>
		key.startsWith("repo:") ||
		key.startsWith("review:") ||
		key.startsWith("project:") ||
		key.startsWith("support:") ||
		key.startsWith("inbox:")
			? `collapsed:${key}`
			: key;

	function toggleGroup(key: string) {
		const stored = collapseKey(key);
		setExpanded((prev) => {
			const next = new Set(prev);
			if (next.has(stored)) next.delete(stored);
			else next.add(stored);
			localStorage.setItem(EXPANDED_KEY, JSON.stringify([...next]));
			return next;
		});
	}

	// While searching, show everything that matched.
	const isOpen = (key: string) => {
		if (search.trim().length > 0) return true;
		if (
			key.startsWith("repo:") ||
			key.startsWith("review:") ||
			key.startsWith("support:") ||
			key.startsWith("project:") ||
			key.startsWith("inbox:")
		)
			return !expanded.has(`collapsed:${key}`);
		return expanded.has(key);
	};

	// Collapsible bands are open by default, so — like
	// repo groups — their *collapsed* state is what's persisted. Collapsing one
	// hides every group within that band. Searching forces them open.
	const bandOpen = (band: GroupBand | "workspaces") =>
		search.trim().length > 0 ? true : !expanded.has(`collapsed:band:${band}`);
	const toolsOpen = !expanded.has("collapsed:band:tools");
	const workspacesOpen = bandOpen("workspaces");
	// Assignee/label/session filter over the Plain queue; free text rides the
	// sidebar-wide search box (title/customer/preview).
	// Generic feed filtering: sidebar search (title/preview + descriptor
	// searchMeta paths), meta-mode filter specs over item.meta, and the
	// builtin linked-session filter. Arg-mode specs were already applied
	// server-side by the fetch. Replaces filteredSupportThreads.
	function sessionForItem(feed: FeedDescriptor, item: FeedItem) {
		return feed.id === "plain"
			? supportSessionByThread.get(item.id)
			: feedSessionByRef.get(`${feed.refKind}:${item.id}`);
	}
	function applyFeedFilters(feed: FeedDescriptor, items: FeedItem[]) {
		let list = items;
		const q = search.trim().toLowerCase();
		if (q)
			list = list.filter((i) =>
				[
					i.title,
					i.preview,
					...(feed.searchMeta || []).map((p) => dget(i.meta, p)),
				].some(
					(v) => typeof v === "string" && v.toLowerCase().includes(q),
				),
			);
		const vals = feedFilters[feed.id] || {};
		for (const spec of feed.filters || []) {
			if (spec.mode !== "meta") continue;
			const sel = vals[spec.key];
			if (!sel) continue;
			list = list.filter((i) => {
				const v = dget(i.meta, spec.field);
				if (v == null || (Array.isArray(v) && v.length === 0))
					return sel === "__unassigned__";
				const els = Array.isArray(v) ? v : [v];
				return els.some(
					(el) =>
						String(dget(el, spec.optionsFromItems?.value) ?? el) === sel,
				);
			});
		}
		if (vals.__session === "with")
			list = list.filter((i) => !!sessionForItem(feed, i));
		else if (vals.__session === "without")
			list = list.filter((i) => !sessionForItem(feed, i));
		return list;
	}
	const automationsOpen = bandOpen("automations");
	const visibleAutomationGroups = automationsOpen
		? groups
		: groups.filter((group) =>
				group.items.some((session) => session.id === selectedId),
			);
	function toggleBand(band: GroupBand | "tools" | "workspaces") {
		const key = `collapsed:band:${band}`;
		setExpanded((prev) => {
			const next = new Set(prev);
			if (next.has(key)) next.delete(key);
			else next.add(key);
			localStorage.setItem(EXPANDED_KEY, JSON.stringify([...next]));
			return next;
		});
	}

	const tools: Array<{
		id: SidebarToolId;
		label: string;
		icon: React.ReactNode;
		active: boolean;
		onClick: () => void;
		title?: string;
		count?: number;
	}> = [
		{
			id: "home",
			label: SIDEBAR_TOOL_LABELS.home,
			icon: <IconHome />,
			active: homeActive,
			onClick: onOpenHome,
			title: "Pull request worktrees",
		},
		{
			id: "tasks",
			label: SIDEBAR_TOOL_LABELS.tasks,
			icon: <IconListChecks />,
			active: tasksActive,
			onClick: onOpenTasks,
			title: "Your open tasks",
			count: taskCount,
		},
		{
			id: "catchup",
			label: SIDEBAR_TOOL_LABELS.catchup,
			icon: <IconStack />,
			active: catchUpActive,
			onClick: onOpenCatchUp,
			title: "Swipe through your unread workspaces",
			count: catchUpCount,
		},
		{
			id: "prtinder",
			label: SIDEBAR_TOOL_LABELS.prtinder,
			icon: <IconFlame />,
			active: prTinderActive,
			onClick: onOpenPrTinder,
			title: "Swipe through the repo's open PRs",
		},
		{
			id: "supporttinder",
			label: SIDEBAR_TOOL_LABELS.supporttinder,
			icon: <IconInbox />,
			active: supportTinderActive,
			onClick: onOpenSupportTinder,
			title: "Swipe through the Plain Todo queue",
		},
		{
			id: "reports",
			label: SIDEBAR_TOOL_LABELS.reports,
			icon: <IconFile />,
			active: reportsActive,
			onClick: onOpenReports,
			title: "Recurring automation reports",
		},
		{
			id: "analytics",
			label: SIDEBAR_TOOL_LABELS.analytics,
			icon: <IconChart />,
			active: analyticsActive,
			onClick: onOpenAnalytics,
			title: "Sessions, tokens, models & PRs over time",
		},
		{
			id: "notes",
			label: SIDEBAR_TOOL_LABELS.notes,
			icon: <IconPencil />,
			active: notesActive,
			onClick: onOpenNotes,
			title: "Shared notes and documentation",
		},
	];
	const visibleTools = tools.filter(
		(tool) => !hiddenTools.has(tool.id) && (!isPhone || tool.id !== "home"),
	);

	const setToolVisible = setSidebarToolVisible;

	// "Archived" reads as a peer of the My-sessions status buckets (Needs input /
	// Done …): an icon-led row that sits flush under them. Unlike those, it doesn't
	// expand inline — it navigates to the archived page, and highlights while that
	// page is open.
	// The inline Archived band rows: my archived sessions (same lens as
	// archivedCount) grouped by workspace, newest activity first. Capped in the
	// JSX — the "More…" row opens the full archived page for the rest.
	const archivedRows = useMemo(() => {
		const user = currentUser.toLowerCase();
		const mine = sessions.filter(
			(s) =>
				s.archived &&
				!s.automation &&
				s.startedBy &&
				s.startedBy.toLowerCase() === user &&
				(filter.repo === "all" || sessionRepo(s) === filter.repo),
		);
		const byWs = new Map<string, UnifiedSession[]>();
		const rows: Array<{
			key: string;
			name: string;
			sessions: UnifiedSession[];
			lastActivity: string;
		}> = [];
		for (const s of mine) {
			if (s.workspaceId) {
				const list = byWs.get(s.workspaceId) || [];
				list.push(s);
				byWs.set(s.workspaceId, list);
			} else {
				rows.push({
					key: s.id,
					name: s.title || "Untitled",
					sessions: [s],
					lastActivity: s.lastActivity || "",
				});
			}
		}
		for (const [wsId, sessions] of byWs) {
			const ws = workspaces.find((p) => p.id === wsId) || null;
			sessions.sort((a, b) => (a.createdAt || "").localeCompare(b.createdAt || ""));
			rows.push({
				key: `workspace:${wsId}`,
				name: ws?.name || sessions[0].title || "Untitled",
				sessions,
				lastActivity: sessions.reduce(
					(m, c) => (c.lastActivity > m ? c.lastActivity : m),
					"",
				),
			});
		}
		rows.sort((a, b) => (b.lastActivity || "").localeCompare(a.lastActivity || ""));
		return rows;
	}, [sessions, workspaces, currentUser, filter.repo]);

	// Bring an archived row back. `pin` is the one-gesture escalation: unarchive
	// AND drop it in Pinned, so a row you're resurrecting to work on lands at the
	// top of the sidebar instead of wherever its derived lane puts it. The pin key
	// matches workspacePinState's (workspace key, or the solo session's id), which is
	// exactly what `archivedRows` keys rows by.
	function unarchiveRow(row: { key: string; sessions: UnifiedSession[] }, pin: boolean) {
		onUnarchiveWorkspace(row.sessions);
		if (pin && !pins.includes(row.key)) setPins(togglePin(row.key));
	}

	// Archived: a collapsible group like the status lanes (T3's "Settled" —
	// visible at the bottom of the same list so archiving feels cheap, not like
	// a one-way door). Shows the most recent rows inline; "More…" opens the
	// full archived page, which keeps unarchive/bulk actions.
	const ARCHIVED_INLINE_MAX = 20;
	const archivedBand =
		archivedCount > 0
			? (() => {
					const open = isOpen("archived");
					return (
						<div className="sidebar-status-group">
							<button
								className="sidebar-group-header flex w-full items-center gap-[9px] rounded-md px-[10px] py-1 text-[14px] font-medium text-dim transition-colors hover:bg-hover hover:text-fg"
								onClick={() => toggleGroup("archived")}
							>
								<span className="inline-flex shrink-0 items-center text-faint">
									<svg
										width="18"
										height="18"
										viewBox="0 0 16 16"
										fill="none"
										stroke="currentColor"
										strokeWidth="1.4"
									>
										<rect x="2.25" y="2.75" width="11.5" height="3" rx="0.6" />
										<path d="M3.25 5.75v6.5a1 1 0 0 0 1 1h7.5a1 1 0 0 0 1-1v-6.5" />
										<path d="M6.5 8.5h3" strokeLinecap="round" />
									</svg>
								</span>
								<span className="sidebar-group-name">Archived</span>
								<span className="sidebar-group-count">{archivedCount}</span>
								<IconChevronDown
									className="sidebar-group-chevron"
									size={22}
									style={{ transform: open ? "none" : "rotate(-90deg)" }}
								/>
							</button>
							{open &&
								archivedRows.slice(0, ARCHIVED_INLINE_MAX).map((r) => (
									<button
										key={r.key}
										className="sidebar-item sidebar-ws-row sidebar-archived-row"
										onClick={() => onSelect(r.sessions[0])}
										aria-label={r.name}
									>
										<span className="sidebar-rail">
											<span className="sidebar-item-status sidebar-status-idle" />
										</span>
										<span
											className="sidebar-item-title"
											style={{ color: "var(--text-dim)" }}
										>
											{stripPrTitlePrefix(r.name)}
										</span>
										{!isPhone && r.lastActivity && (
											<span className="sidebar-ws-time">
												{shortTime(r.lastActivity)}
											</span>
										)}
										{/* Hover actions, mirroring a live row's pin + archive pair:
										    here they bring the row back, with pin as the one-gesture
										    "unarchive AND put it where I'll see it". */}
										<span className="sidebar-ws-actions">
											<Tooltip label="Unarchive and pin">
												<span
													role="button"
													tabIndex={0}
													className="sidebar-ws-action"
													aria-label={
														r.sessions.length > 1
															? `Unarchive workspace (${r.sessions.length} sessions) and pin`
															: "Unarchive and pin"
													}
													onClick={(e) => {
														e.stopPropagation();
														unarchiveRow(r, true);
													}}
													onKeyDown={(e) => {
														if (e.key === "Enter" || e.key === " ") {
															e.stopPropagation();
															unarchiveRow(r, true);
														}
													}}
												>
													<IconPin size={21} />
												</span>
											</Tooltip>
											<Tooltip
												label={
													r.sessions.length > 1
														? `Unarchive workspace (${r.sessions.length} sessions)`
														: "Unarchive"
												}
											>
												<span
													role="button"
													tabIndex={0}
													className="sidebar-ws-action"
													aria-label="Unarchive"
													onClick={(e) => {
														e.stopPropagation();
														unarchiveRow(r, false);
													}}
													onKeyDown={(e) => {
														if (e.key === "Enter" || e.key === " ") {
															e.stopPropagation();
															unarchiveRow(r, false);
														}
													}}
												>
													<IconUnarchive size={21} />
												</span>
											</Tooltip>
										</span>
									</button>
								))}
							{open && (
								<button
									className={cn(
										"sidebar-item",
										"sidebar-ws-row",
										archivedActive && "sidebar-item-selected",
									)}
									onClick={onOpenArchived}
									title="View all archived sessions"
								>
									<span className="sidebar-rail" />
									<span
										className="sidebar-item-title"
										style={{ color: "var(--text-faint)" }}
									>
										{archivedCount > ARCHIVED_INLINE_MAX
											? `More… (${archivedCount - ARCHIVED_INLINE_MAX} older)`
											: "Open archive page"}
									</span>
								</button>
							)}
						</div>
					);
				})()
			: null;

	// One sidebar row per workspace: status dot (most urgent session), name, session
	// count, unread dot. Click opens the first session (or the workspace itself for
	// real workspaces — App resolves that to its first session / scoped New palette).
	// Right-click opens the workspace menu (pin / color / rename / delete);
	// double-click renames inline.
	function renderWsRow(row: WsRow) {
		return renderWsRowImpl(row, false);
	}

	// The "Needs review" band's rows: identical in every way except that a click
	// opens the workspace's Review tab (see openWsRow).
	function renderReviewWsRow(row: WsRow) {
		return renderWsRowImpl(row, false, false, true);
	}

	// `inbox` renders the Inbox-mode variant of the same row — a repo tile in
	// front of the title, idle timestamp on every row — with identical behavior
	// (click, swipe, context menu, pin, archive).
	// Separate impl rather than an optional param because `.map(renderWsRow)`
	// callers would pass the array index into it.
	//
	// `banded` says the row already sits under a header that means "blocked on
	// you" — the Needs input lane, the Inbox's Needs action band. There the
	// attention dot is the third copy of the same fact (header, count, and the
	// row's own accent wash), so it's dropped.
	//
	// `review` marks a row under the "Needs review" band, whose click opens the
	// Review tab instead of the session.
	function renderWsRowImpl(
		row: WsRow,
		inbox: boolean,
		banded = false,
		review = false,
	) {
		const active = row.sessions.some((s) => s.id === selectedId);
		const editing = rowRenameEditing(row);
		const waiting = row.status === "needsinput";
		// The "in progress" ticker start: the earliest running session's start, so a
		// workspace with several live sessions shows how long it's been busy overall.
		// Done/idle sessions don't count — only sessions actually running feed the clock.
		// Prefer the server's runStartedAt (survives refresh); fall back to the
		// first moment we saw this row running. Pruned when the row goes idle.
		let runStartMs: number | null = null;
		if (row.running) {
			const stamps = row.sessions
				.filter((c) => c.isRunning && c.runStartedAt)
				.map((c) => Date.parse(c.runStartedAt!))
				.filter((n) => !Number.isNaN(n));
			if (stamps.length) {
				runStartMs = Math.min(...stamps);
				runStartSeen.current.set(row.key, runStartMs);
			} else {
				runStartMs = runStartSeen.current.get(row.key) ?? Date.now();
				runStartSeen.current.set(row.key, runStartMs);
			}
		} else {
			runStartSeen.current.delete(row.key);
		}
		const swipeOffset = isPhone && wsSwipe?.key === row.key ? wsSwipe.offset : 0;
		const swipeAction = isPhone && wsSwipe?.key === row.key ? wsSwipe.action : null;
		const draggingRow = wsDraggingKey === row.key;
		// Which underlay to show: the in-flight drag reveals its side via
		// wsDragSide (per-frame offsets live only in the DOM now), a settled
		// open/committing row falls back to the reconciled wsSwipe state.
		const swipeSide: SwipeAction | null = draggingRow
			? wsDragSide
			: swipeAction === "archive" || swipeOffset < 0
				? "archive"
				: swipeAction === "star" || swipeOffset > 0
					? "star"
					: null;
		const rowPin = workspacePinState(row);
		const pinned = rowPin.pinned;
		const toggleRowPin = rowPin.toggle;
		// Active snooze → the row wears a wake countdown instead of the idle time.
		const snoozeIso = activeSnoozeKeys.has(row.key)
			? (snoozes[row.key] ?? null)
			: null;
		const flatRepoGrouping = filter.groupBy === "repo" || rowIsScratch(row);
		return (
			<div
				key={row.key}
				className={`sidebar-swipe-row${
					swipeSide ? ` is-open is-swipe-${swipeSide}` : ""
				}${draggingRow ? " is-dragging" : ""}`}
				style={
					swipeOffset
						? ({
								"--swipe-action-w": `${Math.max(
									SWIPE_REVEAL_PX,
									Math.abs(swipeOffset),
								)}px`,
							} as React.CSSProperties)
						: undefined
				}
			>
				{isPhone && row.sessions.length > 0 && (
					<button
						className="sidebar-swipe-action sidebar-swipe-action--archive"
						onClick={(e) => {
							e.stopPropagation();
							setWsSwipe(null);
							archiveWorkspaceWithNext(row);
						}}
						title={
							row.sessions.length > 1
								? `Archive workspace (${row.sessions.length} sessions)`
								: "Archive"
						}
					>
						<IconArchive size={22} />
						<span>Archive</span>
					</button>
				)}
				{isPhone && (
					<button
						className={`sidebar-swipe-action sidebar-swipe-action--star${pinned ? " is-on" : ""}`}
						onClick={(e) => {
							e.stopPropagation();
							setWsSwipe(null);
							toggleRowPin();
						}}
						title={pinned ? "Unpin workspace" : "Pin workspace"}
					>
						<IconPin size={22} fill={pinned ? "currentColor" : "none"} />
						<span>{pinned ? "Unpin" : "Pin"}</span>
					</button>
				)}
				<button
					className={`sidebar-item sidebar-ws-row ${active ? "sidebar-item-selected" : ""} ${waiting ? "sidebar-item-waiting" : ""} ${row.unread ? "sidebar-item-unread" : ""}`}
					style={
						swipeOffset
							? ({ "--swipe-x": `${swipeOffset}px` } as React.CSSProperties)
							: undefined
					}
					onClick={(e) => {
					// Touch taps open from touchend (their ghost click is
					// preventDefault'd), so this is the mouse/desktop path. Still
					// swallow a click that ends a long-press, belt-and-suspenders.
					if (wsLongPressed.current) {
						wsLongPressed.current = false;
						e.preventDefault();
						return;
					}
					if (editing) return;
					openWsRow(row, review);
				}}
					onMouseEnter={(e) => wsRowHoverEnter(row, e.currentTarget)}
					onMouseLeave={scheduleWsHoverClose}
					onMouseDown={closeWsHover}
					onTouchStart={(e) => wsRowTouchStart(row, e)}
					onTouchMove={(e) => wsRowTouchMove(row, e)}
					onTouchEnd={(e) => wsRowTouchEnd(row, e, review)}
					onTouchCancel={(e) => {
						clearWsPress();
						wsSwipeOrigin.current = null;
						wsSwiping.current = false;
						setWsDraggingKey(null);
						setWsDragSide(null);
						const rowEl = e.currentTarget as HTMLElement;
						rowEl.style.removeProperty("--swipe-x");
						rowEl.parentElement?.style.removeProperty("--swipe-action-w");
					}}
					onContextMenu={(e) => {
					e.preventDefault();
					// On touch this is the long-press callout: our long-press already
					// opened the menu, so don't stack a second one (or the native
					// text-selection callout) on top of it.
					if (wsLongPressed.current || wsPressOrigin.current) return;
					closeWsHover();
					setWorkspaceMenu({
						id: row.workspace ? row.workspace.id : row.key,
						x: e.clientX,
						y: e.clientY,
					});
					}}
					// The button's label replaces its content for assistive tech, so
					// the blocked state — now carried visually by the row's wash —
					// rides here rather than on a marker element.
					aria-label={waiting ? `${row.name}, needs your attention` : row.name}
				>
				{/* Flat repo grouping has no lane heading, so its leading mark must carry
				    the workspace status. Grouped lanes already provide that context and
				    keep the richer PR lifecycle mark here instead. Blocked-on-you never
				    adds a second leading mark: the row's accent wash and bold title
				    already say it, and a green dot hanging off the rail collides with
				    the glyph it precedes (green means "PR healthy" everywhere else). */}
				<span className="sidebar-rail">
					{flatRepoGrouping ? (
						<WsStatusMark row={row} size={18} />
					) : row.running ? (
						<span className="sidebar-item-status sidebar-status-running" />
					) : (
						<WsPrStatusMark sessions={row.sessions} size={18} workspace={row.workspace} />
					)}
				</span>
				{/* Inbox rows name their repo with the tile alone, in front of the
				    title — the repo/branch meta line it replaces cost a second line
				    per row for two words most of the list repeats. */}
				{inbox && !editing && !rowIsScratch(row) && (
					<RepoTile name={wsRowRepo(row)} size={14} />
				)}
				{editing ? (
					<input
						className="min-w-0 flex-1 rounded-md border border-[var(--accent,#6b8afd)] bg-bg px-[3px] text-[14px] font-medium text-inherit outline-none"
						value={row.workspace ? workspaceDraft : sessionDraft}
						autoFocus
						onChange={(e) =>
							row.workspace
								? setWorkspaceDraft(e.target.value)
								: setSessionDraft(e.target.value)
						}
						onClick={(e) => e.stopPropagation()}
						onDoubleClick={(e) => e.stopPropagation()}
						onBlur={() =>
							row.workspace
								? commitWorkspaceRename()
								: commitSessionRename(row.sessions[0])
						}
						onKeyDown={(e) => {
							if (e.key === "Enter")
								row.workspace
									? commitWorkspaceRename()
									: commitSessionRename(row.sessions[0]);
							else if (e.key === "Escape")
								row.workspace
									? setEditingWorkspaceId(null)
									: setEditingSessionId(null);
							e.stopPropagation();
						}}
					/>
				) : (
					<span
						// Same class as a session row's title, so workspace rows pick up
						// the shared type scale (incl. the phone bump) and the
						// selected/waiting/unread emphasis from the row's own classes.
						className="sidebar-item-title"
						onDoubleClick={(e) => {
							e.stopPropagation();
							if (row.workspace) {
								setWorkspaceDraft(row.workspace.name);
								setEditingWorkspaceId(row.workspace.id);
							} else if (row.sessions[0]) {
								// Solo session rows rename the session itself.
								startSessionRename(row.sessions[0]);
							}
						}}
					>
						{stripPrTitlePrefix(row.name)}
					</span>
				)}
				{localMode && row.sessions.some((session) => session.local) && !editing && (
					<span className="shrink-0 rounded-full border border-line px-1.5 py-px text-meta font-medium tracking-wide text-faint">
						local
					</span>
				)}
				{/* Teammates currently viewing a session in this workspace. */}
				{!editing &&
					(() => {
						const viewers = teamViewing.filter(
							(v) =>
								v.user.toLowerCase() !== currentUser.toLowerCase() &&
								row.sessions.some((c) => c.id === v.sessionId),
						);
						if (!viewers.length) return null;
						// Faces sit side by side rather than stacked: an overlapped pile
						// needs an opaque ring the color of what's behind it, and a row's
						// backdrop varies (sidebar material, hover ink, selected, waiting),
						// so any fixed ring reads as a hard frame on most of them.
						return (
							<span
								className="flex shrink-0 items-center gap-0.5"
								aria-label={`Viewing: ${viewers.map((v) => v.user).join(", ")}`}
							>
								{viewers.slice(0, 3).map((v) => (
									<UserAvatar
										key={v.user}
										name={v.user}
										size={16}
										title={`${v.user} is here`}
									/>
								))}
							</span>
						);
					})()}
				{/* A live workspace run always earns its elapsed ticker. Idle timestamps
				    are reserved for standalone sessions, so an automation review does not
				    make its PR workspace look recently active. */}
				{runStartMs !== null && <RunTicker startMs={runStartMs} />}
				{snoozeIso && !editing && <SnoozeBadge until={snoozeIso} />}
				{!isPhone &&
					// Date-banded modes earn a timestamp on every row: the band says
					// which day, the stamp says when within it. ("Project and inbox"
					// renders compact rows, so it asks for the time here.)
					(inbox || filter.groupBy === "repo-inbox" || !row.workspace) &&
					!snoozeIso &&
					wsTimePref !== "off" &&
					row.lastActivity && (
						<span
							className={`sidebar-ws-time${
								wsTimePref === "hover" ? " sidebar-ws-time--hover" : ""
							}${runStartMs !== null ? " sidebar-ws-time--running" : ""}`}
							aria-label={new Date(row.lastActivity).toLocaleString()}
						>
							{shortTime(row.lastActivity)}
						</span>
					)}
				{/* Slack-style pencil: a session here holds an unsent draft — come back
				    and finish it. Yields to the hover actions like the count/time. */}
				{row.sessions.some((c) => hasDraft(`session:${c.id}`)) && (
					<span
						className="sidebar-ws-draft"
						aria-label="Unsent draft. Return to finish it."
					>
						<IconPencil size={20} />
					</span>
				)}
				{isPhone && !banded && waiting && (
					<span
						className="ml-auto flex h-[22px] w-7 shrink-0 items-center justify-center"
						aria-label="Needs your attention"
					>
						<span className="block size-[7px] rounded-full bg-green" />
					</span>
				)}
				{/* Hover actions: pin + archive, side by side. */}
				<span className="sidebar-ws-actions">
					<span
						role="button"
						tabIndex={0}
						className={`sidebar-ws-action${pinned ? " is-on" : ""}`}
						aria-label={pinned ? "Unpin workspace" : "Pin workspace"}
						onClick={(e) => {
							e.stopPropagation();
							toggleRowPin();
						}}
						onKeyDown={(e) => {
							if (e.key === "Enter" || e.key === " ") {
								e.stopPropagation();
								toggleRowPin();
							}
						}}
					>
						<IconPin size={21} fill={pinned ? "currentColor" : "none"} />
					</span>
					{row.sessions.length > 0 && (
						<Tooltip
							label={
								row.sessions.length > 1
									? `Archive workspace (${row.sessions.length} sessions)`
									: "Archive workspace"
							}
							shortcut={
								// Single-session workspace: archiving the workspace is archiving
								// the open session, so advertise its browser-compatible chord. The
								// ⌘⌥⇧A escalation only matters with more than one session.
								active
									? row.sessions.length > 1
										? ARCHIVE_WS_SHORTCUT_KEYS
										: ARCHIVE_SHORTCUT_KEYS
									: undefined
							}
						>
							<span
								role="button"
								tabIndex={0}
								className="sidebar-ws-action"
								aria-label="Archive workspace"
								onClick={(e) => {
									e.stopPropagation();
									archiveWorkspaceWithNext(row);
								}}
								onKeyDown={(e) => {
									if (e.key === "Enter" || e.key === " ") {
										e.stopPropagation();
										archiveWorkspaceWithNext(row);
									}
								}}
							>
								<IconArchive size={21} />
							</span>
						</Tooltip>
					)}
				</span>
				</button>
			</div>
		);
	}

	// Quick "mark done" straight from a Support row — optimistic removal (the
	// ticket leaves Plain's Todo queue), restored by a refetch if Plain says no.
	async function markSupportRowDone(threadId: string) {
		setFeedItems((prev) => ({
			...prev,
			plain: (prev.plain || []).filter((x) => x.id !== threadId),
		}));
		try {
			await setPlainThreadStatusApi(threadId, "done", { user: currentUser });
		} catch {
			fetchFeedItems("plain")
				.then((items) =>
					setFeedItems((prev) => ({ ...prev, plain: items })),
				)
				.catch(() => {});
		}
	}

	// A Support row: one TODO Plain ticket. The dot wears the linked session's
	// status (faint when no session exists yet); click opens the session, or the
	// session-less ticket preview when there isn't one. Hovering reveals the
	// one-click "mark done" button at the row's right edge.
	function supportThreadActive(t: SupportThread) {
		// The ticket's workspace is open (session-less route or one of its sessions)…
		if (selectedWorkspaceId) {
			const ws = workspaces.find((p) => p.id === selectedWorkspaceId);
			if (ws?.plainThreadId === t.id) return true;
		}
		// …or its linked session is the open session (pre-workspace sessions).
		const session = supportSessionByThread.get(t.id);
		return !!session && session.id === selectedId;
	}

	// A Support row in the workspace rows' shape — see SupportRow for the
	// markup; this binds it to the sidebar's state and handlers.
	function renderSupportRow(t: SupportThread) {
		const pinKey = `support:${t.id}`;
		const linked = supportSessionByThread.get(t.id) || null;
		return (
			<SupportRow
				key={pinKey}
				thread={t}
				session={linked}
				active={supportThreadActive(t)}
				pinned={pins.includes(pinKey)}
				onTogglePin={() => setPins(togglePin(pinKey))}
				onOpen={() => onOpenTicket(t)}
				onMarkDone={() => markSupportRowDone(t.id)}
				onSetStatus={
					linked ? (status) => onSetStatus([linked], status) : undefined
				}
			/>
		);
	}

	// The repo band a workspace row files under. The workspace's own repo wins:
	// it's what the work is *about*, while a session's repo is only the checkout it
	// happens to run from — a PR workspace for shared-infra whose session runs in a
	// tella-fusion worktree belongs under shared-infra. A workspace spanning
	// repos still files under one band (a row in two bands double-counts and
	// reads as two pieces of work); the repo *filter* honours every repo it
	// touches, so it stays findable from the others.
	function wsRowRepo(row: WsRow): string {
		return (
		row.workspace?.repo ||
		row.workspace?.externalRefs?.[0]?.kind ||
		row.sessions[0]?.repo ||
		sessionRepo(row.sessions[0] || ({} as UnifiedSession))
	);
	}
	const rowIsScratch = (row: WsRow) => isScratchWorkspace(row.sessions);

	// The Snoozed group — the quiet zone, shared by the status lanes (slotted
	// just above Backlog) and the inbox bands (appended last, after Earlier).
	// `ns` keeps each repo's copy collapsible on its own.
	function renderSnoozedGroup(rows: WsRow[], ns = "") {
		const gkey = `${ns}status:snoozed`;
		const open = isOpen(gkey);
		return (
			<div className="sidebar-status-group sidebar-lane-group" key={gkey}>
				<button
					// Same bare .sidebar-group-header as the lanes: utilities here
					// would out-specify its phone/nesting overrides and leave this
					// one header out of line with the rest.
					className="sidebar-group-header transition-colors"
					onClick={() => toggleGroup(gkey)}
				>
					<span className="sidebar-group-name">Snoozed</span>
					<span className="sidebar-group-count">{rows.length}</span>
					<IconChevronDown
						className="sidebar-group-chevron"
						size={22}
						style={{ transform: open ? "none" : "rotate(-90deg)" }}
					/>
				</button>
				{rows
					.filter((r) => open || r.sessions.some((c) => c.id === selectedId))
					.map(renderWsRow)}
			</div>
		);
	}

	// The Conductor-style status lanes (Needs input / In progress / …) over a set
	// of workspace rows. `ns` keeps each repo's lane collapse state independent.
	// `snoozedRows` (when given) render as a Snoozed group slotted just above
	// the final Backlog lane — the quiet zone, per the T3-style snooze design.
	function renderStatusLanes(
		rows: WsRow[],
		ns = "",
		snoozedRows?: WsRow[],
		laneRepo?: string,
		prItems: ReviewQueueItem[] = [],
	) {
		// While an eligible Pinned row is mid-drag these lanes double as drop
		// targets: per-repo lanes only for the row's own repo, and empty lanes
		// materialize (dimmed) so every status can take the drop.
		const dropEligible =
			!!pinDragMeta &&
			pinDragMeta.sessions.length > 0 &&
			(!laneRepo || laneRepo === pinDragMeta.repo);
		const lanes = MINE_STATUS_META.map((meta) => {
			const items = rows.filter((r) => r.status === meta.key);
			// Session-less PR rows share the lanes since the PR-band dissolution.
			const prs = prItems.filter((i) => prItemLane(i) === meta.key);
			if (items.length === 0 && prs.length === 0 && !dropEligible)
				return null;
			const gkey = `${ns}status:${meta.key}`;
			const open = isOpen(gkey);
			const dropHover = dropEligible && laneDropHover?.gkey === gkey;
			return (
				<div
					className={`sidebar-status-group sidebar-lane-group${
						dropEligible && items.length === 0 && prs.length === 0
							? " is-lane-empty"
							: ""
					}${dropHover ? " is-lane-drop-hover" : ""}`}
					key={gkey}
					data-lane-drop={dropEligible ? gkey : undefined}
					data-lane-status={dropEligible ? meta.key : undefined}
					data-lane-repo={dropEligible && laneRepo ? laneRepo : undefined}
				>
					<button
						// Layout, padding and type all come from .sidebar-group-header —
						// utilities here would out-specify its phone overrides and leave
						// these two headers indented (and smaller) than the rest.
						className="sidebar-group-header transition-colors"
						onClick={() => toggleGroup(gkey)}
					>
						<span className="sidebar-group-name">{meta.label}</span>
						{/* Count rides directly behind the lane name, not pinned right. */}
						<span className="sidebar-group-count">
							{items.length + prs.length}
						</span>
						<IconChevronDown
							className="sidebar-group-chevron"
							size={22}
							style={{ transform: open ? "none" : "rotate(-90deg)" }}
						/>
					</button>
					{items
						.filter((r) => open || r.sessions.some((c) => c.id === selectedId))
						.map((r) => renderWsRowImpl(r, false, meta.key === "needsinput"))}
					{prs
						.filter((i) => open || prRowSelected(i))
						.map(renderPrRow)}
				</div>
			);
		});
		if (snoozedRows && snoozedRows.length > 0) {
			// Snoozed slots directly after Backlog ("pending") — the quiet zone
			// sits with the parked work, ahead of Ready to merge / Done.
			lanes.splice(
				MINE_STATUS_META.findIndex((m) => m.key === "pending") + 1,
				0,
				renderSnoozedGroup(snoozedRows, ns),
			);
		}
		return lanes;
	}

	// ── Inbox mode: the workspace rows as one activity-ranked list ─────────
	// No repo/status grouping — bands mirror an email inbox instead: Needs
	// action (blocked on you) → Recent (running or touched today, one
	// activity-ranked mix) → Yesterday → Earlier. Bands are exclusive with
	// priority needs-action > recent > date, and the ranking always follows
	// lastActivity ("Sort by: Created" deliberately doesn't apply — an inbox
	// orders by what moved last).
	//
	// "Project and inbox" reuses these bands nested under each repo band, so
	// `ns` (the repo's key prefix) keeps every copy collapsible on its own,
	// and the flat mode's flush row inset is dropped when nested. That mode
	// also passes the repo's snoozed rows (one Snoozed group per repo, like
	// the status lanes do) and its session-less PR rows, banded by the PR's
	// own updatedAt — under a repo band those rows are part of the project's
	// inventory, so hiding them the way flat Inbox does would lose work.
	function renderInboxBands(
		rows: WsRow[],
		ns = "",
		snoozedRows: WsRow[] = [],
		prItems: ReviewQueueItem[] = [],
	) {
		const sorted = [...rows].sort((a, b) =>
			(b.lastActivity || "").localeCompare(a.lastActivity || ""),
		);
		const dayStart = new Date();
		dayStart.setHours(0, 0, 0, 0);
		const todayMs = dayStart.getTime();
		const yesterdayMs = todayMs - 24 * 60 * 60 * 1000;
		const bands: Array<{
			key: string;
			label: string;
			rows: WsRow[];
			prs: ReviewQueueItem[];
		}> = [
			{ key: "needsaction", label: "Needs action", rows: [], prs: [] },
			{ key: "recent", label: "Recent", rows: [], prs: [] },
			{ key: "yesterday", label: "Yesterday", rows: [], prs: [] },
			{ key: "earlier", label: "Earlier", rows: [], prs: [] },
		];
		const [needsAction, recent, yesterday, earlier] = bands;
		for (const r of sorted) {
			// NaN (no lastActivity) compares false on both → Earlier. A running
			// row counts as Recent whatever its day — live work is recent by
			// definition — but ranks by lastActivity like its neighbours.
			const t = Date.parse(r.lastActivity || "");
			if (r.status === "needsinput") needsAction.rows.push(r);
			else if (r.running || t >= todayMs) recent.rows.push(r);
			else if (t >= yesterdayMs) yesterday.rows.push(r);
			else earlier.rows.push(r);
		}
		// A bare PR is never "blocked on you" here (review requests aimed at you
		// ride the notification band instead), so it only ever bands by date.
		for (const item of [...prItems].sort((a, b) =>
			(b.pr.updatedAt || "").localeCompare(a.pr.updatedAt || ""),
		)) {
			const t = Date.parse(item.pr.updatedAt || "");
			if (t >= todayMs) recent.prs.push(item);
			else if (t >= yesterdayMs) yesterday.prs.push(item);
			else earlier.prs.push(item);
		}
		const nodes = bands
			.filter((b) => b.rows.length > 0 || b.prs.length > 0)
			.map((b) => {
				const gkey = `${ns}inbox:${b.key}`;
				const open = isOpen(gkey);
				return (
					<div className="sidebar-status-group sidebar-lane-group" key={gkey}>
						<button
							// Bare .sidebar-group-header like the status lanes — see
							// renderStatusLanes for why utilities stay off it.
							className="sidebar-group-header transition-colors"
							onClick={() => toggleGroup(gkey)}
						>
							<span className="sidebar-group-name">{b.label}</span>
							<span className="sidebar-group-count">
								{b.rows.length + b.prs.length}
							</span>
							<IconChevronDown
								className="sidebar-group-chevron"
								size={22}
								style={{ transform: open ? "none" : "rotate(-90deg)" }}
							/>
						</button>
						{b.rows
							.filter((r) => open || r.sessions.some((c) => c.id === selectedId))
							// Nested, the two-line variant's meta line would repeat the
							// repo tile + name the band header already carries, so the
							// rows stay compact like every other repo-nested mode's.
							.map((r) =>
								renderWsRowImpl(r, !ns, b.key === "needsaction"),
							)}
						{b.prs.filter((i) => open || prRowSelected(i)).map(renderPrRow)}
					</div>
				);
			});
		if (snoozedRows.length > 0) nodes.push(renderSnoozedGroup(snoozedRows, ns));
		return nodes;
	}

	// The repo bands — one collapsible band per repo, shared by three "Group by"
	// modes. Scratch workspaces stay in one unlabelled group above them: they have
	// no project, even when an older workspace record carries a stale repo. "flat"
	// holds a Conductor-style row list (status reads from
	// each row's own glyph, needs-input rows float to the top), while "status"
	// nests the labeled status lanes under each band and "inbox" nests the
	// activity bands (Needs action / Recent / Yesterday / Earlier) instead. In
	// both, a collapsed band wears a count of the urgent rows it hides. Repos
	// are ordered by the user's shared preference (`repos`), with newly seen
	// repositories appended in frequency order; a band is force-open while it
	// holds the selected row so the open session never hides inside a collapsed repo.
	function renderRepoGroups(mode: "flat" | "status" | "inbox") {
		const byRepo = new Map<string, WsRow[]>();
		const snoozedByRepo = new Map<string, WsRow[]>();
		const laneRank = (status: MineStatus) =>
			MINE_STATUS_META.findIndex((meta) => meta.key === status);
		const scratchRows = [
			...focusWsRows.filter((row) => !rowIsFeedOnly(row) && rowIsScratch(row)),
			...snoozedWsRows.filter((row) => !rowIsFeedOnly(row) && rowIsScratch(row)),
		].sort((a, b) =>
			mode === "inbox"
				? (b.lastActivity || "").localeCompare(a.lastActivity || "")
				: laneRank(a.status) - laneRank(b.status),
		);
		const bucket = (map: Map<string, WsRow[]>, repo: string) => {
			let b = map.get(repo);
			if (!b) {
				b = [];
				map.set(repo, b);
			}
			return b;
		};
		// Feed workspaces are represented by their feed band's item rows —
		// don't also mint a pseudo-repo band for them (rowIsFeedOnly above).
		for (const r of focusWsRows)
			if (!rowIsFeedOnly(r) && !rowIsScratch(r))
				bucket(byRepo, wsRowRepo(r)).push(r);
		// The grouped modes keep each repo's snoozed rows in that repo's own
		// band, as a Snoozed group beside the other lanes/bands — a global
		// Snoozed group would strand them away from their repo. Flat "Repo" mode
		// has nothing to slot one into, so there they stay in the single global
		// group.
		if (mode !== "flat")
			for (const r of snoozedWsRows)
				if (!rowIsFeedOnly(r) && !rowIsScratch(r))
					bucket(snoozedByRepo, wsRowRepo(r)).push(r);
		// Session-less PR rows file into their repo's band alongside the
		// workspace rows (the dissolved Pull-requests band). Review requests
		// pointed at you are excluded — they ride the notification band under
		// Pinned instead.
		const prByRepo = new Map<string, ReviewQueueItem[]>();
		for (const item of lanePrItems) {
			const list = prByRepo.get(item.pr.repo) || [];
			list.push(item);
			prByRepo.set(item.pr.repo, list);
		}
		const present = new Set([
			...byRepo.keys(),
			...snoozedByRepo.keys(),
			...prByRepo.keys(),
		]);
		const order = [
			...repos.filter((r) => present.has(r)),
			...Array.from(present).filter((r) => !repos.includes(r)),
		];
		const fullOrder = normalizeRepoOrder([
			...normalizeRepoOrder(savedRepoOrder),
			...repos.filter((repo) => !savedRepoOrder.includes(repo)),
			...order.filter((repo) => !repos.includes(repo)),
		]);
		const canReorder = !isPhone && filter.repo === "all" && order.length > 1;
		const moveDraggedRepo = (
			targetRepo: string,
			event: React.DragEvent<HTMLDivElement>,
		) => {
			const draggedRepo = repoDragging.current;
			if (!draggedRepo) return;
			event.preventDefault();
			if (draggedRepo === targetRepo) return;
			const visibleOrder = [...(repoVisualOrder.current ?? order)];
			const from = visibleOrder.indexOf(draggedRepo);
			if (from < 0) return;
			visibleOrder.splice(from, 1);
			let target = visibleOrder.indexOf(targetRepo);
			if (target < 0) return;
			const header = event.currentTarget.querySelector<HTMLElement>(
				":scope > .sidebar-repo-head",
			);
			const rect = (header ?? event.currentTarget).getBoundingClientRect();
			if (event.clientY > rect.top + rect.height / 2) target++;
			visibleOrder.splice(target, 0, draggedRepo);
			if (JSON.stringify(visibleOrder) === JSON.stringify(repoVisualOrder.current))
				return;
			repoVisualOrder.current = visibleOrder;
			const baseline = repoOrderAtDragStart.current ?? fullOrder;
			const next = replaceVisibleRepoOrder(baseline, visibleOrder);
			repoOrderPending.current = next;
			setRepoOrderDraft(next);
		};
		const finishRepoDrag = (commit: boolean) => {
			stopRepoAutoScroll();
			repoJustDragged.current = true;
			setTimeout(() => {
				repoJustDragged.current = false;
			}, 0);
			repoOrderAtDragStart.current = null;
			repoVisualOrder.current = null;
			repoDragging.current = null;
			setRepoDragKey(null);
			const pending = repoOrderPending.current;
			repoOrderPending.current = null;
			setRepoOrderDraft(null);
			if (commit && pending) setRepoOrder(pending);
		};
		return (
			<>
				{scratchRows.length > 0 && (
					<div className="mb-2" data-sidebar-scratch-workspaces>
						{scratchRows.map((row) =>
							renderWsRowImpl(row, mode === "inbox"),
						)}
					</div>
				)}
				<div className="sidebar-repo-order-list">
				{order.map((repo) => {
				const rows = byRepo.get(repo) || [];
				const snoozedRows = snoozedByRepo.get(repo) || [];
				const prs = prByRepo.get(repo) || [];
				const urgent = rows.filter((r) => r.status === "needsinput");
				// Flat mode: rows keep the status-lane ordering (needs input, then
				// in progress, review, done, backlog) so a live run never sinks
				// below idle rows; the sort is stable, so activity order holds
				// within each bucket.
				const ordered = [...rows].sort(
					(a, b) => laneRank(a.status) - laneRank(b.status),
				);
				const gkey = `repo:${repo}`;
				const open = isOpen(gkey);
				// A collapsed band still surfaces the selected row(s) so the
				// open session never hides — without force-opening the band
				// (which made its chevron a frustrating no-op).
				const selectedRows = open
					? []
					: [...rows, ...snoozedRows].filter((r) =>
							r.sessions.some((c) => c.id === selectedId),
						);
				const selectedPrs = open ? [] : prs.filter(prRowSelected);
				return (
					<div
						className={cn(
							"sidebar-repo-group",
							canReorder && "cursor-grab active:cursor-grabbing",
							repoDragKey === repo &&
								"[&>.sidebar-repo-head]:rounded-md [&>.sidebar-repo-head]:bg-hover [&>.sidebar-repo-head]:opacity-50 [&>.sidebar-repo-head]:ring-1 [&>.sidebar-repo-head]:ring-inset [&>.sidebar-repo-head]:ring-line-strong",
						)}
						key={gkey}
						data-repo-id={repo}
						onDragOver={(event) => moveDraggedRepo(repo, event)}
						onDrop={(event) => {
							event.preventDefault();
							finishRepoDrag(true);
						}}
						onClickCapture={(event: React.MouseEvent) => {
							if (!repoJustDragged.current) return;
							event.preventDefault();
							event.stopPropagation();
						}}
					>
						<button
							className="sidebar-group-header sidebar-repo-head group transition-colors"
							draggable={canReorder}
							title={canReorder ? "Drag to reorder repositories" : undefined}
							onDragStart={(event) => {
								repoDragging.current = repo;
								setRepoDragKey(repo);
								repoOrderAtDragStart.current = [...fullOrder];
								repoOrderPending.current = null;
								repoVisualOrder.current = [...order];
								event.dataTransfer.effectAllowed = "move";
								event.dataTransfer.setData("text/plain", repo);
							}}
							onDragEnd={() => finishRepoDrag(false)}
							onClick={() => toggleGroup(gkey)}
						>
							{/* The tile is 18px; the rail holds it on the same column
							    (and text rail) as every other header's mark. */}
							<span className="sidebar-rail">
								<RepoTile name={repo} />
							</span>
							<span className="sidebar-group-name">{repoLabel(repo)}</span>
							{/* Count rides directly behind the repo name, not pinned right. */}
							<span className="sidebar-group-count">
								{rows.length + snoozedRows.length + prs.length}
							</span>
							{/* Urgent rows must not vanish into a closed band — a collapsed
							    header wears the count of rows waiting for input. */}
							{!open && urgent.length > 0 && (
								<span
									className="sidebar-repo-attn"
									aria-label={`${urgent.length} waiting for input`}
								>
									{urgent.length}
								</span>
							)}
							<IconChevronDown
								className="sidebar-group-chevron"
								size={22}
								style={{ transform: open ? "none" : "rotate(-90deg)" }}
							/>
							{/* Hover action at the far end: start a new session with this
							    repo already selected. role=button (not a nested <button>). */}
							<span
								role="button"
								tabIndex={0}
								className="ml-auto inline-flex size-7 shrink-0 items-center justify-center rounded-md text-faint opacity-100 transition-[opacity,color,background] duration-150 hover:bg-hover hover:text-fg focus-visible:opacity-100 md:opacity-0 md:group-hover:opacity-100"
								title={`New session in ${repoLabel(repo)}`}
								onClick={(e) => {
									e.stopPropagation();
									onNewSessionInRepo(repo);
								}}
								onKeyDown={(e) => {
									if (e.key === "Enter" || e.key === " ") {
										e.stopPropagation();
										onNewSessionInRepo(repo);
									}
								}}
							>
								<IconPlus size={24} />
							</span>
						</button>
						{open ? (
							<div className="sidebar-repo-lanes">
								{mode === "status"
									? renderStatusLanes(
											rows,
											`repo:${repo}::`,
											snoozedRows,
											repo,
											prs,
										)
									: mode === "inbox"
									? renderInboxBands(rows, `repo:${repo}::`, snoozedRows, prs)
									: [
											...ordered.map(renderWsRow),
											// Flat mode has no lane headings: PR rows keep
											// the lane ordering after the workspace rows.
											...[...prs]
												.sort(
													(a, b) =>
														laneRank(prItemLane(a)) -
														laneRank(prItemLane(b)),
												)
												.map(renderPrRow),
										]}
							</div>
						) : (
							(selectedRows.length > 0 || selectedPrs.length > 0) && (
								<div className="sidebar-repo-lanes">
									{selectedRows.map(renderWsRow)}
									{selectedPrs.map(renderPrRow)}
								</div>
							)
						)}
					</div>
				);
				})}
				</div>
			</>
		);
	}

	// ── Plain (support) as a project ────────────────────────────────────────
	// The Plain TODO queue rendered as a sibling of the repo bands: a project
	// whose lanes are priorities (Urgent/High/Normal/Low) instead of statuses.
	// Hidden while a repo filter narrows the list — tickets belong to no repo.
	const plainFeedDesc = visibleFeeds.find((f) => f.id === "plain");
	const plainThreadsInView =
		filter.repo === "all" && plainFeedDesc
			? applyFeedFilters(plainFeedDesc, feedItems.plain || []).map(
					(i) => i.meta as unknown as SupportThread,
				)
			: [];

	// The priority lanes, shared by the Plain project band (nested under it)
	// and the flat "Group by: Status" view (appended after the status lanes).
	function renderSupportLanes(threads: SupportThread[]) {
		return SUPPORT_PRIORITY_GROUPS.map((group) => {
			const items = threads.filter((t) => (t.priority ?? 2) === group.p);
			if (items.length === 0) return null;
			const gkey = `support:prio:${group.p}`;
			const groupIsOpen = isOpen(gkey);
			return (
				<div
					className="sidebar-status-group sidebar-lane-group"
					key={`support-prio-${group.p}`}
				>
					<button
						className="sidebar-group-header"
						onClick={() => toggleGroup(gkey)}
					>
						<span
							className={`sidebar-group-name ${group.p <= 1 ? group.cls : ""}`}
						>
							{group.label}
						</span>
						<span className={`sidebar-group-count ${group.cls}`}>
							{items.length}
						</span>
						<IconChevronDown
							className="sidebar-group-chevron"
							size={20}
							style={{
								transform: groupIsOpen ? "none" : "rotate(-90deg)",
							}}
						/>
					</button>
					{items
						.filter((t) => groupIsOpen || supportThreadActive(t))
						.map(renderSupportRow)}
				</div>
			);
		});
	}

	// The Plain queue filter (assignee / label / has-session) — rides the
	// project band's header as a span-rendered menu trigger (the header itself
	// is a button, so a nested <button> trigger is off the table). Free text
	// rides the sidebar-wide search box.
	// Is a feed item's workspace (or its linked session) the open surface?
	function feedItemActive(feed: FeedDescriptor, item: FeedItem) {
		if (selectedWorkspaceId) {
			const ws = workspaces.find((p) => p.id === selectedWorkspaceId);
			if (
				ws?.externalRefs?.some(
					(r) => r.kind === feed.refKind && r.id === item.id,
				)
			)
				return true;
		}
		const session = feedSessionByRef.get(`${feed.refKind}:${item.id}`);
		return !!session && session.id === selectedId;
	}

	// A generic feed band (Tella videos, …) styled like the Plain project band:
	// brand tile + name + count, newest-first rows nested under
	// (the feeds design). Hidden while a repo filter is active, like Plain.
	function renderFeedBand(feed: FeedDescriptor, withLanes = false) {
		const isPlain = feed.id === "plain";
		const sortSel =
			(feedFilters[feed.id] || {}).__sort ||
			feed.sortOptions?.[0]?.value ||
			"recent";
		const metaSortPath = sortSel.startsWith("meta:")
			? sortSel.slice(5)
			: null;
		const items = applyFeedFilters(feed, feedItems[feed.id] || []).sort(
			(a, b) =>
				metaSortPath
					? (Number(dget(b.meta, metaSortPath)) || 0) -
						(Number(dget(a.meta, metaSortPath)) || 0)
					: sortSel === "title"
						? a.title.localeCompare(b.title)
						: sortSel === "oldest"
							? (a.ts || 0) - (b.ts || 0)
							: (b.ts || 0) - (a.ts || 0),
		);
		// Plain rows render through the bespoke SupportRow pipeline (hover
		// card, mark-done, filters) inside this generic band container; the
		// filtered thread list is the source of truth for it.
		const plainThreads = isPlain ? plainThreadsInView : null;
		const count = isPlain ? plainThreads!.length : items.length;
		// An active filter (or search) must never hide the band — zero matches
		// with no visible filter menu is a trap you can't click out of. Only a
		// genuinely empty feed (no raw items, nothing filtered away) hides.
		const vals = feedFilters[feed.id] || {};
		const hasActiveFilter =
			Object.entries(vals).some(([k, v]) => v && k !== "__sort") ||
			!!search.trim();
		const rawCount = (feedItems[feed.id] || []).length;
		if ((count === 0 && rawCount === 0 && !hasActiveFilter) || filter.repo !== "all")
			return null;
		const gkey = isPlain ? "project:plain" : `project:feed-${feed.id}`;
		const open = isOpen(gkey);
		const renderRow = (item: FeedItem) => {
			const pinKey = `feed:${feed.refKind}:${item.id}`;
			const linked = feedSessionByRef.get(`${feed.refKind}:${item.id}`) || null;
			return (
				<FeedRow
					key={`${feed.id}:${item.id}`}
					feed={feed}
					item={item}
					session={linked}
					active={feedItemActive(feed, item)}
					pinned={pins.includes(pinKey)}
					onTogglePin={() => setPins(togglePin(pinKey))}
					onOpen={() => onOpenFeedItem(feed, item)}
					onSetStatus={
						linked ? (status) => onSetStatus([linked], status) : undefined
					}
				/>
			);
		};
		// Collapsed band still surfaces the active item/ticket (same rule as
		// the repo bands' selected rows).
		const activeItems = open
			? []
			: items.filter((i) => feedItemActive(feed, i));
		const activeThreads =
			open || !isPlain ? [] : plainThreads!.filter(supportThreadActive);
		// Attention badge on a collapsed band (e.g. Plain's Urgent lane).
		const attentionCount = feed.attentionLane
			? isPlain
				? plainThreads!.filter((t) => (t.priority ?? 2) === 0).length
				: items.filter((i) => i.lane === feed.attentionLane).length
			: 0;
		const noMatches = (
			<div className="px-3 py-2 text-label text-faint">
				No items match the filters
			</div>
		);
		const openBody = isPlain ? (
			<div className="sidebar-repo-lanes">
				{count === 0
					? noMatches
					: withLanes
						? renderSupportLanes(plainThreads!)
						: [...plainThreads!]
								.sort((a, b) => (a.priority ?? 2) - (b.priority ?? 2))
								.map(renderSupportRow)}
			</div>
		) : (
			<div className="sidebar-repo-lanes">
				{count === 0 ? noMatches : items.map(renderRow)}
			</div>
		);
		const collapsedBody = isPlain
			? activeThreads.length > 0 && (
					<div className="sidebar-repo-lanes">
						{activeThreads.map(renderSupportRow)}
					</div>
				)
			: activeItems.length > 0 && (
					<div className="sidebar-repo-lanes">
						{activeItems.map(renderRow)}
					</div>
				);
		return (
			<div className="sidebar-repo-group" key={gkey}>
				<ContextMenu.Root>
					<ContextMenu.Trigger
						render={
							<button
								className="sidebar-group-header sidebar-repo-head group transition-colors"
								onClick={() => toggleGroup(gkey)}
							/>
						}
					>
						<span className="sidebar-rail">
							<RepoTile name={feed.id} />
						</span>
						<span className="sidebar-group-name">{feed.title}</span>
						<span className="sidebar-group-count">{count}</span>
						{!open && attentionCount > 0 && (
							<span
								className="sidebar-repo-attn"
								aria-label={`${attentionCount} urgent`}
							>
								{attentionCount}
							</span>
						)}
						<IconChevronDown
							className="sidebar-group-chevron"
							size={22}
							style={{ transform: open ? "none" : "rotate(-90deg)" }}
						/>
						<FeedFilterMenu
							feed={feed}
							values={feedFilters[feed.id] || {}}
							rawItems={feedItems[feed.id] || []}
							currentUser={currentUser}
							onSet={(k, v) => setFeedFilter(feed, k, v)}
							onHide={() => setSidebarFeedVisible(feed.id, false)}
						/>
					</ContextMenu.Trigger>
					<ContextMenu.Popup>
						<ContextMenu.Item
							onClick={() => setSidebarFeedVisible(feed.id, false)}
						>
							Hide from sidebar
						</ContextMenu.Item>
					</ContextMenu.Popup>
				</ContextMenu.Root>
				{open ? openBody : collapsedBody}
			</div>
		);
	}

	return (
		<div
			className="sidebar"
			ref={sidebarScrollRef}
			onDragOver={handleRepoAutoScroll}
			onDragLeave={(event) => {
				if (!event.currentTarget.contains(event.relatedTarget as Node | null))
					stopRepoAutoScroll();
			}}
		>
			{localMode && cloudUnreachable && (
				<div
					className="mx-2 mt-2 flex items-center gap-2 rounded-md border border-line bg-panel px-2.5 py-2 text-[11px] text-dim"
					role="status"
					title="Local sessions are still available"
				>
					<IconGlobe size={15} className="shrink-0 text-faint" />
					<span>Cloud temporarily unavailable</span>
				</div>
			)}
			<div
				className="sidebar-sticky-section sidebar-tools-section"
				style={{ order: 0 }}
			>
			{!isPhone && visibleTools.length > 0 && (
				<div className="sidebar-band-label sidebar-tools-head sidebar-sticky-head">
					<div className="group flex min-h-[30px] w-full items-center rounded-md hover:bg-hover hover:text-dim">
						<button
							className="sidebar-band-toggle w-auto flex-1 hover:bg-transparent"
							onClick={() => toggleBand("tools")}
							aria-expanded={toolsOpen}
							title={toolsOpen ? "Collapse tools" : "Expand tools"}
						>
							<span className="sidebar-band-name">Tools</span>
							<IconChevronDown
								className="sidebar-band-chevron"
								size={18}
								style={{
									transform: toolsOpen ? "none" : "rotate(-90deg)",
								}}
							/>
						</button>
						<Menu.Root>
							<Menu.Trigger
								type="button"
								className="invisible mr-1 ml-auto inline-flex size-7 shrink-0 items-center justify-center rounded-md text-dim group-hover:visible hover:bg-hover hover:text-fg data-[popup-open]:visible data-[popup-open]:text-dim"
								aria-label="Choose toolbar tools"
								title="Choose toolbar tools"
							>
								<IconDotsHorizontal size={22} />
							</Menu.Trigger>
							<Menu.Popup side="bottom" align="end" sideOffset={4}>
								<Menu.Group>
									<Menu.GroupLabel>Show in toolbar</Menu.GroupLabel>
									{tools.map((tool) => (
										<Menu.CheckboxItem
											key={tool.id}
											checked={!hiddenTools.has(tool.id)}
											onCheckedChange={(checked) =>
												setToolVisible(tool.id, checked)
											}
										>
											<span className="flex size-4 shrink-0 items-center justify-center rounded-xs border border-line-strong text-fg">
												{!hiddenTools.has(tool.id) && <IconCheck size={12} />}
											</span>
											<span className="text-fg">{tool.label}</span>
										</Menu.CheckboxItem>
									))}
								</Menu.Group>
								<Menu.Separator />
								<Menu.Item onClick={hideAllSidebarTools}>
									Hide tools from sidebar
								</Menu.Item>
							</Menu.Popup>
						</Menu.Root>
					</div>
				</div>
			)}
			{visibleTools.length > 0 && (isPhone || toolsOpen) && (
				<nav className="sidebar-nav">
					{visibleTools.map((tool) => {
						const rowClass = cn(
							// The desktop look lives in these utilities and MUST stay
							// desktop-only: utilities win cascade ties against the phone
							// card CSS (global.css @media), so an unconditional w-full/
							// py-* here is exactly the "full-width Home card on mobile"
							// bug. Phones render the Slack-home style 132px card strip
							// purely from .sidebar-nav-item's media rules.
							"sidebar-nav-item group flex text-left transition-colors",
							// `active` is what the phone card CSS keys its selected state
							// off (.sidebar-nav-item.active in global.css's @media block);
							// the desktop selected look comes from the utilities below.
							// Dropping it in the Tailwind migration left the phone cards
							// with no "you are here".
							tool.active && "active",
							// Desktop-only for the same reason as the block below: a bare
							// items-center wins the cascade tie against the phone rule's
							// align-items:flex-start (media queries add no specificity),
							// which centers the Slack-home cards instead of left-aligning
							// their icon + label.
							!isPhone && "items-center",
							!isPhone &&
								// Compact rows use control-label type and tight padding, with glyphs
								// matching the sidebar's standard 22px leading rail.
								// the utility strip reads lighter than the work lists.
								// Landed in ffd11ffc (2026-07-24). That commit's comment
								// credited a "wayyy too big" complaint, but no such
								// request exists in the session record — don't treat the
								// current numbers as a stated preference.
								"w-full gap-[9px] rounded-row bg-transparent px-[calc(var(--sidebar-icon-left)-var(--sidebar-nav-x))] py-[3px] text-control-label font-medium text-dim hover:bg-hover hover:text-fg",
							!isPhone && tool.active && "bg-active text-fg",
						);
						const rowBody = (
							<>
								<span
									className={cn(
										"sidebar-nav-icon inline-flex",
										!isPhone && "text-faint [&_svg]:size-[22px]",
										!isPhone && tool.active && "text-dim",
										!isPhone && !tool.active && "group-hover:text-dim",
									)}
								>
									{tool.icon}
								</span>
								{tool.label}
								{!!tool.count && (
									<span className="sidebar-nav-count">{tool.count}</span>
								)}
							</>
						);
						// Right-click drops a tool from the strip — the same gesture the
						// feed headers use to hide themselves, and undone from the band's
						// ••• menu or Settings. Desktop only: phones have no right-click,
						// and the ••• menu that puts a tool back is itself desktop-only,
						// so a stray long-press there would only be recoverable from
						// Settings.
						const row = isPhone ? (
							<button
								key={tool.id}
								className={rowClass}
								onClick={tool.onClick}
								title={tool.title}
							>
								{rowBody}
							</button>
						) : (
							<ContextMenu.Root key={tool.id}>
								<ContextMenu.Trigger
									render={
										<button
											className={rowClass}
											onClick={tool.onClick}
											title={tool.title}
										/>
									}
								>
									{rowBody}
								</ContextMenu.Trigger>
								<ContextMenu.Popup>
									<ContextMenu.Item
										onClick={() => setToolVisible(tool.id, false)}
									>
										Remove from toolbar
									</ContextMenu.Item>
								</ContextMenu.Popup>
							</ContextMenu.Root>
						);
						// Home carries the team at its right edge — who's around, who's
						// working, and one click away, what each of them is on. It has to
						// be a sibling of the row, not a child: a button can't nest one.
						// Phones render the tools as a card strip, where there's no room.
						if (tool.id !== "home" || isPhone || team.length === 0) return row;
						return (
							<div key={tool.id} className="relative">
								{row}
								<TeamPresencePopover
									members={team}
									onOpenSession={onSelect}
									// The faces ring themselves in whatever the row is
									// painted with, so the pile separates on both states.
									ring={tool.active ? "var(--bg-active)" : "var(--bg-raised)"}
									className="absolute right-2.5 top-1/2 -translate-y-1/2"
								/>
							</div>
						);
					})}
				</nav>
			)}
			</div>

			<div
				className="sidebar-sticky-section"
				style={{ order: sectionOrder("workspaces") }}
			>
			<div
				className="sidebar-workspace sidebar-sticky-head mt-1 px-[16px] pb-0.5 pr-[7px] pt-3"
			>
				<div className="sidebar-workspace-head flex min-w-0 items-center gap-1.5" ref={headRef}>
					<button
						className="sidebar-workspace-toggle flex min-w-0 items-center gap-[5px]"
						onClick={() => toggleBand("workspaces")}
						aria-expanded={workspacesOpen}
						title={workspacesOpen ? "Collapse workspaces" : "Expand workspaces"}
					>
						<span className="sidebar-workspace-title shrink-0 text-label font-semibold tracking-[-0.01em] text-faint" ref={titleRef}>
							{filter.person === "me"
								? "Workspaces"
								: filter.person === "unassigned"
									? "Unassigned workspaces"
									: filter.person === "everyone"
										? "All workspaces"
										: `${people.find((p) => p.key === filter.person)?.label || filter.person}'s workspaces`}
						</span>
						<IconChevronDown
							className="sidebar-band-chevron"
							size={18}
							style={{
								transform: workspacesOpen ? "none" : "rotate(-90deg)",
							}}
						/>
					</button>
					{/* Repo filter chip, inline behind the title when it fits. */}
					{filter.repo !== "all" && repoInline && (
						<RepoFilterChip
							repo={filter.repo}
							repos={repos}
							onClear={() => setFilter({ repo: "all" })}
							onSelect={(v) => setFilter({ repo: v })}
							variant="inline"
						/>
					)}
					<div className="min-w-0 flex-1" />
					<div className="sidebar-workspace-actions" ref={actionsRef}>
						<Tooltip label="Group, filter & sort">
						<button
							ref={filterBtnRef}
							className={`sidebar-new-btn sidebar-filter-btn${
								filterOpen ? " active" : ""
							}${
								filter.groupBy !== DEFAULT_GROUP_BY ||
								filter.repo !== "all" ||
								filter.person !== "me" ||
								filter.prs !== "default"
									? " has-filter"
									: ""
							}`}
							onClick={() => setFilterOpen((o) => !o)}
						>
							<IconFilter size={24} />
						</button>
						</Tooltip>
						<Tooltip
							label="New session"
							shortcut={isApple ? ["⌘", "N"] : ["Ctrl", "N"]}
						>
						<button
							className="sidebar-new-btn inline-flex items-center justify-center"
							onClick={onNewSession}
						>
							<IconPlus size={24} />
						</button>
						</Tooltip>
					</div>
					{/* Off-layout probe: measures the chip's natural width so the effect
					    above can decide whether it fits inline (never rendered visibly). */}
					{filter.repo !== "all" && (
						<RepoFilterChip repo={filter.repo} variant="probe" ref={probeRef} />
					)}
				</div>
			</div>

				{/* Fallback row: only when the chip doesn't fit inline. */}
				{filter.repo !== "all" && !repoInline && (
					<div className="sidebar-repo-row sidebar-workspace-fallback mx-4 mb-2 mt-[-2px] flex min-w-0 md:mr-2 md:ml-4">
						<RepoFilterChip
							repo={filter.repo}
							repos={repos}
							onClear={() => setFilter({ repo: "all" })}
							onSelect={(v) => setFilter({ repo: v })}
							variant="row"
						/>
					</div>
				)}

			{/* On phones the filter button lives in the top bar (next to Search);
			    its popover anchors there. Desktop keeps it in the header. */}
			{isPhone &&
				headerActionsEl &&
				createPortal(
					<>
						<button
							ref={mobileFilterBtnRef}
							className={`mobile-filter-btn${filterOpen ? " active" : ""}${
								filter.groupBy !== DEFAULT_GROUP_BY ||
								filter.repo !== "all" ||
								filter.person !== "me" ||
								filter.prs !== "default"
									? " has-filter"
									: ""
							}`}
							onClick={() => setFilterOpen((o) => !o)}
							aria-label="Group, filter & sort"
						>
							<IconFilter size={22} />
						</button>
					</>,
					headerActionsEl,
				)}

			{filterOpen && (
				<FilterPopover
					anchor={
						isPhone
							? mobileFilterBtnRef.current
							: filterBtnRef.current
					}
					filter={filter}
					repos={repos}
					people={people}
					currentUser={currentUser}
					onChange={setFilter}
					onClose={() => setFilterOpen(false)}
				/>
			)}

			{workspaceMenu &&
				(() => {
					// The menu id is a real workspace id, or a row key for a
					// workspace-less row (solo session / shared-worktree group).
					const ws = workspaces.find((p) => p.id === workspaceMenu.id);
					const menuRow = wsRows.find((r) =>
						ws ? r.workspace?.id === ws.id : r.key === workspaceMenu.id,
					);
					const sessions = menuRow?.sessions ?? [];
					const first = sessions[0];
					const pinKey = ws ? `workspace:${ws.id}` : workspaceMenu.id;
					// A row can be pinned via its own key or a legacy pin on any member
					// session (incl. alias ids) — unpin clears all of them.
					const pinnedKeys = [
						pinKey,
						...(menuRow
							? [
									menuRow.key,
									...menuRow.sessions.flatMap((c) => [
										c.id,
										...(c.aliasIds || []),
									]),
								]
							: []),
					].filter((k, i, a) => pins.includes(k) && a.indexOf(k) === i);
					const pinned = pinnedKeys.length > 0;
					const togglePinNow = () => {
						if (pinned) {
							let next = pins;
							for (const k of pinnedKeys) next = togglePin(k);
							setPins(next);
						} else {
							setPins(togglePin(pinKey));
						}
					};
					const anyManual = sessions.some((c) => pinnedLane(c));
					const sharedManual =
						anyManual &&
						sessions.every((c) => pinnedLane(c) === pinnedLane(sessions[0]))
							? (pinnedLane(sessions[0]) ?? null)
							: null;

					const entries: CtxEntry[] = [];
					// Offer the move you can actually make: a row with unread
					// activity reads, an already-read one goes back to unread.
					const rowUnread = menuRow?.unread ?? false;
					if (sessions.length > 0)
						entries.push({
							kind: "item",
							icon: <IconMail size={20} />,
							label: rowUnread ? "Mark as read" : "Mark as unread",
							onClick: () =>
								sessions.forEach((c) =>
									rowUnread
										? markRead(c.id, c.lastActivity)
										: markUnread(c.id),
								),
						});
					// Claim someone else's work — an automation run, a teammate's
					// workspace — into your own lanes, where it then behaves like
					// your sessions do (In progress while running, Backlog when
					// idle). Rows you started are already there, so they don't
					// offer it; the full lane picker stays in the flyout below.
					const rowClaimed = sessions.some((c) => isClaimed(c));
					const rowMine = sessions.some((c) => ownedBy(c, currentUser));
					if (sessions.length > 0 && (!rowMine || rowClaimed))
						entries.push({
							kind: "item",
							icon: <IconInbox size={20} />,
							label: rowClaimed
								? "Remove from my workspaces"
								: "Add to my workspaces",
							onClick: () =>
								onSetStatus(sessions, rowClaimed ? null : "mine"),
						});
					entries.push({
						kind: "item",
						icon: (
							<IconPin size={20} fill={pinned ? "currentColor" : "none"} />
						),
						label: pinned ? "Unpin" : "Pin",
						onClick: togglePinNow,
					});
					if (sessions.length > 0)
						entries.push({
							kind: "status",
							current: sharedManual,
							// Applies the pin to every session so the aggregated row lands
							// in the chosen lane; "Auto" clears it back to the derived one.
							onPick: (s) => onSetStatus(sessions, s),
						});
					if (menuRow && sessions.length > 0)
						entries.push({
							kind: "snooze",
							until: activeSnoozeKeys.has(menuRow.key)
								? (snoozes[menuRow.key] ?? null)
								: null,
							// Parks the row in the Snoozed section until the chosen time;
							// null unsnoozes it back to its derived lane.
							onPick: (until) =>
								until
									? setSnooze(menuRow.key, until)
									: clearSnooze(menuRow.key),
						});
					if (ws)
						entries.push({
							kind: "item",
							icon: <IconPencil size={20} />,
							label: "Rename",
							onClick: () => {
								setWorkspaceDraft(ws.name);
								setEditingWorkspaceId(ws.id);
							},
						});
					else if (first)
						entries.push({
							kind: "item",
							icon: <IconPencil size={20} />,
							label: "Rename",
							onClick: () => startSessionRename(first),
						});
					if (first)
						entries.push({
							kind: "item",
							icon: <IconLink size={20} />,
							label: "Copy link",
							shortcut: "⌘⇧C",
							onClick: () =>
								copyToClipboard(absoluteLink(sessionPath(first)), () =>
									onToast?.("Link copied"),
								),
						});
					// A session that owns a worktree/branch (and thus a PR/diff) can open
					// its Review tab here — it's off by default in the viewer.
					if (first && (first.worktreeDir || first.branch))
						entries.push({
							kind: "item",
							icon: <IconEye size={20} />,
							label: "Open review",
							onClick: () => onOpenReview(first),
						});
					// Archive is the removal action here (a session/workspace is finished
					// by archiving, never inferred-deleted). A sessionless workspace has
					// nothing to archive, so it keeps Delete as its only removal.
					if (menuRow && sessions.length > 0) {
						entries.push({ kind: "sep" });
						// Hide sits above Archive as the gentler removal: Archive is
						// global (it ends the work for the whole team), Hide only
						// clears it off your own sidebar while a teammate keeps
						// working in it. On an already-hidden row — which you can
						// only be looking at because you searched for it — the same
						// slot offers the way back, since there's no Hidden band.
						const rowHidden = hiddenRowKeys.has(menuRow.key);
						entries.push({
							kind: "item",
							icon: rowHidden ? <IconEye size={20} /> : <IconEyeOff size={20} />,
							label: rowHidden
								? "Restore to my sidebar"
								: "Hide from my sidebar",
							onClick: () =>
								rowHidden ? clearHides([menuRow.key]) : hideRow(menuRow),
						});
						entries.push({
							kind: "item",
							icon: <IconArchive size={20} />,
							label: "Archive",
							onClick: () => archiveWorkspaceWithNext(menuRow),
						});
					} else if (ws) {
						entries.push({ kind: "sep" });
						entries.push({
							kind: "item",
							icon: <IconTrash size={20} />,
							danger: true,
							label: "Delete workspace",
							onClick: () => {
								if (
									window.confirm(
										`Delete workspace "${ws.name}"? Its sessions become standalone.`,
									)
								)
									onDeleteWorkspace(ws.id);
							},
						});
					}

					return (
						<SidebarCtxMenu
							x={workspaceMenu.x}
							y={workspaceMenu.y}
							entries={entries}
							onClose={() => setWorkspaceMenu(null)}
						/>
					);
				})()}
			{workspacesOpen && (
				<div className="sidebar-list">
				{workspaceListEmpty && (
					<div className="mx-4 my-7 text-center text-[13px] leading-[1.4] text-faint">
						{hasWorkspaceFilter
							? "No matching workspaces"
							: "No workspaces yet"}
					</div>
				)}

				{/* ── Needs review: everything waiting on YOUR review — sessions a
				    teammate asked you to look at (the info panel's Reviewer picker)
				    and GitHub PRs that requested you. Both are the same ask, so they
				    share one band; it rides above everything, like a blocked
				    question. PRs already covered by a workspace row in view are
				    filtered out of prRowItems, so nothing appears twice. ── */}
				{(needsReviewRows.length > 0 || requestedPrItems.length > 0) &&
					(() => {
						const open = isOpen("needsreview");
						return (
							<div className="sidebar-group sidebar-group--review">
								<button
									className="sidebar-group-header"
									onClick={() => toggleGroup("needsreview")}
								>
									<IconBell
										className="sidebar-group-icon"
										style={{ color: "var(--accent)" }}
									/>
									<span className="sidebar-group-name">Needs review</span>
									<span className="sidebar-group-count">
										{needsReviewRows.length + requestedPrItems.length}
									</span>
									<IconChevronDown
										className="sidebar-group-chevron"
										size={22}
										style={{ transform: open ? "none" : "rotate(-90deg)" }}
									/>
								</button>
								{needsReviewRows
									.filter(
										(r) => open || r.sessions.some((c) => c.id === selectedId),
									)
									.map(renderReviewWsRow)}
								{requestedPrItems
									.filter((item) => open || prRowSelected(item))
									.map(renderPrRow)}
							</div>
						);
					})()}

				{/* ── Awaiting review: sessions YOU asked a teammate to review (the
				    mirror of Needs review). Grouped here so a session you've sent out
				    for review moves out of the status lanes into one place. ── */}
				{awaitingReviewRows.length > 0 &&
					(() => {
						const open = isOpen("awaitingreview");
						return (
							<div className="sidebar-group sidebar-group--review">
								<button
									className="sidebar-group-header"
									onClick={() => toggleGroup("awaitingreview")}
								>
									<IconEye
										className="sidebar-group-icon"
										style={{ color: "var(--yellow)" }}
									/>
									<span className="sidebar-group-name">Awaiting review</span>
									<span className="sidebar-group-count">
										{awaitingReviewRows.length}
									</span>
									<IconChevronDown
										className="sidebar-group-chevron"
										size={22}
										style={{ transform: open ? "none" : "rotate(-90deg)" }}
									/>
								</button>
								{awaitingReviewRows
									.filter(
										(r) => open || r.sessions.some((c) => c.id === selectedId),
									)
									.map(renderWsRow)}
							</div>
						);
					})()}

				{/* ── Pinned (workspaces + notes, mixed) ── */}
				{(() => {
					const pinnedRows = pinnedWsRows;
					// Pinned sessions that don't map to a workspace row (automation runs).
					const rowSessionIds = new Set(
						wsRows.flatMap((r) => r.sessions.map((c) => c.id)),
					);
					const pinnedLoose = pins
						.filter((e) => !e.startsWith("note:") && !e.startsWith("workspace:"))
						.filter((id) => !rowSessionIds.has(id))
						.map((id) =>
							sessions.find(
								(s) => s.id === id || s.aliasIds?.includes(id),
							),
						)
						// An archived session must never surface in Pinned — its pin is
						// stale (archiving drops it server-side, but a resurrected or
						// legacy pin can still point at it). Skip it so it can't render
						// as an un-archivable ghost row.
						.filter((s): s is UnifiedSession => !!s && !s.archived)
						// Honor the repo filter — a pinned session from another repo
						// shouldn't leak into a repo-scoped view (workspace pins
						// already drop out via wsRows/filtered).
						.filter(
							(s) => filter.repo === "all" || sessionRepo(s) === filter.repo,
						);
					const pinnedNotes = pins
						.filter((e) => e.startsWith("note:"))
						.map((e) => notes.find((n) => n.id === e.slice(5)))
						.filter((n): n is { id: string; title: string } => !!n);
					// Pinned Plain tickets and PRs — resolved against the live
					// queues, so a done ticket / closed PR just stops rendering
					// (its stale pin key is harmless, like an archived session's).
					const pinnedTickets = pins
						.filter((e) => e.startsWith("support:"))
						.map((e) =>
							(supportThreads || []).find((t) => t.id === e.slice(8)),
						)
						.filter((t): t is SupportThread => !!t);
					// Pinned feed items (Tella videos, PostHog dashboards) —
					// resolved against the live feed items like tickets are.
					const pinnedFeedItems = pins
						.filter((e) => e.startsWith("feed:"))
						.map((e) => {
							const [, refKind, ...idParts] = e.split(":");
							const id = idParts.join(":");
							const feed = feeds.find((f) => f.refKind === refKind);
							const item = feed
								? (feedItems[feed.id] || []).find((i) => i.id === id)
								: undefined;
							return feed && item ? { feed, item } : null;
						})
						.filter(
							(x): x is { feed: FeedDescriptor; item: FeedItem } => !!x,
						);
					const pinnedPrs = pins
						.filter((e) => e.startsWith("pr:"))
						.map((e) =>
							reviewQueueItems.find((i) => i.pr.url === e.slice(3)),
						)
						.filter((i): i is ReviewQueueItem => !!i);
					if (
						!pinnedRows.length &&
						!pinnedLoose.length &&
						!pinnedNotes.length &&
						!pinnedTickets.length &&
						!pinnedFeedItems.length &&
						!pinnedPrs.length
					)
						return null;
					const pinnedOpen = isOpen("pinned");

					// One flat drag-to-reorder list: every pinned thing (workspace row,
					// loose session, note) becomes an entry slotted by its first key's
					// position in the pins array, so reordering is just rewriting that
					// array (reorderPins). `pinKeys` is everything in `pins` that maps
					// to the entry — a workspace can be pinned via its own key AND
					// legacy member-session pins — so a drop moves them as one unit.
					type PinEntry = {
						key: string;
						pinKeys: string[];
						/** Lane-drop payload: the sessions a lane drop re-lanes (empty
						    = not droppable, e.g. notes) + the entry's repo for the
						    same-repo rule under per-repo lanes. */
						repo: string | null;
						sessions: UnifiedSession[];
						node: React.ReactNode;
					};
					const pinIdx = new Map(pins.map((p, i) => [p, i] as const));
					const entries: PinEntry[] = [];
					for (const row of pinnedRows) {
						entries.push({
							key: `ws:${row.key}`,
							pinKeys: [row.key, ...row.sessions.map((c) => c.id)].filter((k) =>
								pinIdx.has(k),
							),
							repo: wsRowRepo(row),
							sessions: row.sessions,
							node: renderWsRow(row),
						});
					}
					const seenLoose = new Set<string>();
					for (const s of pinnedLoose) {
						// A session pinned via both its id and an alias maps to the same
						// session twice — render (and reorder) it once.
						if (seenLoose.has(s.id)) continue;
						seenLoose.add(s.id);
						const pin = sessionPinState(s);
						entries.push({
							key: `session:${s.id}`,
							pinKeys: [s.id, ...(s.aliasIds ?? [])].filter((k) =>
								pinIdx.has(k),
							),
							repo: sessionRepo(s),
							sessions: [s],
							node: (
								<SidebarItem
									session={s}
									localMode={localMode}
									selected={s.id === selectedId}
									unread={
										s.id !== selectedId &&
										isUnread(s.id, s.lastActivity, reads)
									}
									mine={
										!!s.startedBy &&
										!s.automation &&
										s.startedBy.toLowerCase() === currentUser.toLowerCase()
									}
									onClick={() => onSelect(s)}
									onArchive={() => archiveWithNext(s)}
									pinned={pin.pinned}
									onTogglePin={pin.toggle}
									onRename={(title) => onRename(s, title)}
									onSetStatus={(st) => onSetStatus([s], st)}
								/>
							),
						});
					}
					for (const n of pinnedNotes) {
						entries.push({
							key: `note:${n.id}`,
							pinKeys: [`note:${n.id}`],
							repo: null,
							sessions: [],
							node: (
								<button
									className={`sidebar-item ${n.id === activeNoteId ? "sidebar-item-selected" : ""}`}
									onClick={() => onOpenNote(n.id)}
									title={n.title}
								>
									<span className="sidebar-item-top">
										<span className="sidebar-rail" style={{ opacity: 0.9 }}>
											📝
										</span>
										<span className="sidebar-item-title">{n.title}</span>
									</span>
								</button>
							),
						});
					}
					for (const t of pinnedTickets) {
						entries.push({
							key: `support:${t.id}`,
							pinKeys: [`support:${t.id}`],
							repo: null,
							sessions: [],
							node: renderSupportRow(t),
						});
					}
					for (const { feed, item } of pinnedFeedItems) {
						const pinKey = `feed:${feed.refKind}:${item.id}`;
						const linked =
							feedSessionByRef.get(`${feed.refKind}:${item.id}`) || null;
						entries.push({
							key: pinKey,
							pinKeys: [pinKey],
							repo: null,
							sessions: [],
							node: (
								<FeedRow
									key={pinKey}
									feed={feed}
									item={item}
									session={linked}
									active={feedItemActive(feed, item)}
									pinned
									onTogglePin={() => setPins(togglePin(pinKey))}
									onOpen={() => onOpenFeedItem(feed, item)}
									onSetStatus={
										linked
											? (status) => onSetStatus([linked], status)
											: undefined
									}
								/>
							),
						});
					}
					for (const item of pinnedPrs) {
						entries.push({
							key: `pr:${item.pr.url}`,
							pinKeys: [`pr:${item.pr.url}`],
							repo: null,
							sessions: [],
							node: renderPrRow(item),
						});
					}
					const firstIdx = (e: PinEntry) =>
						e.pinKeys.length
							? Math.min(...e.pinKeys.map((k) => pinIdx.get(k)!))
							: Infinity;
					entries.sort((a, b) => firstIdx(a) - firstIdx(b));
					// Mid-drag, Motion's in-flight order wins until the drop commits it.
					if (pinOrderDraft) {
						const draftIdx = new Map(
							pinOrderDraft.map((k, i) => [k, i] as const),
						);
						entries.sort(
							(a, b) =>
								(draftIdx.get(a.key) ?? Infinity) -
								(draftIdx.get(b.key) ?? Infinity),
						);
					}
					const entryMap = new Map(entries.map((e) => [e.key, e] as const));
					// Whole-row y-drag would fight touch scrolling and the swipe
					// gestures, so drag reorder is desktop-only; the order itself is
					// per-user server state, so a desktop reorder shows up on the phone.
					// (>0, not >1: even a lone pinned row can be dragged into a lane.)
					const canDragPins = !isPhone && entries.length > 0;
					const commitPinReorder = () => {
						setPinDragKey(null);
						pinJustDragged.current = true;
						// The drop's click fires synchronously after pointerup; clear the
						// swallow flag right after so the next real click works.
						setTimeout(() => {
							pinJustDragged.current = false;
						}, 0);
						// A drop onto a status lane wins over the reorder: lane-pin the
						// row's sessions there and unpin it — dragging OUT of Pinned reads
						// as a move, unlike right-click Set-status which keeps the pin
						// (the row shows in both the Pinned band and its lane).
						const laneDrop = laneDropHoverRef.current;
						const dragMeta = pinDragMetaRef.current;
						pinDragMetaRef.current = null;
						setPinDragMeta(null);
						laneDropHoverRef.current = null;
						setLaneDropHover(null);
						if (laneDrop && dragMeta && dragMeta.sessions.length > 0) {
							pinOrderPending.current = null;
							setPinOrderDraft(null);
							setPins(unpin(dragMeta.pinKeys));
							onSetStatus(dragMeta.sessions, laneDrop.lane);
							return;
						}
						const orderKeys = pinOrderPending.current;
						pinOrderPending.current = null;
						setPinOrderDraft(null);
						if (!orderKeys) return;
						// New pins array: the visible entries' keys take the slots that
						// visible keys already occupy (in the new order), so pins hidden
						// from the band (archived, repo-filtered, review-band rows) keep
						// their exact positions instead of getting shoved to the end.
						const flat = orderKeys.flatMap(
							(k) => entryMap.get(k)?.pinKeys ?? [],
						);
						const visible = new Set(flat);
						const queue = [...flat];
						setPins(
							reorderPins(
								pins.map((p) => (visible.has(p) ? (queue.shift() ?? p) : p)),
							),
						);
					};
					const pinnedCount = entries.length;
					return (
						<div className="sidebar-group sidebar-group--pinned">
							{/* Same header treatment as the status lanes below. */}
							<button
								className="sidebar-group-header"
								onClick={() => toggleGroup("pinned")}
							>
								<IconPin
									className="sidebar-group-icon"
									style={{ color: "var(--text-faint)" }}
								/>
								<span className="sidebar-group-name">Pinned</span>
								<span className="sidebar-group-count">{pinnedCount}</span>
								<IconChevronDown
									className="sidebar-group-chevron"
									size={22}
									style={{ transform: pinnedOpen ? "none" : "rotate(-90deg)" }}
								/>
							</button>
							{pinnedOpen && (
								<Reorder.Group
									as="div"
									axis="y"
									className={`sidebar-pin-list${pinDragKey ? " is-drag-active" : ""}`}
									values={entries.map((e) => e.key)}
									onReorder={(keys: string[]) => {
										pinOrderPending.current = keys;
										setPinOrderDraft(keys);
									}}
								>
									{entries.map((e) => (
										<Reorder.Item
											as="div"
											key={e.key}
											value={e.key}
											dragListener={canDragPins}
											transition={{ duration: 0 }}
											onDragStart={() => {
												setPinDragKey(e.key);
												const meta = {
													repo: e.repo,
													sessions: e.sessions,
													pinKeys: e.pinKeys,
												};
												pinDragMetaRef.current = meta;
												setPinDragMeta(meta);
											}}
											onDrag={(
												ev: MouseEvent | TouchEvent | PointerEvent,
											) => {
												if ("clientX" in ev)
													updateLaneDropHover(ev.clientX, ev.clientY);
											}}
											onDragEnd={commitPinReorder}
											whileDrag={{ scale: 1.01 }}
											className={`sidebar-pin-entry${pinDragKey === e.key ? " is-reordering" : ""}`}
											onClickCapture={(ev: React.MouseEvent) => {
												// Swallow the click that lands on the row when a drag
												// is dropped — it would open the session under the
												// cursor.
												if (pinJustDragged.current) {
													ev.preventDefault();
													ev.stopPropagation();
												}
											}}
										>
											{e.node}
										</Reorder.Item>
									))}
								</Reorder.Group>
							)}
						</div>
					);
				})()}

				{/* ── Workspaces: status lanes live directly under the Workspaces
				    header above (which carries the filter, new-workspace and
				    new-session actions) — no second in-list heading. ── */}
				<div className="sidebar-group">
					{/* Status groups over the focus person's workspaces. The Person
					    filter defaults to you; picking a teammate shows all their groups,
					    "Unassigned" shows every Backlog, and "Everyone" shows all workspaces.
					    "Group by: Repo" shows one band per repo holding a flat
					    Conductor-style row list; "Repo and status" nests the labeled
					    status lanes under each repo band instead. Empty lanes/bands
					    are hidden — only groups with sessions render. */}
					{/* Snoozed rows sit out of focusWsRows, so each mode places them
					    itself: "Project and status" / "Project and inbox" give every
					    repo band its own Snoozed group (renderRepoGroups), while flat
					    "Project" — which has no lanes — renders one global Snoozed
					    group after the bands, and the plain status mode slots it above
					    Backlog via renderStatusLanes. */}
					{/* Plain (support tickets) renders as one more project: a band
					    beside the repos with priority lanes nested under it — or,
					    in the flat status view, its priority lanes appended after
					    the status lanes so everything reads as one list. */}
					{/* Inbox: one flat activity-ranked list (no repo/status
					    grouping), then the Snoozed group and the feed bands as
					    usual. Session-less PR rows sit this mode out — it ranks
					    sessions by activity, which a bare PR doesn't have. Plain
					    and the other feeds keep the banded (repo-mode) shape:
					    their items aren't the activity-ranked sessions this mode
					    orders, so they stay grouped apart, lanes nested. */}
					{filter.groupBy === "inbox"
						? [
								...renderInboxBands(focusWsRows),
								...renderStatusLanes([], "", snoozedWsRows),
								...visibleFeeds.map((d) => renderFeedBand(d, true)),
							]
						: filter.groupBy === "repo" ||
							filter.groupBy === "repo-status" ||
							filter.groupBy === "repo-inbox"
						? (
								<>
									{renderRepoGroups(
										filter.groupBy === "repo-status"
											? "status"
											: filter.groupBy === "repo-inbox"
												? "inbox"
												: "flat",
									)}
									{filter.groupBy === "repo" &&
										renderStatusLanes(
											[],
											"",
											snoozedWsRows.filter((row) => !rowIsScratch(row)),
										)}
									{visibleFeeds.map((d) =>
										renderFeedBand(d, filter.groupBy !== "repo"),
									)}
								</>
							)
						: [
								...renderStatusLanes(
									focusWsRows,
									"",
									snoozedWsRows,
									undefined,
									lanePrItems,
								),
								// Flat status view: Plain's priority lanes stay inlined
								// after the status lanes (one continuous list); other
								// feeds render as bands below.
								...renderSupportLanes(plainThreadsInView),
								...visibleFeeds
									.filter((d) => d.id !== "plain")
									.map((d) => renderFeedBand(d, false)),
							]}
				</div>

				{archivedBand && (
					<div className="sidebar-group">{archivedBand}</div>
				)}
				</div>
			)}
			</div>

				{/* ── Automations (one collapsible band, one group per automation) ── */}
				{groups.length > 0 && (
					<div
						className="sidebar-independent-section sidebar-group--automations mt-2"
						style={{ order: sectionOrder("automations") }}
					>
						<div className="sidebar-band-label sidebar-sticky-head">
							<button
								className="sidebar-band-toggle"
								onClick={() => toggleBand("automations")}
								title={
									automationsOpen
										? "Collapse automations"
										: "Expand automations"
								}
							>
								<span className="sidebar-band-name">Automations</span>
								<span className="sidebar-group-count">{groups.reduce((n, g) => n + g.items.length, 0)}</span>
								<IconChevronDown
									className="sidebar-band-chevron"
									size={18}
									style={{ transform: automationsOpen ? "none" : "rotate(-90deg)" }}
								/>
							</button>
						</div>
						{visibleAutomationGroups.length > 0 && (
							<div className="sidebar-independent-scroll">
								{visibleAutomationGroups.map((group) => {
									const open = isOpen(group.key);
									return (
									<React.Fragment key={group.key}>
										<button
											className="sidebar-group-header"
											onClick={() => toggleGroup(group.key)}
										>
											{/* The dot is 7px but the header's leading column is a
											    rail, so its name lands where every other one does. */}
											<span className="sidebar-rail">
												{group.dotColor && (
													<span
														className="sidebar-group-dot"
														style={{ backgroundColor: group.dotColor }}
													/>
												)}
											</span>
											<span className="sidebar-group-name">{group.label}</span>
											<IconChevronDown
												className="sidebar-group-chevron"
												size={22}
												style={{
													transform: open ? "none" : "rotate(-90deg)",
												}}
											/>
											<span className="sidebar-group-count">
												{group.items.length}
											</span>
											{/* Hover swaps the count for a cog that jumps to this
											    automation in Settings (span, not button — we're
											    inside the header button). */}
											<span
												role="button"
												className="sidebar-auto-cog"
												title="Automation settings"
												onClick={(e) => {
													e.stopPropagation();
													onOpenAutomation(group.label);
												}}
											>
												<IconGear size={17} />
											</span>
										</button>
										{/* When collapsed, still surface the actively selected
										    session so it never disappears behind a closed header. */}
										{group.items
											.filter((s) => open || s.id === selectedId)
											.map((s) => {
												const pin = sessionPinState(s);
												return (
													<SidebarItem
														key={s.id}
														session={s}
														localMode={localMode}
														selected={s.id === selectedId}
														unread={
															s.id !== selectedId &&
															isUnread(s.id, s.lastActivity, reads)
														}
														mine={
															!!s.startedBy &&
															!s.automation &&
															s.startedBy.toLowerCase() ===
																currentUser.toLowerCase()
														}
														onClick={() => onSelect(s)}
														onArchive={() => archiveWithNext(s)}
														pinned={pin.pinned}
														onTogglePin={pin.toggle}
														onRename={(title) => onRename(s, title)}
														onSetStatus={(st) => onSetStatus([s], st)}
													/>
												);
											})}
									</React.Fragment>
									);
								})}
							</div>
						)}
					</div>
				)}
			{/* ── People: the whole team, always on — live viewers first. Click a
			    person to view their workspace lanes (backlog / in progress). ── */}
			{(() => {
				const others = roster.filter(
					(p) => p.name.toLowerCase() !== currentUser.toLowerCase(),
				);
				if (others.length === 0) return null;
				const open = bandOpen("people");
				const viewingBy = new Map(
					teamViewing.map((v) => [v.user.toLowerCase(), v.sessionId]),
				);
				const titleFor = (id: string) =>
					sessions.find((s) => s.id === id)?.title || id;
				const rows = [...others].sort((a, b) => {
					const aLive = viewingBy.has(a.name.toLowerCase()) ? 0 : 1;
					const bLive = viewingBy.has(b.name.toLowerCase()) ? 0 : 1;
					if (aLive !== bLive) return aLive - bLive;
					const aAct = personActivity.get(a.name.toLowerCase())?.last || "";
					const bAct = personActivity.get(b.name.toLowerCase())?.last || "";
					return bAct.localeCompare(aAct);
				});
				return (
					<div
						className="sidebar-independent-section mt-2"
						style={{ order: sectionOrder("people") }}
					>
						<div className="sidebar-band-label sidebar-sticky-head">
							<button
								className="sidebar-band-toggle pl-[10px]"
								onClick={() => toggleBand("people")}
								title={open ? "Collapse people" : "Expand people"}
							>
								<span className="sidebar-band-name">People</span>
								<span className="sidebar-group-count">{rows.length}</span>
								<IconChevronDown
									className="sidebar-band-chevron"
									size={18}
									style={{ transform: open ? "none" : "rotate(-90deg)" }}
								/>
							</button>
						</div>
						{open && (
							<div className="sidebar-independent-scroll">
								{rows.map((p) => {
									const key = p.name.toLowerCase();
									const liveId = viewingBy.get(key);
									const act = personActivity.get(key);
									const selected = filter.person === key;
									const localTime = p.timezone
										? new Intl.DateTimeFormat([], {
												hour: "2-digit",
												minute: "2-digit",
												timeZone: p.timezone,
											}).format(new Date())
										: null;
									return (
										<button
											key={p.name}
											className={`sidebar-people-row flex items-center gap-[9px] w-full min-w-0 text-left border-0 cursor-pointer rounded-row pl-[12px] pr-2 py-[5px] max-[720px]:py-2 ${
												selected
													? "bg-active"
													: "bg-transparent hover:bg-hover"
											}`}
											onClick={() => {
												// First click: filter to their lanes AND open the
												// session the row shows — going back lands on their
												// workspaces. Second click (or the row's ✕): undo
												// the filter, back to your own.
												if (selected) {
													setFilter({ person: "me" });
													return;
												}
												setFilter({ person: key });
												const targetId = liveId || act?.id;
												const target = targetId
													? sessions.find((s) => s.id === targetId)
													: undefined;
												if (target) onSelect(target);
											}}
											title={
												selected
													? "Back to your workspaces"
													: liveId || act?.title
														? `Open “${liveId ? titleFor(liveId) : act?.title}” · ${p.name}'s workspaces`
														: `${p.name}'s workspaces`
											}
										>
											{/* The name lives on the avatar (tooltip) — the row's
											    width belongs to the workspace/session title. */}
											<Tooltip
												label={`${p.fullName}${localTime ? ` · ${localTime}` : ""}${liveId ? " · viewing now" : ""}`}
											>
												<span className="relative shrink-0">
													<UserAvatar name={p.name} size={22} />
												</span>
											</Tooltip>
											<span
												className={`sidebar-item-title flex-1${
													selected ? " !text-fg font-semibold" : ""
												}`}
											>
												{liveId ? titleFor(liveId) : act?.title || p.name}
											</span>
											{selected && (
												// The undo affordance — the whole row is the target
												// (second click clears the filter), this just says so.
												<span
													className="ml-auto flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full text-dim"
													aria-hidden="true"
												>
													<IconX size={14} />
												</span>
											)}
										</button>
									);
								})}
							</div>
						)}
					</div>
				);
			})()}
			{/* One card for the whole workspace list: the rows come out of a plain
			    render function, not a component, so they can't each own a popover.
			    The hovered row is the anchor instead — same shell, same card. */}
			<Popover.Root
				open={!!wsHover}
				onOpenChange={(open) => {
					if (!open) closeWsHover();
				}}
			>
				{wsHover && (
					<RowCardPopup anchor={wsHover.el}>
						<div
							onMouseEnter={cancelWsHoverTimers}
							onMouseLeave={scheduleWsHoverClose}
						>
							<WsCardBody
								row={wsHover.row}
								onArchive={() => {
									closeWsHover();
									archiveWorkspaceWithNext(wsHover.row);
								}}
								onOpen={(session) => {
									closeWsHover();
									onSelect(session);
								}}
							/>
						</div>
					</RowCardPopup>
				)}
			</Popover.Root>
			{wsSheet &&
				(() => {
					const row = wsSheet;
					const ws = row.workspace;
					// Same pin resolution as the row's star and the right-click menu: a
					// row can be pinned via its own key or a legacy pin on any member
					// session (incl. alias ids) — unpin must clear all of them.
					const pinKey = ws ? `workspace:${ws.id}` : row.key;
					const pinnedKeys = [
						pinKey,
						row.key,
						...row.sessions.flatMap((c) => [c.id, ...(c.aliasIds || [])]),
					].filter((k, i, a) => pins.includes(k) && a.indexOf(k) === i);
					const pinned = pinnedKeys.length > 0;
					return (
						<WsMobileSheet
							row={row}
							pinned={pinned}
							onTogglePin={() => {
								if (pinned) {
									let next = pins;
									for (const k of pinnedKeys) next = togglePin(k);
									setPins(next);
								} else {
									setPins(togglePin(pinKey));
								}
							}}
							onClose={() => setWsSheet(null)}
							onArchive={() => archiveWorkspaceWithNext(row)}
							onSetStatus={(status) => onSetStatus(row.sessions, status)}
							snoozeUntil={
								activeSnoozeKeys.has(row.key)
									? (snoozes[row.key] ?? null)
									: null
							}
							onSnooze={(until) =>
								until ? setSnooze(row.key, until) : clearSnooze(row.key)
							}
							onOpen={(session) => onSelect(session)}
							onRename={() => {
								if (ws) {
									setWorkspaceDraft(ws.name);
									setEditingWorkspaceId(ws.id);
								} else if (row.sessions[0]) {
									// Solo session rows rename the session itself.
									startSessionRename(row.sessions[0]);
								}
							}}
							claimed={
								row.sessions.length === 0
									? null
									: row.sessions.some((c) => isClaimed(c))
										? true
										: row.sessions.some((c) => ownedBy(c, currentUser))
											? null
											: false
							}
							unread={row.unread}
							onToggleRead={
								row.sessions.length > 0
									? () =>
											row.sessions.forEach((c) =>
												row.unread
													? markRead(c.id, c.lastActivity)
													: markUnread(c.id),
											)
									: null
							}
							onCopyLink={
								row.sessions[0]
									? () =>
											copyToClipboard(
												absoluteLink(sessionPath(row.sessions[0])),
												() => onToast?.("Link copied"),
											)
									: null
							}
							onDelete={
								ws
									? () => {
											if (
												window.confirm(
													`Delete workspace "${ws.name}"? Its sessions become standalone.`,
												)
											)
												onDeleteWorkspace(ws.id);
										}
									: null
							}
						/>
					);
				})()}
		</div>
	);
});
