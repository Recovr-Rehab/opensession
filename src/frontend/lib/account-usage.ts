/**
 * Reading an account's usage down to the one number that decides anything.
 *
 * A Claude account reports three or four limits (a 5-hour window, a 7-day
 * window, and a per-model weekly cap the provider names, today "Fable"); a
 * Codex account reports one per model bucket. Only the fullest of them decides
 * whether a run can start, so the accounts list shows that one and keeps the
 * rest in its tooltip.
 */

export interface UsageWindow {
	utilization: number | null;
	resetsAt: string | null;
}

/** One limit an account runs against, named for how it reads in the list. */
export interface LimitWindow extends UsageWindow {
	label: string;
	/** A per-model cap rather than an account-wide window. Wins a tie, because
	 *  a spent one sidelines the account for that model specifically. */
	scoped?: boolean;
}

/** The shape of `usage` the Claude accounts route returns. */
export interface ClaudeUsageLimits {
	fiveHour: UsageWindow | null;
	sevenDay: UsageWindow | null;
	scopedLimits?: { label: string; utilization: number | null; resetsAt: string | null }[];
}

const EMPTY: UsageWindow = { utilization: null, resetsAt: null };

/**
 * Mirrors the server's own read (`currentUtilization` in claude-accounts.ts):
 * a window whose reset has already passed is provably stale, so it counts as
 * empty instead of pinning a just-reset account at 100% until the next poll.
 */
export function liveUtilization(w: LimitWindow, now = Date.now()): number | null {
	if (w.utilization === null) return null;
	if (w.resetsAt) {
		const t = Date.parse(w.resetsAt);
		if (Number.isFinite(t) && t <= now) return 0;
	}
	return w.utilization;
}

/**
 * The fullest window: the one an account is up against. Windows it reports no
 * number for are skipped rather than read as empty. "Unknown" and "nothing
 * used" are different states, and a token that can't see usage at all has no
 * binding limit to show.
 */
export function bindingLimit(windows: LimitWindow[], now = Date.now()): LimitWindow | null {
	let binding: LimitWindow | null = null;
	let fullest = -1;
	for (const w of windows) {
		const pct = liveUtilization(w, now);
		if (pct === null) continue;
		if (pct > fullest || (pct === fullest && w.scoped && !binding?.scoped)) {
			binding = { ...w, utilization: pct };
			fullest = pct;
		}
	}
	return binding;
}

/** Every limit a Claude account reports: the two rolling windows, plus the
 *  per-model weekly caps the `limits` array carries separately. */
export function claudeLimits(usage: ClaudeUsageLimits | null | undefined): LimitWindow[] {
	if (!usage) return [];
	return [
		{ label: "5h", ...(usage.fiveHour ?? EMPTY) },
		{ label: "7d", ...(usage.sevenDay ?? EMPTY) },
		...(usage.scopedLimits ?? []).map((s) => ({ ...s, scoped: true })),
	];
}
