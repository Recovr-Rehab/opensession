import { useState } from "react";
import { linkPrStackApi } from "../../lib/api";
import { PR_ROW_OUT } from "../../lib/pr-tone-classes";
import { stackLayersTopFirst } from "../../lib/pr-stack";
import { prPath } from "../../lib/share-link";
import { SIDEBAR_HOVER_LAYER } from "../../lib/sidebar-classes";
import type { PrDetails, PrStackLayer } from "../../lib/types";
import { Badge } from "../../ui/badge";
import { Button } from "../../ui/button";
import { cn } from "../../ui/cn";
import { toast } from "../../ui/toast";
import { IconArrowUpRight } from "../icons";
import { StackNode, StackRail } from "./StackRail";

/**
 * The stack map: every layer of a GitHub stack, top layer first, with the trunk
 * as the last node — the way the stack is drawn on github.com, and the way the
 * status strip's popover already draws it (pr/StackPopover.tsx). The two share
 * the rail itself (pr/StackRail.tsx) so they cannot drift apart.
 *
 * Rows wear the sidebar's row language rather than a list shape of their own: a
 * 22px leading rail carrying the state glyph, the title on the shared text rail
 * after it, the quiet `#number · branch` line under it, one `rounded-row` pill
 * that fills on hover (SIDEBAR_HOVER_LAYER, a layer so it composites over the
 * current row's fill instead of replacing it), and `bg-selected` for the layer
 * you are reading. A stack is a list of places you can open, which is what the
 * sidebar's rows are, so it reads as the same app rather than as a bordered
 * text block wedged under the header.
 *
 * Also carries the "link into a stack" action for a session that was branched
 * off another session's branch but whose PRs were never linked (pr.stackBase,
 * set by the session PR route).
 */

/** One layer. The row is the pill; the title link and the out-arrow are
 *  siblings inside it, because an anchor cannot nest inside an anchor. */
function StackLayerRow({
	layer,
	current,
	first,
	repo,
	onOpenPr,
}: {
	layer: PrStackLayer;
	current: boolean;
	first: boolean;
	repo?: string;
	onOpenPr?: (repo: string, branch: string) => void;
}) {
	// Layers open in THIS review panel, not on github.com — the arrow at the
	// right is the way out. Falls back to the GitHub URL only when the repo id is
	// unknown, so a row is never a dead end.
	const inApp = repo ? prPath(repo, layer.headRefName) : null;
	return (
		<li
			className={cn(
				"group/row relative flex items-stretch gap-[7px] rounded-row pr-1 pl-2",
				SIDEBAR_HOVER_LAYER,
				current && "bg-selected",
			)}
			aria-current={current ? "true" : undefined}
		>
			<StackRail first={first}>
				<StackNode state={layer.state} isDraft={layer.isDraft} />
			</StackRail>
			<a
				className="min-w-0 flex-1 py-1.5 no-underline"
				href={inApp || layer.url}
				{...(inApp ? {} : { target: "_blank", rel: "noopener" })}
				onClick={(e) => {
					// Modified clicks keep native new-tab behavior.
					if (!inApp || !onOpenPr || e.metaKey || e.ctrlKey || e.shiftKey)
						return;
					e.preventDefault();
					onOpenPr(repo!, layer.headRefName);
				}}
			>
				<span
					className={cn(
						"block truncate text-item-title leading-snug",
						current
							? "font-semibold text-fg"
							: "font-medium text-dim group-hover/row:text-fg",
					)}
				>
					{layer.title}
				</span>
				<span className="block truncate text-meta leading-snug text-faint">
					#{layer.number} · {layer.headRefName}
				</span>
			</a>
			{/* Hover-revealed, like the sidebar row's own trailing actions: the row
			    already opens the layer here, so the way out to GitHub stays quiet
			    until you point at the row. */}
			<a
				className={cn(
					PR_ROW_OUT,
					"self-center opacity-0 group-hover/row:opacity-100 focus-visible:opacity-100",
				)}
				href={layer.url}
				target="_blank"
				rel="noopener"
				aria-label={`Open #${layer.number} on GitHub`}
			>
				<IconArrowUpRight size={18} />
			</a>
		</li>
	);
}

/**
 * The stack map body, rendered by both PrPanel layouts through the wrapper
 * below.
 */
function StackBody({
	pr,
	sessionId,
	repo,
	onOpenPr,
	onLinked,
}: {
	pr: PrDetails;
	sessionId?: string;
	/** Registered repo id, for building in-app links to the other layers. */
	repo?: string;
	onOpenPr?: (repo: string, branch: string) => void;
	onLinked: () => void;
}) {
	const [linking, setLinking] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const stack = pr.stack;

	const link = async () => {
		if (!sessionId) return;
		setLinking(true);
		setError(null);
		try {
			await linkPrStackApi(sessionId);
			toast("Linked into a stack");
			onLinked();
		} catch (e: any) {
			setError(e?.message || "Couldn't link the stack");
		} finally {
			setLinking(false);
		}
	};

	if (!stack)
		return (
			<>
				<div className="text-xs leading-relaxed text-dim">
					This branch was cut from <Badge variant="outline">{pr.stackBase}</Badge>{" "}
					but the PRs aren't a stack on GitHub yet, so each is still reviewed
					against the whole chain.
				</div>
				<div className="flex items-center gap-3 pt-1">
					<Button size="sm" onClick={link} disabled={linking}>
						{linking ? "Linking…" : "Link into a stack"}
					</Button>
					{error && <span className="text-xs text-red">{error}</span>}
				</div>
			</>
		);

	// Top of the stack first — the trunk is the last node under the last row.
	const layers = stackLayersTopFirst(stack);
	return (
		<ul className="m-0 flex list-none flex-col p-0">
			{layers.map((layer, i) => (
				<StackLayerRow
					key={layer.number}
					layer={layer}
					current={layer.number === pr.number}
					first={i === 0}
					repo={repo}
					onOpenPr={onOpenPr}
				/>
			))}
			{/* The trunk: not a layer, just where the bottom one lands. It ends the
			    rail, which is what the "Bottom of the stack merges into …" sentence
			    used to say in prose. */}
			<li className="flex items-stretch gap-[7px] pr-1 pl-2">
				<StackRail last>
					<StackNode />
				</StackRail>
				<span className="min-w-0 flex-1 py-1.5">
					<span className="block truncate font-mono text-label leading-snug text-dim">
						{stack.baseRefName}
					</span>
					<span className="block truncate text-meta leading-snug text-faint">
						Base branch
					</span>
				</span>
			</li>
		</ul>
	);
}

/**
 * Whether this PR has anything stack-shaped to say: a real stack, or a session
 * stacked locally whose PRs a human could still link. Both layouts gate on
 * this so a standalone PR never grows an empty section.
 */
function hasStackToShow(pr: PrDetails, sessionId?: string): boolean {
	return !!pr.stack || (!!pr.stackBase && !!sessionId);
}

/** Where this PR sits in its chain of layers, under the review header. */
export function StackSection({
	pr,
	sessionId,
	repo,
	onOpenPr,
	onLinked,
}: {
	pr: PrDetails;
	sessionId?: string;
	repo?: string;
	onOpenPr?: (repo: string, branch: string) => void;
	onLinked: () => void;
}) {
	if (!hasStackToShow(pr, sessionId)) return null;
	return (
		<section className="shrink-0 px-6 pb-4 phone:px-3">
			{/* A caption over the rows, the sidebar's own: label step, semibold, the
			    count sitting with the name rather than pinned to the far edge. */}
			<h2 className="m-0 mb-0.5 flex items-center gap-[5px] pl-2 text-label font-semibold text-dim">
				Stack
				{pr.stack && (
					<span className="font-medium text-faint">
						{pr.stack.position} of {pr.stack.size}
					</span>
				)}
			</h2>
			<div className="flex max-w-[680px] flex-col gap-1">
				<StackBody
					pr={pr}
					sessionId={sessionId}
					repo={repo}
					onOpenPr={onOpenPr}
					onLinked={onLinked}
				/>
			</div>
		</section>
	);
}
