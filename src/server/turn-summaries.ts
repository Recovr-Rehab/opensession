/**
 * Short "what was happening here" titles for each transcript landmark — what
 * the minimap rail shows when you hover a tick.
 *
 * The rail never waits on this. Every landmark already carries a derived label
 * (its first line, or the tools it ran) that renders instantly; these titles
 * are enrichment that swaps in when it arrives. So everything here is
 * fail-soft: a null one-shot, a missing bridge or a disk error leaves a rail
 * that still works.
 *
 * Shape, and why it differs from generated-titles.ts (the nearest precedent):
 *  - One file per session, not one global registry. A registry holds one
 *    string per session; this holds one per landmark, and rewriting a
 *    thousand-session map on every batch would be absurd.
 *  - Generated only for sessions someone actually opened, through a single
 *    serial queue. There is deliberately NO back-fill sweep: a title in the
 *    sidebar matters for every session, a hover card only matters for the
 *    session in front of you, and sweeping 5000 sessions × N landmarks through
 *    a shared one-shot server would starve the path titles and classifiers use.
 *  - Keyed by landmark id, which is stable: transcripts are append-only, so a
 *    new turn never invalidates an old landmark's summary, and a fork mints a
 *    new session id that starts empty.
 */
import { existsSync, mkdirSync, readFileSync, statSync } from "fs";
import { writeJsonAtomic } from "./shared/atomic-write";
import { OPENSESSION_CHATS_DIR } from "./paths";
import { opencodeOneShot } from "./opencode-oneshot";
import {
	landmarkDigest,
	type TranscriptLandmark,
} from "../shared/transcript-landmarks";

const DIR = `${OPENSESSION_CHATS_DIR}/turn-summaries`;

/** Landmarks per one-shot call. One-shots are ~10-16s and serialize on the
 *  shared server, so per-landmark calls would monopolize it for a long
 *  session; 20 digests is a small prompt and one round trip. */
const BATCH = 20;
/** Batches per request, so opening a 300-landmark session enqueues bounded
 *  work and the next open continues where this one stopped. */
const MAX_BATCHES_PER_PASS = 3;
/** A session whose generation failed waits this long before trying again,
 *  instead of re-firing on every poll. */
const RETRY_AFTER_MS = 10 * 60 * 1000;

interface Store {
	v: 1;
	titles: Record<string, string>;
	failedAt?: number;
}

function pathFor(sessionId: string): string {
	return `${DIR}/${sessionId}.json`;
}

/* ------------------------------------------------------------------ *
 * Disk
 * ------------------------------------------------------------------ */

const cache = new Map<string, { store: Store; mtimeMs: number }>();

function load(sessionId: string): Store {
	const file = pathFor(sessionId);
	let mtimeMs = 0;
	try {
		mtimeMs = existsSync(file) ? statSync(file).mtimeMs : 0;
	} catch {}
	const hit = cache.get(sessionId);
	if (hit && hit.mtimeMs === mtimeMs) return hit.store;
	let store: Store = { v: 1, titles: {} };
	if (mtimeMs) {
		try {
			const parsed = JSON.parse(readFileSync(file, "utf-8"));
			if (parsed && typeof parsed === "object" && parsed.titles)
				store = { v: 1, titles: parsed.titles, failedAt: parsed.failedAt };
		} catch {}
	}
	cache.set(sessionId, { store, mtimeMs });
	return store;
}

/** Merge over what is on disk right now: a restart overlaps two processes, and
 *  the outgoing one may land a batch after we last read. */
function merge(sessionId: string, patch: Partial<Store> & { titles?: Record<string, string> }): void {
	let onDisk: Store = { v: 1, titles: {} };
	try {
		if (existsSync(pathFor(sessionId))) {
			const parsed = JSON.parse(readFileSync(pathFor(sessionId), "utf-8"));
			if (parsed?.titles) onDisk = { v: 1, titles: parsed.titles, failedAt: parsed.failedAt };
		}
	} catch {}
	const next: Store = {
		v: 1,
		titles: { ...onDisk.titles, ...load(sessionId).titles, ...(patch.titles ?? {}) },
		failedAt: "failedAt" in patch ? patch.failedAt : onDisk.failedAt,
	};
	try {
		mkdirSync(DIR, { recursive: true });
		writeJsonAtomic(pathFor(sessionId), next);
		cache.set(sessionId, {
			store: next,
			mtimeMs: statSync(pathFor(sessionId)).mtimeMs,
		});
	} catch (e) {
		// A caller that only voids this promise would surface a full disk as an
		// unhandled rejection; a missing hover title is not worth that.
		console.warn(`[turn-summaries] could not persist ${sessionId}:`, e);
		cache.set(sessionId, { store: next, mtimeMs: 0 });
	}
}

/** Generated titles for a session, keyed by landmark id. */
export function getTurnSummaries(sessionId: string): Record<string, string> {
	return load(sessionId).titles;
}

/** Drop a session's summaries — called when its transcript is deleted. */
export function clearTurnSummaries(sessionId: string): void {
	cache.delete(sessionId);
	try {
		if (existsSync(pathFor(sessionId))) writeJsonAtomic(pathFor(sessionId), { v: 1, titles: {} });
	} catch {}
}

/* ------------------------------------------------------------------ *
 * Generation
 * ------------------------------------------------------------------ */

const PROMPT_HEAD = `You are labelling steps of an AI coding agent's session so a developer can scan them in a navigation rail.

For EACH numbered item below, write a title of 3 to 7 words naming what happened at that step — the specific thing, not the category. Prefer concrete nouns from the item ("Trace the latch controller", "Fix flaky upload test", "Explain the retry budget"). Sentence case, no trailing punctuation, no quotes, no markdown, no numbering inside the title itself.

Reply with one line per item, in order, formatted exactly as:
<number>. <title>

Output nothing else — no preamble, no blank lines, no commentary. Reply with exactly as many lines as there are items.`;

/** Trim a model line into a usable title, or "" to keep the derived label. */
function sanitize(raw: string): string {
	const line = raw
		.trim()
		.replace(/^\s*\d+\s*[.)\]:-]\s*/, "") // strip the "3. " the format asks for
		.replace(/^["'`]+|["'`]+$/g, "")
		.replace(/\s+/g, " ")
		.trim();
	// The model occasionally comments instead of naming ("This step seems to
	// be..."), which a blind slice would bake in. Reject prose the same way
	// generated-titles does: too long, an internal sentence break, or a
	// first-person/deictic opener no title has.
	if (
		!line ||
		line.split(" ").length > 10 ||
		/\.\s/.test(line) ||
		/^(i|i'm|this|that|there|sorry|it|the agent|the user)\b/i.test(line)
	)
		return "";
	return line.replace(/[.\s]+$/g, "").slice(0, 70).trim();
}

/** Parse "1. Title" lines back onto the batch, tolerating a short reply. */
function parseBatch(out: string, batch: TranscriptLandmark[]): Record<string, string> {
	const titles: Record<string, string> = {};
	// Numbered lines, not JSON: a miscounted array poisons the whole batch,
	// while numbered lines parse partially and we keep whatever matched.
	for (const line of out.split("\n")) {
		const m = /^\s*(\d+)\s*[.)\]:-]\s*(.+)$/.exec(line);
		if (!m) continue;
		const index = Number(m[1]) - 1;
		const landmark = batch[index];
		if (!landmark) continue;
		const title = sanitize(m[2]);
		if (title) titles[landmark.id] = title;
	}
	return titles;
}

async function generateBatch(
	batch: TranscriptLandmark[],
	user?: string,
): Promise<Record<string, string> | null> {
	const items = batch.map((l, i) => `${i + 1}. ${landmarkDigest(l)}`).join("\n");
	const out = await opencodeOneShot(`${PROMPT_HEAD}\n\nItems:\n${items}`, {
		user,
		label: "turn-summaries",
	});
	if (!out) return null;
	return parseBatch(out, batch);
}

/* -- queue ---------------------------------------------------------- *
 * One serial queue for the whole process. One-shots already serialize on the
 * shared server, so running these concurrently would only interleave them
 * with (and delay) session titles and intent classifiers. Parking them behind
 * one queue also makes a thundering herd structurally impossible: N sessions
 * opening at once enqueue N jobs that drain politely.
 */
let queue: Promise<unknown> = Promise.resolve();
const inFlight = new Set<string>();

/**
 * Fill in missing titles for a session's landmarks, newest-first.
 *
 * Fire-and-forget: callers `void` this. Returns when the session's queued pass
 * has finished (used by tests).
 */
export function ensureTurnSummaries(
	sessionId: string,
	landmarks: TranscriptLandmark[],
	user?: string,
): Promise<void> {
	if (inFlight.has(sessionId)) return Promise.resolve();

	const store = load(sessionId);
	if (store.failedAt && Date.now() - store.failedAt < RETRY_AFTER_MS)
		return Promise.resolve();

	const missing = landmarks.filter((l) => !store.titles[l.id]);
	if (missing.length === 0) return Promise.resolve();

	inFlight.add(sessionId);
	const job = queue
		.catch(() => {})
		.then(async () => {
			// Newest first: the reader is at the bottom of the transcript, so
			// those are the ticks they'll hover before the pass finishes.
			const pending = [...missing].reverse();
			let failed = false;
			let filled = 0;
			for (let b = 0; b < MAX_BATCHES_PER_PASS && pending.length > 0; b++) {
				const batch = pending.splice(0, BATCH);
				let titles: Record<string, string> | null = null;
				try {
					titles = await generateBatch(batch, user);
				} catch {
					titles = null;
				}
				if (!titles) {
					failed = true;
					break;
				}
				const count = Object.keys(titles).length;
				if (count > 0) {
					merge(sessionId, { titles, failedAt: undefined });
					filled += count;
				}
			}
			// Only a hard failure (no usable reply at all) arms the backoff — a
			// partial batch still made progress and should be retried on the
			// next open.
			if (failed && filled === 0) merge(sessionId, { failedAt: Date.now() });
		})
		.finally(() => {
			inFlight.delete(sessionId);
		});
	queue = job;
	return job;
}

/** True while a session's pass is running, so the UI knows to poll again. */
export function turnSummariesPending(sessionId: string): boolean {
	return inFlight.has(sessionId);
}
