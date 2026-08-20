import { sessionPrRefs } from "./session-prs";
import type { SettlementRecord } from "./settlements";
import type { UnifiedSession, Workspace } from "./types";

const DAY_MS = 86_400_000;

export interface LifecycleRow {
	key: string;
	workspace: Workspace | null;
	createdAt: string;
	lastActivity: string;
	running: boolean;
	status: string;
	sessions: UnifiedSession[];
}

export interface WorkspaceLifecycleFacts {
	key: string;
	createdAt: string;
	lastActivity: string;
	blocked: boolean;
	hasOpenPr: boolean;
	terminalPrSignature: string | null;
	terminalPrAt: string | null;
}

export interface WorkspaceLifecycle {
	settled: boolean;
	settledAt: string | null;
	reason: "explicit" | "pull-request" | "inactive" | null;
}

function validTime(value: string | null | undefined): number {
	const time = value ? Date.parse(value) : Number.NaN;
	return Number.isNaN(time) ? Number.NEGATIVE_INFINITY : time;
}

/** Full workspace facts, derived from canonical membership rather than the
 * filtered sessions carried by a rendered row. */
export function workspaceLifecycleFacts(
	row: LifecycleRow,
	canonicalSessions: readonly UnifiedSession[] = row.sessions,
): WorkspaceLifecycleFacts {
	const sessions = canonicalSessions.length ? canonicalSessions : row.sessions;
	const lastActivity = sessions.reduce(
		(latest, session) =>
			validTime(session.lastActivity) > validTime(latest)
				? session.lastActivity
				: latest,
		row.lastActivity || "",
	);
	const oldestSession = sessions.reduce(
		(oldest, session) =>
			validTime(oldest) === Number.NEGATIVE_INFINITY ||
			validTime(session.createdAt) < validTime(oldest)
				? session.createdAt
				: oldest,
		row.createdAt || "",
	);
	const createdAt = row.workspace?.createdAt || oldestSession || row.createdAt;
	const blocked =
		row.running ||
		row.status === "needsinput" ||
		sessions.some(
			(session) =>
				session.isRunning ||
				session.waitingForInput ||
				(session.queuedCount ?? 0) > 0 ||
				!!session.reviewRequest,
		);

	const prs = new Map<
		string,
		{ state?: "OPEN" | "MERGED" | "CLOSED"; updatedAt?: string }
	>();
	for (const session of sessions) {
		for (const pr of sessionPrRefs(session)) {
			// A branch-shaped reference without a PR number or URL is not proof that
			// a pull request exists and must not make an idle workspace terminal.
			if (pr.number === undefined && !pr.url) continue;
			const id = pr.url || `${pr.repo}#${pr.number}`;
			const current = prs.get(id);
			if (
				!current ||
				validTime(pr.updatedAt) >= validTime(current.updatedAt)
			)
				prs.set(id, { state: pr.state, updatedAt: pr.updatedAt });
		}
	}
	const orderedPrs = [...prs.entries()].sort(([a], [b]) => a.localeCompare(b));
	const hasOpenPr = orderedPrs.some(([, pr]) => pr.state === "OPEN");
	const allTerminal =
		orderedPrs.length > 0 &&
		orderedPrs.every(([, pr]) => pr.state === "MERGED" || pr.state === "CLOSED");
	const terminalPrSignature = allTerminal
		? orderedPrs.map(([id, pr]) => `${id}:${pr.state}`).join("|")
		: null;
	const terminalPrAt = allTerminal
		? orderedPrs.reduce(
				(latest, [, pr]) =>
					validTime(pr.updatedAt) > validTime(latest)
						? (pr.updatedAt ?? latest)
						: latest,
				null as string | null,
			)
		: null;

	return {
		key: row.key,
		createdAt,
		lastActivity,
		blocked,
		hasOpenPr,
		terminalPrSignature,
		terminalPrAt,
	};
}

export function workspaceLifecycle(
	facts: WorkspaceLifecycleFacts,
	override: SettlementRecord | undefined,
	options: {
		now: number;
		autoSettleDays: number | "off";
		autoSettlePrs: boolean;
		pinned?: boolean;
		snoozed?: boolean;
	},
): WorkspaceLifecycle {
	if (facts.blocked || options.pinned || options.snoozed)
		return { settled: false, settledAt: null, reason: null };

	const activityAt = validTime(facts.lastActivity);
	const overrideAt = validTime(override?.at);
	if (override?.state === "settled" && overrideAt >= activityAt) {
		return { settled: true, settledAt: override.at, reason: "explicit" };
	}

	const terminalSuppressed =
		!!facts.terminalPrSignature &&
		facts.terminalPrSignature === override?.terminalSignature;
	if (
		options.autoSettlePrs &&
		facts.terminalPrSignature &&
		facts.terminalPrAt &&
		!terminalSuppressed &&
		validTime(facts.terminalPrAt) >= activityAt
	) {
		return {
			settled: true,
			settledAt: facts.terminalPrAt || facts.lastActivity,
			reason: "pull-request",
		};
	}

	if (facts.hasOpenPr || options.autoSettleDays === "off")
		return { settled: false, settledAt: null, reason: null };
	const anchor = Math.max(
		activityAt,
		override?.state === "active" ? overrideAt : Number.NEGATIVE_INFINITY,
	);
	const threshold = anchor + options.autoSettleDays * DAY_MS;
	if (Number.isFinite(threshold) && threshold < options.now) {
		return {
			settled: true,
			settledAt: new Date(threshold).toISOString(),
			reason: "inactive",
		};
	}
	return { settled: false, settledAt: null, reason: null };
}

export function sortActiveByCreation<T extends { key: string }>(
	rows: readonly T[],
	facts: ReadonlyMap<string, WorkspaceLifecycleFacts>,
): T[] {
	return [...rows].sort((left, right) => {
		const created =
			validTime(facts.get(right.key)?.createdAt) -
			validTime(facts.get(left.key)?.createdAt);
		return created || left.key.localeCompare(right.key);
	});
}

export function sortSettledByTime<T extends { key: string }>(
	rows: readonly T[],
	lifecycle: ReadonlyMap<string, WorkspaceLifecycle>,
	facts: ReadonlyMap<string, WorkspaceLifecycleFacts>,
): T[] {
	return [...rows].sort((left, right) => {
		const settled =
			validTime(lifecycle.get(right.key)?.settledAt) -
			validTime(lifecycle.get(left.key)?.settledAt);
		if (settled) return settled;
		const created =
			validTime(facts.get(right.key)?.createdAt) -
			validTime(facts.get(left.key)?.createdAt);
		return created || left.key.localeCompare(right.key);
	});
}
