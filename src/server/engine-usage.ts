/**
 * Engine usage: tokens and cost per day, read from the engines' own message
 * stores rather than from our audit log.
 *
 * Why not the audit log. It records one `result` event per TURN, but a turn is
 * one model request per tool round, and the sub-sessions a turn spawns (task
 * tool, oracles) never surface as turns at all. Even with per-turn usage summed
 * correctly (see buildTurnResultEvents), the audit log cannot see the requests
 * that belong to no turn of ours, and everything it recorded before 2026-08-14
 * kept only each turn's LAST request. Measured over 30 days to 2026-08-14, the
 * audit-derived figures read 2.5B tokens and $2.8K against a true 78B and $86K.
 *
 * The source here is the per-session opencode shard DBs under
 * ~/.opensession-sessions/opencode/db/*.db (plus the shared-pool servers' own
 * DBs in the same directory). Each assistant row in `message` is exactly one
 * model request, with its own token counts, so summing them is the real number
 * for both providers. Cross-checked against the Claude Agent SDK transcripts in
 * ~/.opensession-opencode/meridian-cfg (an entirely separate record, one line
 * per API request): the two agree to within 10% on Anthropic, the shard DBs
 * reading slightly low because a deleted session takes its DB with it.
 *
 * Cost is an API LIST-PRICE EQUIVALENT, not spend. Every model here runs on a
 * subscription pool, so nothing is billed per token; this is what the same
 * traffic would have cost on the API, which is the only comparable figure. The
 * engine's own `cost` field is deliberately ignored: it reports 0 for the
 * OpenAI pool, which silently erased the single largest line.
 *
 * Rates come from opencode's model catalog (~/.cache/opencode/models.json),
 * which was independently confirmed by fitting cost against tokens over 30k
 * priced messages at 0.0000% error. One deviation: Anthropic cache writes are
 * priced at 2x base input, not the catalog's 1.25x, because every cache write
 * we make carries the 1-hour TTL (verified from the SDK transcripts, which
 * split ephemeral_1h from ephemeral_5m: 2.58B tokens to 1h, zero to 5m).
 *
 * Retention. opencode prunes the shard DBs, which held ~30 days when this was
 * written. A day older than the store's earliest row is therefore not zero
 * usage, it is NO DATA, and the two must never render the same way: a 90-day
 * range would otherwise draw 60 days of flat zero and read as "we started in
 * July". Such a day is marked `unmeasured` and the UI says so. The per-day
 * cache below is what makes history outlive the source, so a day measured once
 * stays measured: it is the durable record, and the prewarm is what keeps it
 * ahead of the pruning.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { Database } from "bun:sqlite";
import { homedir } from "node:os";
import { OPENSESSION_SESSIONS_DIR, stateDir } from "./paths";

const SHARD_DIR = `${OPENSESSION_SESSIONS_DIR}/opencode/db`;

export interface ModelUsage {
	provider: string;
	model: string;
	/** Model requests, i.e. assistant messages. Not turns. */
	requests: number;
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	costUsd: number;
}

export interface EngineUsageDay {
	date: string;
	byModel: ModelUsage[];
	requests: number;
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	totalTokens: number;
	costUsd: number;
	/** Requests on a model with no catalog price, excluded from costUsd. */
	unpricedRequests: number;
	/** The day predates the store's earliest row, so its zeros mean "no data
	 *  kept this far back", not "nothing ran". Never chart it as zero. */
	unmeasured: boolean;
}

// ── Rates ──

interface Rate {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
}

/** Anthropic's 1-hour cache TTL bills at 2x base input; the catalog carries
 *  the 5-minute rate (1.25x). Every write we make is 1-hour. */
const ANTHROPIC_CACHE_WRITE_MULTIPLE = 2;

let rateCache: { at: number; rates: Map<string, Rate> } | null = null;

function catalogPath(): string {
	return process.env.OPENCODE_MODELS_JSON || `${homedir()}/.cache/opencode/models.json`;
}

/** provider+model → per-million-token rates, from opencode's catalog. */
export function loadRates(): Map<string, Rate> {
	if (rateCache && Date.now() - rateCache.at < 3_600_000) return rateCache.rates;
	const rates = new Map<string, Rate>();
	try {
		const raw = JSON.parse(readFileSync(catalogPath(), "utf-8")) as Record<string, unknown>;
		for (const [providerId, provider] of Object.entries(raw)) {
			const models = (provider as { models?: Record<string, { cost?: Record<string, number> }> })?.models;
			if (!models) continue;
			for (const [modelId, model] of Object.entries(models)) {
				const cost = model?.cost;
				if (!cost || typeof cost.input !== "number") continue;
				const input = cost.input;
				const cacheWrite =
					providerId === "anthropic"
						? input * ANTHROPIC_CACHE_WRITE_MULTIPLE
						: (cost.cache_write ?? input * 1.25);
				rates.set(`${providerId}|${modelId}`, {
					input,
					output: cost.output ?? 0,
					cacheRead: cost.cache_read ?? 0,
					cacheWrite,
				});
			}
		}
	} catch (e) {
		console.error("[engine-usage] model catalog read failed:", e);
	}
	rateCache = { at: Date.now(), rates };
	return rates;
}

/** Drop the memoized catalog. Tests point OPENCODE_MODELS_JSON at a fixture. */
export function resetRatesForTest(): void {
	rateCache = null;
}

// ── Scan ──

interface Bucket {
	requests: number;
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
}

function emptyBucket(): Bucket {
	return { requests: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
}

function utcDate(ms: number): string {
	return new Date(ms).toISOString().slice(0, 10);
}

export interface EngineUsageScan {
	days: Map<string, Map<string, Bucket>>;
	/** UTC date of the store's earliest surviving message, or null if empty.
	 *  Anything before it has been pruned, so it is unmeasured rather than 0. */
	earliest: string | null;
}

/**
 * Scan every shard DB for assistant messages at or after `fromDate`, bucketed
 * by UTC day and provider+model, and report how far back the store still goes.
 *
 * Yields to the event loop between databases: a full scan is ~4k files and
 * about a minute of CPU, and the server serves HTTP throughout.
 */
export async function scanEngineUsage(fromDate: string): Promise<EngineUsageScan> {
	const days = new Map<string, Map<string, Bucket>>();
	let earliestMs = Number.POSITIVE_INFINITY;
	const cutoff = Date.parse(`${fromDate}T00:00:00Z`);
	if (!Number.isFinite(cutoff)) return { days, earliest: null };
	let files: string[];
	try {
		files = readdirSync(SHARD_DIR).filter((f) => f.endsWith(".db"));
	} catch (e) {
		console.error("[engine-usage] shard dir unreadable:", e);
		return { days, earliest: null };
	}
	let scanned = 0;
	for (const file of files) {
		const path = `${SHARD_DIR}/${file}`;
		// A DB last written before the cutoff cannot hold rows after it.
		try {
			if (statSync(path).mtimeMs < cutoff) continue;
		} catch {
			continue;
		}
		let db: Database | undefined;
		try {
			db = new Database(path, { readonly: true });
			// How far back the store still reaches. A DB skipped above cannot
			// lower this into the requested range: every row in it predates the
			// cutoff, which is the range's own start.
			const first = db.query<{ t: number | null }, []>("select min(time_created) t from message").get();
			if (first?.t) earliestMs = Math.min(earliestMs, first.t);
			const rows = db
				.query<{ time_created: number; data: string }, [number]>(
					"select time_created, data from message where time_created >= ?",
				)
				.all(cutoff);
			for (const row of rows) {
				let d: Record<string, any>;
				try {
					d = JSON.parse(row.data);
				} catch {
					continue;
				}
				if (d.role !== "assistant") continue;
				const tokens = d.tokens || {};
				const cache = tokens.cache || {};
				const provider = String(d.providerID || d.model?.providerID || "?");
				const model = String(d.modelID || d.model?.modelID || "?").split("/").pop() || "?";
				const date = utcDate(row.time_created);
				let byModel = days.get(date);
				if (!byModel) days.set(date, (byModel = new Map()));
				const key = `${provider}|${model}`;
				let b = byModel.get(key);
				if (!b) byModel.set(key, (b = emptyBucket()));
				b.requests++;
				b.input += tokens.input || 0;
				b.output += tokens.output || 0;
				b.cacheRead += cache.read || 0;
				b.cacheWrite += cache.write || 0;
			}
		} catch {
			// A shard mid-write or half-deleted is skipped, not fatal.
		} finally {
			try {
				db?.close();
			} catch {}
		}
		if (++scanned % 25 === 0) await new Promise((r) => setTimeout(r, 0));
	}
	return { days, earliest: Number.isFinite(earliestMs) ? utcDate(earliestMs) : null };
}

/** Price one day's buckets. */
export function priceDay(date: string, byModel: Map<string, Bucket>, unmeasured = false): EngineUsageDay {
	const rates = loadRates();
	const day: EngineUsageDay = {
		date,
		byModel: [],
		requests: 0,
		input: 0,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
		totalTokens: 0,
		costUsd: 0,
		unpricedRequests: 0,
		unmeasured,
	};
	for (const [key, b] of byModel) {
		const [provider, model] = key.split("|");
		const rate = rates.get(key);
		const costUsd = rate
			? (b.input * rate.input +
					b.output * rate.output +
					b.cacheRead * rate.cacheRead +
					b.cacheWrite * rate.cacheWrite) /
				1_000_000
			: 0;
		if (!rate) day.unpricedRequests += b.requests;
		day.byModel.push({ provider, model, ...b, costUsd });
		day.requests += b.requests;
		day.input += b.input;
		day.output += b.output;
		day.cacheRead += b.cacheRead;
		day.cacheWrite += b.cacheWrite;
		day.costUsd += costUsd;
	}
	day.totalTokens = day.input + day.output + day.cacheRead + day.cacheWrite;
	day.byModel.sort((a, b) => b.costUsd - a.costUsd || b.requests - a.requests);
	return day;
}

export function emptyEngineUsageDay(date: string): EngineUsageDay {
	return priceDay(date, new Map());
}

// ── Per-day cache ──
//
// Same shape as the analytics day rollups: a past day is final and cached
// forever, today is recomputed. One scan fills every day it covers, so a cold
// range costs one pass rather than one per day.

// 2: days before the store's earliest row carry `unmeasured` instead of zeros.
const CACHE_VERSION = 2;

// Reuse the analytics cache directory so both rollups age together.
const stateCacheDir = () => stateDir("analytics-cache");

function cachePath(date: string): string {
	return `${stateCacheDir()}/engine-day-${date}.json`;
}

function readDay(date: string): EngineUsageDay | null {
	try {
		const p = cachePath(date);
		if (!existsSync(p)) return null;
		const parsed = JSON.parse(readFileSync(p, "utf-8"));
		if (parsed?.v !== CACHE_VERSION) return null;
		return parsed.day as EngineUsageDay;
	} catch {
		return null;
	}
}

function writeDay(day: EngineUsageDay): void {
	try {
		mkdirSync(stateCacheDir(), { recursive: true });
		writeFileSync(cachePath(day.date), JSON.stringify({ v: CACHE_VERSION, day }));
	} catch (e) {
		console.error("[engine-usage] day cache write failed:", e);
	}
}

let inflight: Promise<void> | null = null;

/**
 * Usage for each of `dates`, cached per day. Today is always rescanned; a past
 * day is served from cache when present. Concurrent callers share one scan.
 */
export async function engineUsageForDates(dates: string[]): Promise<Map<string, EngineUsageDay>> {
	const today = new Date().toISOString().slice(0, 10);
	const out = new Map<string, EngineUsageDay>();
	const missing: string[] = [];
	for (const date of dates) {
		const cached = date < today ? readDay(date) : null;
		if (cached) out.set(date, cached);
		else missing.push(date);
	}
	if (!missing.length) return out;

	// One scan from the earliest missing day fills all of them.
	const from = missing.reduce((a, b) => (a < b ? a : b));
	while (inflight) await inflight;
	let resolveInflight!: () => void;
	inflight = new Promise<void>((r) => (resolveInflight = r));
	try {
		// Re-check: a concurrent scan may have filled these while we waited.
		const stillMissing = missing.filter((d) => d >= today || !readDay(d));
		if (stillMissing.length) {
			const { days: scanned, earliest } = await scanEngineUsage(from);
			for (const date of missing) {
				// Before the store's horizon there is nothing left to read, so
				// the day is unmeasured rather than zero. Cached as such: the
				// pruned rows are never coming back.
				const unmeasured = !!earliest && date < earliest;
				const day = priceDay(date, scanned.get(date) ?? new Map(), unmeasured);
				if (date < today) writeDay(day);
				out.set(date, day);
			}
		} else {
			for (const date of missing) out.set(date, readDay(date) ?? emptyEngineUsageDay(date));
		}
	} finally {
		resolveInflight();
		inflight = null;
	}
	for (const date of dates) if (!out.has(date)) out.set(date, emptyEngineUsageDay(date));
	return out;
}
