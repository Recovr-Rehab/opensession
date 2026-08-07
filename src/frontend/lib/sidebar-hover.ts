import type { WorkspaceOverview } from "./api";
import { runNeedsAttention } from "./sidebar-lanes";
import type { MineStatus } from "./sidebar-types";
import type { UnifiedSession, Workspace } from "./types";
import { loadOverview, overviewCache } from "./workspace-overview";
import { useEffect, useState } from "react";

// The single prominent status line + its dot/tone. Ordering mirrors how a person
// triages: a blocked question first, then live activity, then PR/lifecycle.
export function hoverState(s: UnifiedSession): {
	label: string;
	tone: "accent" | "blue" | "green" | "purple" | "yellow" | "dim";
	dotClass: string;
} {
	if (s.waitingForInput)
		return {
			label: "Waiting for your input",
			tone: "blue",
			dotClass: "sidebar-status-waiting",
		};
	if (runNeedsAttention(s))
		return {
			label: "Last run failed. Needs attention.",
			tone: "accent",
			dotClass: "sidebar-status-waiting",
		};
	if (s.isRunning)
		return {
			label: "Running",
			tone: "green",
			dotClass: "sidebar-status-running",
		};
	if (s.prState === "MERGED")
		return { label: "Merged", tone: "purple", dotClass: "hovercard-dot-purple" };
	if (s.prState === "CLOSED")
		return { label: "PR closed", tone: "dim", dotClass: "hovercard-dot-red" };
	if (s.prState === "OPEN")
		return {
			label: s.prIsDraft ? "Draft PR — in review" : "In review",
			tone: "green",
			dotClass: "hovercard-dot-green",
		};
	return { label: "Idle", tone: "dim", dotClass: "hovercard-dot-dim" };
}

export function prTone(s: UnifiedSession): string {
	if (s.prState === "MERGED") return "merged";
	if (s.prState === "CLOSED") return "closed";
	return "open";
}
export function prettyReview(d: string): string {
	if (d === "APPROVED") return "approved";
	if (d === "CHANGES_REQUESTED") return "changes requested";
	if (d === "REVIEW_REQUIRED") return "review required";
	return d.toLowerCase().replace(/_/g, " ");
}
export function compactNum(n: number): string {
	if (n >= 10000) return `${Math.round(n / 1000)}k`;
	if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
	return String(n);
}

// ── Workspace hover card ────────────────────────────────────────────────────
// Structural subset of WsRow (declared inside Sidebar) that the card reads.
export interface WsCardRow {
	key: string;
	workspace: Workspace | null;
	name: string;
	sessions: UnifiedSession[];
	status: MineStatus;
	lastActivity: string;
	running: boolean;
}

// Footer action button base — the color variant carries the status meaning
// (green = ready to merge, purple = merged/archive, accent = needs an answer).
export const WS_ACTION =
	"flex shrink-0 cursor-pointer items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium no-underline";

// Overview (description + thumbnails) for a workspace row. Same cache (and
// key) as the right panel's WorkspaceInfo block, so a workspace that's been
// opened paints instantly and vice versa. Shared by the hover card (desktop)
// and the long-press sheet (mobile).
export function useWsOverview(row: WsCardRow): WorkspaceOverview | null {
	const cacheKey =
		row.workspace?.id || `sessions:${row.sessions.map((c) => c.id).join(",")}`;
	const activityKey = row.lastActivity || row.sessions.map((c) => c.lastActivity).join(",");
	const [ov, setOv] = useState<WorkspaceOverview | null>(
		() => overviewCache.get(cacheKey)?.data ?? null,
	);
	useEffect(() => {
		let alive = true;
		const cached = overviewCache.get(cacheKey);
		setOv(cached?.data ?? null);
		if (row.sessions.length === 0) return;
		const activityAt = activityKey ? new Date(activityKey).getTime() : 0;
		if (
			cached &&
			Date.now() - cached.at < 30_000 &&
			(!activityAt || cached.at >= activityAt)
		)
			return;
		loadOverview(
			cacheKey,
			row.workspace?.id ?? null,
			row.sessions.map((c) => ({
				id: c.id,
				title: c.title,
				createdAt: c.createdAt,
				lastActivity: c.lastActivity,
			})),
		)
			.then((d) => {
				if (alive) setOv(d);
			})
			.catch(() => {
				// The view just stays without a description/thumbnails.
			});
		return () => {
			alive = false;
		};
	}, [cacheKey, activityKey]);
	return ov;
}

// The PR that fronts the workspace (the newest session that has one) and how to
// present it: "basically ready to be merged" (open, not draft, checks green,
// no changes requested) turns the main action green; the status bits spell
// out draft/merged/closed, the review decision, and a checks summary.
export function wsPrInfo(row: WsCardRow) {
	const newestFirst = [...row.sessions].sort((a, b) =>
		(b.lastActivity || "").localeCompare(a.lastActivity || ""),
	);
	const prSession = newestFirst.find((c) => c.prUrl);
	const branch = prSession?.branch || newestFirst.find((c) => c.branch)?.branch;
	const prReady =
		!!prSession &&
		prSession.prState === "OPEN" &&
		!prSession.prIsDraft &&
		prSession.prReviewDecision !== "CHANGES_REQUESTED" &&
		(!prSession.prChecks ||
			prSession.prChecks.total === 0 ||
			(prSession.prChecks.failed === 0 && prSession.prChecks.pending === 0));
	const prStatusBits = prSession
		? [
				prSession.prState === "OPEN" && prSession.prIsDraft ? "draft" : null,
				prSession.prState === "MERGED" ? "merged" : null,
				prSession.prState === "CLOSED" ? "closed" : null,
				prSession.prReviewDecision
					? prettyReview(prSession.prReviewDecision)
					: null,
				prSession.prChecks && prSession.prChecks.total > 0
					? prSession.prChecks.failed > 0
						? `${prSession.prChecks.failed} failing`
						: prSession.prChecks.pending > 0
							? `${prSession.prChecks.pending} pending`
							: "checks pass"
					: null,
			].filter((b): b is string => !!b)
		: [];
	return { prSession, branch, prReady, prStatusBits };
}

/** Stills rendered in the hover card's filmstrip. The strip scrolls, so this
 *  is only a bound on how many images a hover preview loads; the rest are a
 *  "+N" away in the lightbox. */
export const MAX_HOVERCARD_MEDIA = 8;
