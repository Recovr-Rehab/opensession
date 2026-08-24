/**
 * Persisted measured heights for transcript blocks — the "pretext" that lets a
 * reopened chat start at its true size instead of an outline guess.
 *
 * On open, the virtualizer seeds every block from `lib/transcript-index.ts`
 * heuristics and corrects them as rows mount and measure. Each correction
 * moves content, so a transcript whose estimates are wrong visibly shifts
 * while it settles. Blocks of settled history never change height between
 * visits, so recording what they actually measured last time and feeding those
 * numbers back as the next visit's first estimate removes nearly all of that
 * correction on reopen.
 *
 * Sizes are stored per session AND per width bucket: the same block reflows
 * between phone width and desktop width, so a height measured at one is wrong
 * at the other. Wrong seeds are not dangerous — measurement still corrects
 * them exactly like a heuristic would — but storing both buckets keeps the
 * common case accurate.
 *
 * Everything here degrades to no-ops without `localStorage` (tests, private
 * modes): callers then simply run on heuristics as before.
 */

import { PHONE_QUERY } from "./breakpoints";

// Whole sessions kept per bucket. Oldest-written sessions fall out first; a
// session visited again refreshes its recency.
const MAX_SESSIONS = 24;
// Rows kept within one session's bucket. Long transcripts cap here rather than
// letting one giant session evict every other cache.
const MAX_ROWS_PER_SESSION = 8_000;

const STORAGE_KEY = "opensession.transcript-sizes.v1";

export type TranscriptWidthBucket = "narrow" | "wide";

export type TranscriptSizes = Record<string, number>;

// The slice of `Storage` the cache needs, so tests can pass a minimal stub.
type SizeStorage = Pick<Storage, "getItem" | "setItem">;

interface StoredBucketEntry {
	savedAt?: number;
	// Monotonic write counter: Date.now() can tie within one millisecond, and
	// eviction needs a deterministic newest-first order even then.
	seq?: number;
	sizes?: TranscriptSizes;
}

// Process-lifetime write counter backing the seq field above.
let writeSeq = 0;

interface StoredSession {
	narrow?: StoredBucketEntry;
	wide?: StoredBucketEntry;
}

interface StoredShape {
	sessions?: Record<string, StoredSession>;
}

function defaultStorage(): SizeStorage | undefined {
	try {
		return typeof localStorage === "undefined" ? undefined : localStorage;
	} catch {
		return undefined;
	}
}

/** The width bucket to store sizes under for this viewport. */
export function transcriptWidthBucket(phone: boolean): TranscriptWidthBucket {
	return phone ? "narrow" : "wide";
}

/** The bucket for the current viewport; wide when there is no window to ask. */
export function currentTranscriptWidthBucket(): TranscriptWidthBucket {
	try {
		return transcriptWidthBucket(
			typeof matchMedia === "undefined"
				? false
				: matchMedia(PHONE_QUERY).matches,
		);
	} catch {
		return "wide";
	}
}

/**
 * Measured heights recorded on a previous visit of `sessionId`, or undefined
 * when nothing useful is stored.
 */
export function loadTranscriptSizes(
	sessionId: string,
	bucket: TranscriptWidthBucket,
	storage: SizeStorage | undefined = defaultStorage(),
): TranscriptSizes | undefined {
	if (!storage || !sessionId) return undefined;
	let raw: string | null | undefined;
	try {
		raw = storage.getItem(STORAGE_KEY);
	} catch {
		return undefined;
	}
	if (!raw) return undefined;
	let parsed: StoredShape;
	try {
		parsed = JSON.parse(raw) as StoredShape;
	} catch {
		return undefined;
	}
	const sizes = parsed.sessions?.[sessionId]?.[bucket]?.sizes;
	if (!sizes || Object.keys(sizes).length === 0) return undefined;
	return sizes;
}

/**
 * Record measured heights for one session visit. Merges over whatever the last
 * visit stored (blocks absent from this visit keep their old number), refreshes
 * the session's recency, and prunes oldest sessions / excess rows.
 */
export function saveTranscriptSizes(
	sessionId: string,
	bucket: TranscriptWidthBucket,
	measured: ReadonlyMap<string, number>,
	storage: SizeStorage | undefined = defaultStorage(),
): void {
	if (!storage || !sessionId || measured.size === 0) return;
	const narrow = bucket === "narrow";
	let root: StoredShape = {};
	try {
		const raw = storage.getItem(STORAGE_KEY);
		root = raw ? (JSON.parse(raw) as StoredShape) : {};
		if (typeof root !== "object" || root === null) root = {};
	} catch {
		root = {};
	}
	const sessions = (root.sessions ??= {});
	const stored = (sessions[sessionId] ??= {});
	// Re-insert existing rows so insertion order doubles as recency within the
	// session: merged-over keys move to the end with their new value.
	const previous = stored[narrow ? "narrow" : "wide"]?.sizes ?? {};
	const merged: TranscriptSizes = { ...previous };
	for (const [key, size] of measured) {
		delete merged[key];
		if (Number.isFinite(size) && size > 0) merged[key] = Math.round(size);
	}
	const keys = Object.keys(merged);
	const overflow = keys.length - MAX_ROWS_PER_SESSION;
	if (overflow > 0) {
		for (let index = 0; index < overflow; index++) delete merged[keys[index]!];
	}
	stored[narrow ? "narrow" : "wide"] = {
		savedAt: Date.now(),
		seq: ++writeSeq,
		sizes: merged,
	};

	// Prune whole sessions beyond the cap, oldest savedAt first.
	const ids = Object.keys(sessions);
	if (ids.length > MAX_SESSIONS) {
		ids
			.sort((a, b) => bucketRecency(sessions[a]) - bucketRecency(sessions[b]))
			.slice(0, ids.length - MAX_SESSIONS)
			.forEach((id) => delete sessions[id]);
	}
	try {
		storage.setItem(STORAGE_KEY, JSON.stringify({ sessions }));
	} catch {
		// Quota or privacy failure: caching heights is best-effort.
	}
}

/** Recency of a whole session: its newest width-bucket write. */
function bucketRecency(session?: StoredSession): number {
	const narrow = session?.narrow;
	const wide = session?.wide;
	return Math.max(
		recencyOf(narrow),
		recencyOf(wide),
	);
}

function recencyOf(entry?: StoredBucketEntry): number {
	if (!entry) return 0;
	return Math.max(entry.savedAt ?? 0, 0) * 1_000 + (entry.seq ?? 0);
}

/**
 * The virtualizer's first-guess height for a block: the height it really
 * measured on the last visit when we have one, otherwise the outline
 * heuristic. A seed only stands in until measurement replaces it, so a stale
 * seed behaves exactly like a stale heuristic.
 */
export function seededBlockEstimate(
	heuristic: number,
	seeded: TranscriptSizes | undefined,
	blockKey: string,
): number {
	const cached = seeded?.[blockKey];
	return typeof cached === "number" && cached > 0 ? cached : heuristic;
}
