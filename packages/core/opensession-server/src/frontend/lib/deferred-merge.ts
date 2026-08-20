export const MERGE_UNDO_DELAY_MS = 5000;

export type DeferredMergePhase = "idle" | "scheduled" | "running";

export type DeferredMergeHandle = {
	key: string;
	token: number;
};

type DeferredMergeEntry = {
	token: number;
	phase: Exclude<DeferredMergePhase, "idle">;
	timer: ReturnType<typeof setTimeout> | null;
	run: () => Promise<unknown> | unknown;
};

const entries = new Map<string, DeferredMergeEntry>();
const listeners = new Set<() => void>();
let nextToken = 1;
let version = 0;

function emit() {
	version++;
	for (const listener of listeners) listener();
}

export function subscribeDeferredMerges(listener: () => void) {
	listeners.add(listener);
	return () => listeners.delete(listener);
}

export function deferredMergesVersion() {
	return version;
}

/** The PR URL is shared by the session strip, review panel and preview routes. */
export function deferredMergeKey(prUrl: string | null | undefined): string | null {
	if (!prUrl) return null;
	try {
		const url = new URL(prUrl);
		url.hash = "";
		url.search = "";
		url.pathname = url.pathname.replace(/\/+$/, "");
		return `pr:${url.toString()}`;
	} catch {
		return `pr:${prUrl.replace(/[?#].*$/, "").replace(/\/+$/, "")}`;
	}
}

export function deferredMergePhase(key: string | null): DeferredMergePhase {
	if (!key) return "idle";
	return entries.get(key)?.phase ?? "idle";
}

/**
 * Hold one merge per PR for an undo window. State stays module-level so a
 * scheduled merge survives navigation and every mounted surface sees it.
 */
export function scheduleDeferredMerge(
	key: string,
	run: () => Promise<unknown> | unknown,
	delayMs = MERGE_UNDO_DELAY_MS,
): DeferredMergeHandle | null {
	if (entries.has(key)) return null;

	const token = nextToken++;
	const entry: DeferredMergeEntry = {
		token,
		phase: "scheduled",
		timer: null,
		run,
	};
	entry.timer = setTimeout(() => {
		if (entries.get(key) !== entry) return;
		entry.phase = "running";
		emit();
		void Promise.resolve()
			.then(entry.run)
			.catch(() => undefined)
			.finally(() => {
				if (entries.get(key) !== entry) return;
				entries.delete(key);
				emit();
			});
	}, delayMs);
	entries.set(key, entry);
	emit();
	return { key, token };
}

/** Undo only the exact schedule that created the visible toast. */
export function cancelDeferredMerge(handle: DeferredMergeHandle): boolean {
	const entry = entries.get(handle.key);
	if (
		!entry ||
		entry.token !== handle.token ||
		entry.phase !== "scheduled"
	)
		return false;
	if (entry.timer) clearTimeout(entry.timer);
	entries.delete(handle.key);
	emit();
	return true;
}
