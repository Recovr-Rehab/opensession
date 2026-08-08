import { useIsPhone } from "../../hooks/useIsPhone";
import { hasDraft } from "../../lib/drafts";
import { markRead, markUnread } from "../../lib/reads";
import { isClaimed, pinnedLane, runNeedsAttention, stripPrTitlePrefix } from "../../lib/sidebar-lanes";
import { ARCHIVE_SHORTCUT_KEYS, LONG_PRESS_MS, LONG_PRESS_SLOP, PIN_SHORTCUT_KEYS, SWIPE_AXIS_LOCK_PX, SWIPE_COMMIT_MS, SWIPE_OPEN_THRESHOLD, SWIPE_REVEAL_PX, clampSwipe, fullSwipeThreshold, swipeCommitOffset, type SwipeAction } from "../../lib/sidebar-swipe";
import { MINE_STATUS_META, type LaneChoice } from "../../lib/sidebar-types";
import type { UnifiedSession } from "../../lib/types";
import { Button } from "../../ui/button";
import { cn } from "../../ui/cn";
import { Popover } from "../../ui/popover";
import { BottomSheet, SheetBody, SheetItem, SheetSeparator, SheetTitle } from "../../ui/sheet";
import { Tooltip } from "../../ui/tooltip";
import { RowCardPopup, useRowHoverCard } from "../SidebarRowCards";
import { IconArchive, IconInbox, IconMail, IconPencil, IconPin } from "../icons";
import { SessionCardBody, WsPrStatusMark } from "../sidebar/HoverCards";
import { SidebarCtxMenu } from "../sidebar/SidebarCtxMenu";
import React, { useEffect, useRef, useState } from "react";

/** The sidebar's selectable row — the shape every list family wears: session,
 *  workspace, PR, support, feed, archived and note rows. Migrated off the
 *  legacy row family, so the state that used to live in `-selected` /
 *  `-waiting` / `-unread` modifier classes now rides `data-*` attributes on
 *  the row itself and descendants read it through `group-data-[…]` variants.
 *  `data-sidebar-row` is the hook the ⌘↑/⌘↓ row walker queries by.
 *
 *  Rows wrapped in a `.sidebar-swipe-row` add `mt-0` — the wrapper carries the
 *  2px gap for them — plus the swipe transform; bare rows keep the margin. */
export const SIDEBAR_ROW =
	"group relative mt-0.5 w-full rounded-row border-0 bg-transparent py-[9px] pr-2 pl-2.5 text-left text-fg max-[720px]:px-1 max-[720px]:py-[13px]";

/** A row's title: one ellipsized line that brightens and emboldens for the
 *  states the row advertises. Read conversations stay quiet; unread ones
 *  brighten like Slack, a blocked one bolds under its blue wash. */
/* Pin + archive, hover-revealed on desktop: on hover they take the metadata's
   place at the far right so they don't crowd the title. Long titles run under
   that spot, so each wears an opaque row-hover plate with a soft left feather
   — swapped for the selected fill when the row is the selected one. The reveal
   is `group-hover`, which Tailwind gates to real hover devices for us; on touch
   these actions live behind the swipe gesture and the long-press sheet. */
const ROW_ACTION =
	"absolute top-1/2 hidden size-[26px] -translate-y-1/2 items-center justify-center rounded-md bg-[var(--bg-hover)] text-[15px] leading-none text-faint shadow-[-6px_0_5px_-2px_var(--bg-hover)] group-hover:flex hover:bg-active hover:text-fg group-data-[selected]:bg-active group-data-[selected]:shadow-[-6px_0_5px_-2px_var(--bg-active)]";

export const SIDEBAR_ROW_TITLE =
	"min-w-0 truncate text-body font-medium leading-[1.35] text-dim group-data-[selected]:text-fg group-data-[waiting]:font-semibold group-data-[unread]:font-semibold group-data-[unread]:text-fg max-[720px]:text-[16px]";

export function SidebarItem({
	session,
	localMode,
	selected,
	unread,
	mine,
	onClick,
	onArchive,
	pinned,
	onTogglePin,
	onRename,
	onSetStatus,
}: {
	session: UnifiedSession;
	localMode: boolean;
	selected: boolean;
	/** New activity since this session was last opened — brightens and bolds the
	    title, like an unread Slack conversation. */
	unread: boolean;
	/** The current user's own session — the owner name is redundant, so it's
	    dropped and the timestamp moves up onto the title line. */
	mine: boolean;
	onClick: () => void;
	onArchive: () => void;
	pinned: boolean;
	onTogglePin: () => void;
	onRename: (title: string) => void;
	/** Pin this session into a sidebar lane (null = back to derived). Present on
	    automation rows — it's how an automation run graduates into your lanes. */
	onSetStatus?: (status: LaneChoice | null) => void;
}) {
	const isPhone = useIsPhone();
	const waiting = !!session.waitingForInput || runNeedsAttention(session);
	const [editing, setEditing] = useState(false);
	const [draft, setDraft] = useState("");
	// Desktop right-click menu (mobile long-press opens the action sheet).
	const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number } | null>(null);
	useEffect(() => {
		if (!ctxMenu) return;
		const close = () => setCtxMenu(null);
		window.addEventListener("click", close);
		window.addEventListener("scroll", close, true);
		return () => {
			window.removeEventListener("click", close);
			window.removeEventListener("scroll", close, true);
		};
	}, [ctxMenu]);

	// Hover card: after a short dwell, the row's detail card — the same one
	// every other sidebar row raises. Held back while renaming (the input the
	// row turns into owns the interaction).
	const btnRef = useRef<HTMLButtonElement>(null);
	const card = useRowHoverCard(editing);
	const closeHover = card.close;

	// Mobile long-press → action sheet, and — importantly — the *tap* to open a
	// session is driven from `touchend`, not the synthesized `click`. The row
	// has `:hover` styles (the reveal-on-hover X, the hover background), and iOS
	// treats the first tap on a hover-styled element as a hover-in, swallowing the
	// click — so a click-driven open needs a second tap ("first tap doesn't work").
	// Firing on touchend sidesteps that entirely. A hold that stays roughly in
	// place for LONG_PRESS_MS opens the sheet instead; any real finger travel (a
	// scroll) cancels both.
	const [sheetOpen, setSheetOpen] = useState(false);
	const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
	const pressOrigin = useRef<{ x: number; y: number } | null>(null);
	const longPressed = useRef(false);
	const moved = useRef(false);
	const swipeOrigin = useRef<{ x: number; y: number; width: number } | null>(
		null,
	);
	const swiping = useRef(false);
	const swipeOffsetRef = useRef(0);
	const [dragging, setDragging] = useState(false);
	const [swipeAction, setSwipeAction] = useState<SwipeAction | null>(null);
	const [swipeOffset, setSwipeOffset] = useState(0);
	useEffect(() => {
		if (selected || !isPhone) {
			setSwipeOffset(0);
			swipeOffsetRef.current = 0;
			setSwipeAction(null);
			setDragging(false);
		}
	}, [isPhone, selected]);

	function clearPress() {
		if (pressTimer.current) clearTimeout(pressTimer.current);
		pressTimer.current = null;
		pressOrigin.current = null;
	}
	function onTouchStart(e: React.TouchEvent) {
		if (editing || e.touches.length !== 1) return;
		const t = e.touches[0];
		longPressed.current = false;
		moved.current = false;
		swiping.current = false;
		clearPress();
		// After clearPress (which nulls it) so it survives to onTouchMove/onTouchEnd.
		pressOrigin.current = { x: t.clientX, y: t.clientY };
		swipeOrigin.current = {
			x: t.clientX - swipeOffset,
			y: t.clientY,
			width: e.currentTarget.clientWidth,
		};
		setSwipeAction(null);
		pressTimer.current = setTimeout(() => {
			longPressed.current = true;
			closeHover();
			navigator.vibrate?.(10);
			setSheetOpen(true);
		}, LONG_PRESS_MS);
	}
	function onTouchMove(e: React.TouchEvent) {
		if (e.touches.length !== 1) return;
		const t = e.touches[0];
		const swipeO = swipeOrigin.current;
		if (swipeO && !longPressed.current) {
			const dx = t.clientX - swipeO.x;
			const dy = t.clientY - swipeO.y;
			if (
				swiping.current ||
				(Math.abs(dx) > SWIPE_AXIS_LOCK_PX && Math.abs(dx) > Math.abs(dy))
			) {
				swiping.current = true;
				moved.current = true;
				setDragging(true);
				clearPress();
				e.preventDefault();
				const offset = clampSwipe(dx, swipeO.width);
				swipeOffsetRef.current = offset;
				setSwipeOffset(offset);
				return;
			}
		}
		const o = pressOrigin.current;
		if (!o) return;
		if (
			Math.abs(t.clientX - o.x) > LONG_PRESS_SLOP ||
			Math.abs(t.clientY - o.y) > LONG_PRESS_SLOP
		) {
			moved.current = true;
			clearPress();
		}
	}
	function onTouchEnd(e: React.TouchEvent) {
		const hadOrigin = pressOrigin.current !== null;
		const wasSwiping = swiping.current;
		const rowWidth = swipeOrigin.current?.width ?? e.currentTarget.clientWidth;
		const currentOffset = swipeOffsetRef.current;
		clearPress();
		swipeOrigin.current = null;
		swiping.current = false;
		setDragging(false);
		if (editing) return;
		if (wasSwiping) {
			e.preventDefault();
			if (Math.abs(currentOffset) >= fullSwipeThreshold(rowWidth)) {
				const action: SwipeAction = currentOffset < 0 ? "archive" : "star";
				setSwipeAction(action);
				setSwipeOffset(swipeCommitOffset(action, rowWidth));
				window.setTimeout(() => {
					if (action === "archive") onArchive();
					else {
						onTogglePin();
						setSwipeOffset(0);
						window.setTimeout(() => setSwipeAction(null), SWIPE_COMMIT_MS);
					}
					swipeOffsetRef.current = 0;
				}, SWIPE_COMMIT_MS);
				return;
			}
			const snapped =
				Math.abs(currentOffset) > SWIPE_OPEN_THRESHOLD
					? currentOffset > 0
						? SWIPE_REVEAL_PX
						: -SWIPE_REVEAL_PX
					: 0;
			swipeOffsetRef.current = snapped;
			setSwipeOffset(snapped);
			return;
		}
		// A clean tap: it started on this row, never became a long-press, and
		// never turned into a scroll. Open now and swallow the ghost click iOS
		// would fire ~300ms later (which the :hover heuristic may drop anyway).
		if (hadOrigin && !longPressed.current && !moved.current) {
			e.preventDefault();
			if (swipeOffset !== 0) {
				setSwipeOffset(0);
				swipeOffsetRef.current = 0;
				return;
			}
			onClick();
		}
	}

	function commitRename() {
		onRename(draft.trim());
		setEditing(false);
	}

	const metaParts: React.ReactNode[] = [];
	// In "My sessions" the owner is always the current user, so hide it.
	if (!mine && session.startedBy && !session.automation) {
		metaParts.push(<span key="u">{session.startedBy}</span>);
	}
	// No idle "time since" here — times only appear while a run is live (the
	// hovercard/details still carry last activity).
	if (session.linearIssue) {
		metaParts.push(
			<span key="lin" className="sidebar-meta-linear">
				{session.linearIssue.identifier}
			</span>,
		);
	}

	const visibleSwipeOffset = isPhone ? swipeOffset : 0;
	// The swipe row is "open" — a revealed action sits behind it, so the slide
	// back and forth runs at the shorter duration.
	const swipeOpen = swipeAction !== null || visibleSwipeOffset !== 0;

	return (
		<Popover.Root {...card.rootProps}>
		<div
			className={`sidebar-swipe-row${
				swipeAction === "archive" || visibleSwipeOffset < 0
					? " is-open is-swipe-archive"
					: swipeAction === "star" || visibleSwipeOffset > 0
						? " is-open is-swipe-star"
						: ""
			}${dragging ? " is-dragging" : ""}`}
			style={
				visibleSwipeOffset
					? ({
							"--swipe-action-w": `${Math.max(
								SWIPE_REVEAL_PX,
								Math.abs(visibleSwipeOffset),
							)}px`,
						} as React.CSSProperties)
					: undefined
			}
		>
			{isPhone && (
				<button
					className="sidebar-swipe-action sidebar-swipe-action--archive"
					onClick={(e) => {
						e.stopPropagation();
						setSwipeOffset(0);
						onArchive();
					}}
					title="Archive session"
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
						setSwipeOffset(0);
						onTogglePin();
					}}
					title={pinned ? "Unpin session" : "Pin session"}
				>
					<IconPin size={22} fill={pinned ? "currentColor" : "none"} />
					<span>{pinned ? "Unpin" : "Pin"}</span>
				</button>
			)}
		<Popover.Trigger
			{...card.triggerProps}
			render={
				<button
					ref={btnRef}
					className={cn(
						SIDEBAR_ROW,
						// Inside a swipe row: the wrapper owns the gap, the row owns the
						// slide. Hover paints over selected/waiting here, as it always
						// has — the swipe row's rules outranked both.
						"z-1 mt-0 block touch-pan-y hover:bg-hover",
						// Other people's sessions stack a meta line under the title, so
						// the row is already two lines tall — trim its padding.
						!mine && "py-[7px]",
						waiting ? "bg-blue-soft" : selected && "bg-active",
						dragging
							? "transition-none"
							: swipeOpen
								? "transition-transform duration-(--dur-micro)"
								: "transition-transform duration-(--dur)",
						// One compositor layer for the row under the finger, none for
						// the idle list (dozens of retina-sized layers is a real tax).
						(dragging || swipeOpen) && "will-change-transform",
					)}
					data-sidebar-row=""
					data-selected={selected || undefined}
					data-waiting={waiting || undefined}
					data-unread={unread || undefined}
					style={
						visibleSwipeOffset
							? { transform: `translateX(${visibleSwipeOffset}px)` }
							: undefined
					}
					onClick={(e) => {
						// Touch taps are handled on touchend (and their ghost click is
						// preventDefault'd), so this path is the mouse/desktop one. Still
						// swallow a click that ends a long-press, as a belt-and-suspenders.
						if (longPressed.current) {
							longPressed.current = false;
							e.preventDefault();
							return;
						}
						onClick();
					}}
					onTouchStart={onTouchStart}
					onTouchMove={onTouchMove}
					onTouchEnd={onTouchEnd}
					onTouchCancel={() => {
						clearPress();
						swipeOrigin.current = null;
						swiping.current = false;
						setDragging(false);
					}}
					onContextMenu={(e) => {
						// On touch this is the long-press callout: the action sheet
						// owns that gesture, so suppress the native text-selection
						// callout rather than stacking both.
						if (longPressed.current || pressOrigin.current) {
							e.preventDefault();
							return;
						}
						e.preventDefault();
						closeHover();
						setCtxMenu({ x: e.clientX, y: e.clientY });
					}}
				/>
			}
		>
			{/* Same gap as .sidebar-group-header and .sidebar-ws-row: with the
			    shared .sidebar-rail slot in front, that's what puts every title on
			    one rail. */}
			<div className="flex min-w-0 items-center gap-[9px]">
				{/* Match workspace rows: the rail holds the PR glyph alone — a blocked
				    session reads from its accent wash and bold title, not from a second
				    dot wedged in beside it — and merged PRs keep the glyph itself
				    purple instead of adding metadata. */}
				<span className="sidebar-rail">
					{waiting && <span className="sr-only">Needs your attention</span>}
					{session.isRunning ? (
						<span className="size-2 shrink-0 rounded-full sidebar-status-running" />
					) : (
						<WsPrStatusMark sessions={[session]} size={18} />
					)}
				</span>
				{editing ? (
					<input
						className="min-w-0 flex-1 rounded-md border border-accent bg-bg px-[3px] py-0 text-body font-medium text-inherit outline-none max-[720px]:text-[16px]"
						value={draft}
						autoFocus
						onChange={(e) => setDraft(e.target.value)}
						onClick={(e) => e.stopPropagation()}
						onMouseDown={(e) => e.stopPropagation()}
						onDoubleClick={(e) => e.stopPropagation()}
						onBlur={commitRename}
						onKeyDown={(e) => {
							if (e.key === "Enter") commitRename();
							else if (e.key === "Escape") setEditing(false);
							e.stopPropagation();
						}}
					/>
				) : (
					<span
						className={SIDEBAR_ROW_TITLE}
						onDoubleClick={(e) => {
							e.stopPropagation();
							setDraft(session.title);
							setEditing(true);
						}}
					>
						{stripPrTitlePrefix(session.title)}
					</span>
				)}
				{localMode && session.local && !editing && (
					<span className="shrink-0 rounded-full border border-line px-1.5 py-px text-meta font-medium tracking-wide text-faint">
						local
					</span>
				)}
				{/* Own sessions collapse to one line: the timestamp (+ any PR/Linear
				    badge) rides to the right of the title, flush with the row edge. On
				    hover it fades and the archive button takes its place — but not on a
				    phone, where there is no archive button. */}
				{mine && !editing && metaParts.length > 0 && (
					<span
						className={cn(
							"ml-auto flex min-w-10 shrink-0 items-center justify-end gap-1 pl-2.5 whitespace-nowrap text-meta text-faint max-[720px]:text-label group-data-[unread]:text-dim",
							!isPhone && "group-hover:opacity-0",
						)}
					>
						{metaParts.map((part, i) => (
							<React.Fragment key={i}>
								{i > 0 && <span className="sidebar-meta-sep">·</span>}
								{part}
							</React.Fragment>
						))}
					</span>
				)}
				{!editing && hasDraft(`session:${session.id}`) && (
					<span
						className="sidebar-ws-draft"
						aria-label="Unsent draft. Return to finish it."
					>
						<IconPencil size={20} />
					</span>
				)}
			</div>
			{/* The block meta lives on its own line below the title, so it stays
			    readable under the hover-revealed buttons — it just reserves room on
			    the right so it clears them. */}
			{!mine && (
				<div
					className={cn(
						"mt-[3px] flex items-center gap-1 overflow-hidden pl-7 whitespace-nowrap text-meta text-faint max-[720px]:text-label group-data-[unread]:text-dim",
						!isPhone && "group-hover:pr-[58px]",
					)}
				>
					{metaParts.map((part, i) => (
						<React.Fragment key={i}>
							{i > 0 && <span className="sidebar-meta-sep">·</span>}
							{part}
						</React.Fragment>
					))}
				</div>
			)}
			{!isPhone && (
			<Tooltip
				label={pinned ? "Unpin session" : "Pin session"}
				shortcut={selected ? PIN_SHORTCUT_KEYS : undefined}
			>
				<span
					className={cn(
						ROW_ACTION,
						"right-[35px] data-[on]:bg-active data-[on]:text-fg",
					)}
					data-on={pinned || undefined}
					role="button"
					aria-label={pinned ? "Unpin session" : "Pin session"}
					onMouseEnter={closeHover}
					onClick={(e) => {
						e.stopPropagation();
						onTogglePin();
					}}
				>
					<IconPin size={19} fill={pinned ? "currentColor" : "none"} />
				</span>
			</Tooltip>
			)}
			{!isPhone && (
			<Tooltip
				label="Archive session"
				shortcut={selected ? ARCHIVE_SHORTCUT_KEYS : undefined}
			>
				<span
					className={cn(ROW_ACTION, "right-[7px]")}
					role="button"
					aria-label="Archive session"
					onMouseEnter={closeHover}
					onClick={(e) => {
						e.stopPropagation();
						onArchive();
					}}
				>
					<svg
						width="20"
						height="20"
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
			</Tooltip>
			)}
		</Popover.Trigger>
		</div>
		<RowCardPopup>
			<SessionCardBody session={session} />
		</RowCardPopup>
			{sheetOpen && (
				<MobileActionSheet
					session={session}
					mine={mine}
					onRename={() => {
						setDraft(session.title);
						setEditing(true);
					}}
					onArchive={onArchive}
					onSetStatus={onSetStatus}
					onClose={() => setSheetOpen(false)}
				/>
			)}
			{ctxMenu && (
				<SidebarCtxMenu
					x={ctxMenu.x}
					y={ctxMenu.y}
					onClose={() => setCtxMenu(null)}
					entries={[
						{
							kind: "item",
							icon: <IconMail size={20} />,
							// Offer the move you can actually make, not both directions.
							label: unread ? "Mark as read" : "Mark as unread",
							onClick: () =>
								unread
									? markRead(session.id, session.lastActivity)
									: markUnread(session.id),
						},
						{
							kind: "item",
							icon: (
								<IconPin size={20} fill={pinned ? "currentColor" : "none"} />
							),
							label: pinned ? "Unpin" : "Pin",
							onClick: onTogglePin,
						},
						...(onSetStatus
							? [
									// Claim this run into your own lanes (per-user — it
									// moves only in YOUR sidebar), where it then follows
									// its live state instead of staying parked in the
									// Automations band. Your own sessions are already
									// there, so they don't offer it.
									...(!mine || isClaimed(session)
										? [
												{
													kind: "item",
													icon: <IconInbox size={20} />,
													label: isClaimed(session)
														? "Remove from my workspaces"
														: "Add to my workspaces",
													onClick: () =>
														onSetStatus(isClaimed(session) ? null : "mine"),
												} as const,
											]
										: []),
									{
										kind: "status",
										current: pinnedLane(session) ?? null,
										onPick: onSetStatus,
									} as const,
								]
							: []),
						{
							kind: "item",
							icon: <IconPencil size={20} />,
							label: "Rename",
							onClick: () => {
								setDraft(session.title);
								setEditing(true);
							},
						},
						{ kind: "sep" },
						{
							kind: "item",
							icon: <IconArchive size={20} />,
							label: "Archive",
							onClick: onArchive,
						},
					]}
				/>
			)}
		</Popover.Root>
	);
}

// The bottom sheet raised by long-pressing a session row on touch. It gathers
// the per-session actions (rename, archive) into thumb-sized rows on the shared
// `BottomSheet` — backdrop, grabber, drag-to-dismiss and focus handling come
// from the primitive.
function MobileActionSheet({
	session,
	mine,
	onRename,
	onArchive,
	onSetStatus,
	onClose,
}: {
	session: UnifiedSession;
	/** Your own session — it's already in your lanes, so no claim action. */
	mine: boolean;
	onRename: () => void;
	onArchive: () => void;
	/** Pin the session into a lane (see SidebarItem) — automation rows only. */
	onSetStatus?: (status: LaneChoice | null) => void;
	onClose: () => void;
}) {
	// Lock the page behind the sheet so a scroll drags the list, not the page.
	useEffect(() => {
		const prev = document.body.style.overflow;
		document.body.style.overflow = "hidden";
		return () => {
			document.body.style.overflow = prev;
		};
	}, []);
	return (
		<BottomSheet label={`Actions for ${session.title}`} onClose={onClose}>
			{(dismiss) => (
				<SheetBody>
					<SheetTitle>{session.title}</SheetTitle>
					<SheetItem
						onClick={() => {
							onRename();
							dismiss();
						}}
					>
						<svg
							width="20"
							height="20"
							viewBox="0 0 16 16"
							fill="none"
							stroke="currentColor"
							strokeWidth="1.4"
						>
							<path d="M10.5 2.5l3 3L6 13l-3.5.5L3 10z" />
						</svg>
						Rename
					</SheetItem>
					{/* Claim this run into your own lanes, where it follows its live
					    state — the phone twin of the row's right-click action. */}
					{onSetStatus && (!mine || isClaimed(session)) && (
						<SheetItem
							onClick={() => {
								onSetStatus(isClaimed(session) ? null : "mine");
								dismiss();
							}}
						>
							<IconInbox size={22} />
							{isClaimed(session)
								? "Remove from my workspaces"
								: "Add to my workspaces"}
						</SheetItem>
					)}
					{/* Same lane chips as the workspace sheet — forcing a specific lane
					    for a run from a phone. Lanes are per-user: the move happens in
					    YOUR sidebar only. */}
					{onSetStatus && (
						<div className="px-4 py-2">
							<div className="mb-1.5 text-meta font-semibold text-faint">
								Move to lane
							</div>
							<div className="flex flex-wrap gap-1.5">
								{MINE_STATUS_META.map((m) => {
									const on = pinnedLane(session) === m.key;
									return (
										<Button
											variant="ghost"
											size="xs"
											key={m.key}
											type="button"
											className="gap-1.5 whitespace-normal px-2 text-control-label"
											style={{
												borderColor: on ? m.dotColor : "var(--border)",
												color: on ? "var(--text)" : "var(--text-dim)",
											}}
											onClick={() => {
												onSetStatus(on ? null : m.key);
												dismiss();
											}}
										>
											<span
												style={{
													width: 8,
													height: 8,
													borderRadius: "50%",
													background: m.dotColor,
													flexShrink: 0,
												}}
											/>
											{m.label}
										</Button>
									);
								})}
								<Button
									variant="ghost"
									size="xs"
									type="button"
									className="whitespace-normal px-2 text-control-label"
									style={{
										borderColor: !pinnedLane(session)
											? "var(--text-dim)"
											: "var(--border)",
										color: !pinnedLane(session)
											? "var(--text)"
											: "var(--text-dim)",
									}}
									onClick={() => {
										onSetStatus(null);
										dismiss();
									}}
								>
									Auto
								</Button>
							</div>
						</div>
					)}
					<SheetSeparator />
					<SheetItem
						tone="danger"
						onClick={() => {
							onArchive();
							dismiss();
						}}
					>
						<svg
							width="20"
							height="20"
							viewBox="0 0 16 16"
							fill="none"
							stroke="currentColor"
							strokeWidth="1.4"
						>
							<rect x="2.25" y="2.75" width="11.5" height="3" rx="0.6" />
							<path d="M3.25 5.75v6.5a1 1 0 0 0 1 1h7.5a1 1 0 0 0 1-1v-6.5" />
							<path d="M6.5 8.5h3" strokeLinecap="round" />
						</svg>
						Archive
					</SheetItem>
				</SheetBody>
			)}
		</BottomSheet>
	);
}
