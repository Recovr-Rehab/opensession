import React from "react";
import type { ReviewQueueItem } from "../lib/review-queue";
import { prStatusMark } from "../lib/pr-status";
import { SIDEBAR_RAIL } from "../lib/sidebar-classes";
import { providerFromUrl } from "../lib/provider";
import { shortTime } from "../lib/time";
import {
	IconArrowUpRight,
	IconPin,
	IconPullRequest,
	IconX,
} from "./icons";
import { cn } from "../ui/cn";
import { ContextMenu } from "../ui/menu";
import { Popover } from "../ui/popover";
import { Tooltip } from "../ui/tooltip";
import { SIDEBAR_ROW, SIDEBAR_ROW_TITLE } from "./sidebar/SidebarItem";
import {
	PrRowCard,
	RowCardPopup,
	useRowHoverCard,
} from "./SidebarRowCards";
import { useIsPhone } from "../hooks/useIsPhone";

/**
 * A session-less open PR, rendered inside a project's status lanes (ported
 * from the retired standalone Pull-requests band — the sidebar's PR queue
 * dissolved into the per-repo project groups). PRs that have a live session
 * ride their workspace row instead; this row covers the rest: automation
 * output, teammates' PRs surfaced by the PR filter, review requests whose
 * session is archived.
 *
 * Single-line, in the workspace rows' exact shape: the rail glyph carries the
 * PR state (the same color language as WsPrStatusMark), the title fills the
 * row, the right edge shows last-update time. Author, number, checks and the
 * spelled-out status live in the hover card and the context menu.
 */

// The ws rows' PR color language (prStatusMark), computed off the queue item's
// OpenPr: red = blocked (conflict / failing checks / changes requested),
// yellow = checks running, faint = draft, green = open and healthy.
function PrStateMark({ item, size }: { item: ReviewQueueItem; size: number }) {
	const status = prStatusMark(item.pr);
	return (
		<span title={item.status || status.label}>
			<IconPullRequest size={size} className={status.className} />
		</span>
	);
}

export function PrRow({
	item,
	selected,
	pinned,
	onTogglePin,
	onOpen,
	onClose,
	closing,
}: {
	item: ReviewQueueItem;
	selected: boolean;
	/** Pinned into the sidebar's Pinned band (per-user, like workspace pins). */
	pinned: boolean;
	onTogglePin: () => void;
	/** Open the PR's workspace (resolve-or-create, Review tab). */
	onOpen: () => void;
	/** Close the PR on the provider without merging (confirmed upstream). */
	onClose: () => void;
	closing: boolean;
}) {
	const isPhone = useIsPhone();
	const card = useRowHoverCard();
	return (
		<Popover.Root {...card.rootProps}>
		<ContextMenu.Root>
			<ContextMenu.Trigger
				render={
					// Both triggers ride the same row button: the popover raises the
					// hover card, the context menu keeps right-click. The card steps
					// aside when the menu opens so the two never overlap.
					<Popover.Trigger
						{...card.triggerProps}
						render={
							<button
								type="button"
								className={cn(
									SIDEBAR_ROW,
									"sidebar-ws-row",
									selected ? "bg-pressed" : "hover:bg-hover",
								)}
								data-sidebar-row=""
								data-selected={selected || undefined}
								onClick={onOpen}
								onContextMenu={card.close}
								aria-label={item.pr.title}
							/>
						}
					/>
				}
			>
			<span className={SIDEBAR_RAIL}>
				<PrStateMark item={item} size={18} />
			</span>
			<span className={SIDEBAR_ROW_TITLE}>{item.pr.title}</span>
			{!isPhone && (
				<span
					className="sidebar-ws-time"
					aria-label={new Date(item.pr.updatedAt).toLocaleString()}
				>
					{shortTime(item.pr.updatedAt)}
				</span>
			)}
			{/* Hover actions in the workspace rows' shape: pin keeps the PR in
			    the Pinned band; the trailing action closes the PR upstream
			    (confirmed). It deliberately does NOT wear the archive icon —
			    this row sits beside workspace rows whose trailing icon archives
			    locally, and a mis-click here closes someone's PR on GitHub. */}
			<span
				className={cn(
					"sidebar-ws-actions",
					// The selected row's fill under the cluster, which the
					// selected-row rule in legacy.css used to carry.
					"group-data-[selected]:bg-active group-data-[selected]:shadow-[-6px_0_5px_-2px_var(--bg-active)]",
				)}
			>
				<Tooltip label={pinned ? "Unpin pull request" : "Pin pull request"}>
					<span
						role="button"
						tabIndex={0}
						className={`sidebar-ws-action${pinned ? " is-on" : ""}`}
						aria-label={pinned ? "Unpin pull request" : "Pin pull request"}
						onMouseEnter={card.close}
						onClick={(e) => {
							e.stopPropagation();
							onTogglePin();
						}}
						onKeyDown={(e) => {
							if (e.key === "Enter" || e.key === " ") {
								e.stopPropagation();
								onTogglePin();
							}
						}}
					>
						<IconPin size={21} fill={pinned ? "currentColor" : "none"} />
					</span>
				</Tooltip>
				<Tooltip label="Close pull request">
					<span
						role="button"
						tabIndex={0}
						className="sidebar-ws-action"
						aria-label="Close pull request"
						onMouseEnter={card.close}
						onClick={(e) => {
							e.stopPropagation();
							onClose();
						}}
						onKeyDown={(e) => {
							if (e.key === "Enter" || e.key === " ") {
								e.stopPropagation();
								onClose();
							}
						}}
					>
						<IconX size={21} />
					</span>
				</Tooltip>
			</span>
			</ContextMenu.Trigger>
			<ContextMenu.Popup className="min-w-[220px]">
				<ContextMenu.Item onClick={onOpen}>
					<span className="grow">Open review</span>
				</ContextMenu.Item>
				<ContextMenu.Item
					render={
						<a href={item.pr.url} target="_blank" rel="noopener" />
					}
				>
					<IconArrowUpRight size={18} />
					<span className="grow">Open on {providerFromUrl(item.pr.url).name}</span>
				</ContextMenu.Item>
				<ContextMenu.Separator />
				<ContextMenu.Item
					className="text-red data-[highlighted]:bg-red-soft"
					disabled={closing}
					onClick={onClose}
				>
					<IconX size={18} />
					<span className="grow">{closing ? "Closing…" : "Close pull request…"}</span>
				</ContextMenu.Item>
			</ContextMenu.Popup>
		</ContextMenu.Root>
			<RowCardPopup>
				<PrRowCard item={item} />
			</RowCardPopup>
		</Popover.Root>
	);
}
