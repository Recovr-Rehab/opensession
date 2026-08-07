import { useIsPhone } from "../../hooks/useIsPhone";
import { hasDraft } from "../../lib/drafts";
import { markRead, markUnread } from "../../lib/reads";
import { isClaimed, pinnedLane, runNeedsAttention, stripPrTitlePrefix } from "../../lib/sidebar-lanes";
import { ARCHIVE_SHORTCUT_KEYS, LONG_PRESS_MS, LONG_PRESS_SLOP, PIN_SHORTCUT_KEYS, SWIPE_AXIS_LOCK_PX, SWIPE_COMMIT_MS, SWIPE_OPEN_THRESHOLD, SWIPE_REVEAL_PX, clampSwipe, fullSwipeThreshold, swipeCommitOffset, useSheetDismiss, type SwipeAction } from "../../lib/sidebar-swipe";
import { MINE_STATUS_META, type LaneChoice } from "../../lib/sidebar-types";
import type { UnifiedSession } from "../../lib/types";
import { Button } from "../../ui/button";
import { Popover } from "../../ui/popover";
import { Tooltip } from "../../ui/tooltip";
import { RowCardPopup, useRowHoverCard } from "../SidebarRowCards";
import { IconArchive, IconInbox, IconMail, IconPencil, IconPin } from "../icons";
import { SessionCardBody, WsPrStatusMark } from "../sidebar/HoverCards";
import { SidebarCtxMenu } from "../sidebar/SidebarCtxMenu";
import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

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
	// session is driven from `touchend`, not the synthesized `click`. `.sidebar-item`
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
					className={`sidebar-item ${!mine ? "sidebar-item--twoline" : ""} ${selected ? "sidebar-item-selected" : ""} ${waiting ? "sidebar-item-waiting" : ""} ${unread ? "sidebar-item-unread" : ""}`}
					style={
						visibleSwipeOffset
							? ({ "--swipe-x": `${visibleSwipeOffset}px` } as React.CSSProperties)
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
			<div className="sidebar-item-top">
				{/* Match workspace rows: the rail holds the PR glyph alone — a blocked
				    session reads from its accent wash and bold title, not from a second
				    dot wedged in beside it — and merged PRs keep the glyph itself
				    purple instead of adding metadata. */}
				<span className="sidebar-rail">
					{waiting && <span className="sr-only">Needs your attention</span>}
					{session.isRunning ? (
						<span className="sidebar-item-status sidebar-status-running" />
					) : (
						<WsPrStatusMark sessions={[session]} size={18} />
					)}
				</span>
				{editing ? (
					<input
						className="sidebar-item-rename"
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
						className="sidebar-item-title"
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
				{mine && !editing && metaParts.length > 0 && (
					<span className="sidebar-item-inline-meta">
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
			{!mine && (
				<div className="sidebar-item-meta pl-[28px]">
					{metaParts.map((part, i) => (
						<React.Fragment key={i}>
							{i > 0 && <span className="sidebar-meta-sep">·</span>}
							{part}
						</React.Fragment>
					))}
				</div>
			)}
			<Tooltip
				label={pinned ? "Unpin session" : "Pin session"}
				shortcut={selected ? PIN_SHORTCUT_KEYS : undefined}
			>
				<span
					className={`sidebar-item-pin${pinned ? " is-on" : ""}`}
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
			<Tooltip
				label="Archive session"
				shortcut={selected ? ARCHIVE_SHORTCUT_KEYS : undefined}
			>
				<span
					className="sidebar-item-x"
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
// the per-session actions (rename, archive) into thumb-sized rows. Rendered in
// a portal over a dimmed, tap-to-dismiss backdrop.
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
	const drag = useSheetDismiss(onClose);
	// Lock the page behind the sheet so a scroll drags the list, not the page.
	useEffect(() => {
		const prev = document.body.style.overflow;
		document.body.style.overflow = "hidden";
		return () => {
			document.body.style.overflow = prev;
		};
	}, []);
	return createPortal(
		<div className="mobile-action-sheet-backdrop" onClick={onClose}>
			<div
				className="mobile-action-sheet"
				style={drag.style}
				{...drag.handlers}
				onClick={(e) => e.stopPropagation()}
			>
				<div className="mobile-sheet-grip" />
				<div className="mobile-sheet-title">{session.title}</div>
				<button
					className="mobile-sheet-item"
					onClick={() => {
						onRename();
						onClose();
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
				</button>
				{/* Claim this run into your own lanes, where it follows its live
				    state — the phone twin of the row's right-click action. */}
				{onSetStatus && (!mine || isClaimed(session)) && (
					<button
						className="mobile-sheet-item"
						onClick={() => {
							onSetStatus(isClaimed(session) ? null : "mine");
							onClose();
						}}
					>
						<IconInbox size={22} />
						{isClaimed(session)
							? "Remove from my workspaces"
							: "Add to my workspaces"}
					</button>
				)}
				{/* Same lane chips as the workspace sheet — forcing a specific lane
				    for a run from a phone. Lanes are per-user: the move happens in
				    YOUR sidebar only. */}
				{onSetStatus && (
					<div className="px-4 py-2">
						<div className="mb-1.5 text-[11px] font-semibold text-faint">
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
											onClose();
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
									onClose();
								}}
							>
								Auto
							</Button>
						</div>
					</div>
				)}
				<div className="mobile-sheet-sep" />
				<button
					className="mobile-sheet-item mobile-sheet-item--danger"
					onClick={() => {
						onArchive();
						onClose();
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
				</button>
			</div>
		</div>,
		document.body,
	);
}
