#!/usr/bin/env bun
/**
 * Prompt-cache hit rate per engine, per bridge, and per server pool.
 *
 *   bun scripts/cache-report.ts                 # last 7 days
 *   bun scripts/cache-report.ts --days 30
 *   bun scripts/cache-report.ts --json
 *   bun scripts/cache-report.ts --sessions 15   # worst sessions by wasted input
 *
 * The number this answers: of the prompt tokens we send, what fraction did the
 * provider serve from its cache rather than bill as fresh input —
 *
 *     hit rate = cacheRead / (cacheRead + uncachedInput)
 *
 * Sources are the engines' own message stores, the same ones engine-usage.ts
 * reads and for the same reason: the audit log records one `result` event per
 * TURN, but a turn is one model request per tool round, so it cannot see the
 * requests a cache either served or missed. `tokens.input` in the opencode
 * shard rows EXCLUDES the cached part (verified: `total` = input + output +
 * reasoning + cache.read + cache.write), so the ratio above is well formed for
 * both providers.
 *
 * READ THE WRITE COLUMN, NOT ONLY THE HIT RATE. The two providers bill a
 * broken prefix differently, and the hit rate alone under-detects it on one of
 * them. Anthropic reports prompt tokens in three buckets — read from cache,
 * WRITTEN to cache, and uncached — so a prefix that changed is re-cached and
 * lands in cache_creation rather than in input: the hit rate barely moves while
 * the bill roughly doubles for those tokens (a 1-hour write costs 2x base
 * input). OpenAI has no write bucket, so the same breakage does show up as
 * uncached input. `read/req` and `write/req` are therefore the honest signal on
 * both: a warm request that re-reads a full context and writes a small delta is
 * healthy, and one that reads little and writes a whole context is churning its
 * prefix, whatever the hit rate says.
 *
 * THE POOL SPLIT is the point of this script rather than a detail. Eligible
 * interactive runs multiplex onto a SHARED always-warm `opencode serve` per
 * (bridge account × user), and everything per-run rides the prompt body there —
 * including `system`, which carries the whole session-context block that a
 * per-session server delivers once in its config instead (see the "Server
 * lifecycle" note in opencode-runner.ts). A per-turn `system` that is not
 * byte-stable would invalidate the provider's prefix cache on every turn, and
 * the two pools are the natural A/B: same models, same bridges, different
 * delivery channel for the same text. The shard DB filename is the
 * discriminator — `shardDbPathForKey` sanitizes the server key, so a shared
 * pool server's DB is `shared_<bridge>_<user>.db` and everything else is
 * per-session.
 *
 * TURN POSITION is the sharper instrument. Within one turn the system prompt
 * cannot change, so a tool-round request always re-reads what the round before
 * it wrote; a prefix that is unstable ACROSS turns shows up only on the first
 * request of each turn. Those are split out, and further split by how long
 * since that session's previous request: our cache writes carry the 1-hour TTL
 * (engine-usage.ts), so a first-of-turn request less than an hour behind its
 * predecessor SHOULD hit a warm prefix. A low hit rate confined to that bucket
 * is the signature of a per-turn prefix change; a low rate everywhere is
 * ordinary cold-start traffic.
 *
 * Caveats worth knowing before quoting a number. Turn position is computed from
 * the rows inside the window, so a session that straddles the start of the
 * range can have its first in-window request misread as first-of-turn (a small
 * effect at 7 days, smaller at 30). The direct engines are reported as totals
 * only: their stores are per-request transcripts with no pool and no cheap turn
 * boundary, so they get an engine-level rate and nothing finer.
 */

import { Database } from "bun:sqlite";
import { readdirSync, statSync } from "node:fs";
import { OPENSESSION_SESSIONS_DIR } from "../src/server/paths";
import { loadRates, scanClaudeDirect, scanCodexDirect, type EngineUsageScan } from "../src/server/engine-usage";

const SHARD_DIR = `${OPENSESSION_SESSIONS_DIR}/opencode/db`;

/** A first-of-turn request this far behind its predecessor should still find a
 *  warm prefix: every cache write we make carries the 1-hour TTL. */
const WARM_MS = 60 * 60_000;

interface Agg {
	requests: number;
	/** Uncached input, i.e. what the provider billed as fresh prompt. */
	input: number;
	cacheRead: number;
	cacheWrite: number;
	output: number;
	sessions: Set<string>;
}

function emptyAgg(): Agg {
	return { requests: 0, input: 0, cacheRead: 0, cacheWrite: 0, output: 0, sessions: new Set() };
}

function add(map: Map<string, Agg>, key: string, u: Omit<Agg, "sessions" | "requests">, session: string): void {
	let a = map.get(key);
	if (!a) map.set(key, (a = emptyAgg()));
	a.requests++;
	a.input += u.input;
	a.cacheRead += u.cacheRead;
	a.cacheWrite += u.cacheWrite;
	a.output += u.output;
	a.sessions.add(session);
}

function hitRate(a: { input: number; cacheRead: number }): number {
	const prompt = a.cacheRead + a.input;
	return prompt > 0 ? a.cacheRead / prompt : 0;
}

function pct(n: number): string {
	return `${(n * 100).toFixed(1)}%`;
}

function num(n: number): string {
	if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
	if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
	if (n >= 1e3) return `${(n / 1e3).toFixed(1)}k`;
	return String(Math.round(n));
}

function usd(n: number): string {
	return `$${n.toFixed(2)}`;
}

/** Pad/truncate to a fixed column width so the tables line up. */
function col(s: string, w: number, right = false): string {
	const t = s.length > w ? `${s.slice(0, w - 1)}…` : s;
	return right ? t.padStart(w) : t.padEnd(w);
}

// ── opencode shards ──

type Pool = "shared" | "per-session";

interface OpencodeScan {
	byPool: Map<Pool, Agg>;
	/** `${pool}|${provider}|${model}` */
	byModel: Map<string, Agg>;
	/** `${pool}|${provider}|${bucket}`, bucket = first-warm/first-cold/mid-turn. */
	byPosition: Map<string, Agg>;
	/** `${pool}|${provider}|${session}` → wasted uncached input on warm turns. */
	bySession: Map<string, Agg>;
	dbs: number;
	rows: number;
}

type Position = "first-warm" | "first-cold" | "mid-turn";

/**
 * Read every shard DB for assistant requests at or after `cutoff`.
 *
 * Rows come back ordered per session so turn position can be walked in one
 * pass: a `user` row opens a turn, the next assistant request is first-of-turn,
 * the rest are tool rounds.
 */
async function scanOpencode(cutoff: number): Promise<OpencodeScan> {
	const out: OpencodeScan = {
		byPool: new Map(),
		byModel: new Map(),
		byPosition: new Map(),
		bySession: new Map(),
		dbs: 0,
		rows: 0,
	};
	let files: string[];
	try {
		files = readdirSync(SHARD_DIR).filter((f) => f.endsWith(".db"));
	} catch (e) {
		console.error(`[cache-report] shard dir unreadable: ${e}`);
		return out;
	}
	let scanned = 0;
	for (const file of files) {
		const path = `${SHARD_DIR}/${file}`;
		try {
			if (statSync(path).mtimeMs < cutoff) continue;
		} catch {
			continue;
		}
		const pool: Pool = file.startsWith("shared_") ? "shared" : "per-session";
		let db: Database | undefined;
		try {
			db = new Database(path, { readonly: true });
			const rows = db
				.query<{ session_id: string; time_created: number; data: string }, [number]>(
					"select session_id, time_created, data from message where time_created >= ? order by session_id, time_created",
				)
				.all(cutoff);
			out.dbs++;
			// Per-session walk state, reset when the session_id changes.
			let session = "";
			let expectFirst = false;
			let prevAt = 0;
			for (const row of rows) {
				if (row.session_id !== session) {
					session = row.session_id;
					expectFirst = false;
					prevAt = 0;
				}
				let d: Record<string, any>;
				try {
					d = JSON.parse(row.data);
				} catch {
					continue;
				}
				if (d.role === "user") {
					expectFirst = true;
					continue;
				}
				if (d.role !== "assistant") continue;
				const tokens = d.tokens || {};
				const cache = tokens.cache || {};
				const u = {
					input: tokens.input || 0,
					cacheRead: cache.read || 0,
					cacheWrite: cache.write || 0,
					output: tokens.output || 0,
				};
				// An aborted or still-streaming message books no usage; counting
				// it would dilute every rate with requests that never happened.
				if (u.input <= 0 && u.cacheRead <= 0) continue;
				out.rows++;
				const provider = String(d.providerID || d.model?.providerID || "?");
				const model = String(d.modelID || d.model?.modelID || "?").split("/").pop() || "?";
				const position: Position = !expectFirst
					? "mid-turn"
					: prevAt > 0 && row.time_created - prevAt <= WARM_MS
						? "first-warm"
						: "first-cold";
				add(out.byPool, pool, u, session);
				add(out.byModel, `${pool}|${provider}|${model}`, u, session);
				add(out.byPosition, `${pool}|${provider}|${position}`, u, session);
				if (position === "first-warm") add(out.bySession, `${pool}|${provider}|${session}`, u, session);
				expectFirst = false;
				prevAt = row.time_created;
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
	return out;
}

// ── direct engines ──

/** Fold an engine-usage day scan (date → provider|model → bucket) into one
 *  aggregate per provider|model. Those scanners are the maintained readers for
 *  the direct engines' stores, replay dedupe and delta accounting included. */
function foldDays(days: EngineUsageScan["days"]): Map<string, Agg> {
	const out = new Map<string, Agg>();
	for (const byModel of days.values()) {
		for (const [key, b] of byModel) {
			let a = out.get(key);
			if (!a) out.set(key, (a = emptyAgg()));
			a.requests += b.requests;
			a.input += b.input;
			a.cacheRead += b.cacheRead;
			a.cacheWrite += b.cacheWrite;
			a.output += b.output;
		}
	}
	return out;
}

// ── report ──

function totals(aggs: Iterable<Agg>): Agg {
	const t = emptyAgg();
	for (const a of aggs) {
		t.requests += a.requests;
		t.input += a.input;
		t.cacheRead += a.cacheRead;
		t.cacheWrite += a.cacheWrite;
		t.output += a.output;
		for (const s of a.sessions) t.sessions.add(s);
	}
	return t;
}

/**
 * List-price headroom: what the uncached input cost, against what the same
 * tokens would have cost had they been served from cache. Not a saving anyone
 * can bank — every model here runs on subscription capacity — but it is the
 * only comparable way to size one pool's misses against another's.
 */
function headroomUsd(key: string, a: Agg): number {
	const rate = loadRates().get(key);
	if (!rate) return 0;
	return (a.input * (rate.input - rate.cacheRead)) / 1_000_000;
}

function poolTable(scan: OpencodeScan): string[] {
	const lines = [
		`${col("pool", 14)} ${col("requests", 10, true)} ${col("sessions", 9, true)} ${col("uncached in", 12, true)} ${col("cache read", 12, true)} ${col("cache write", 12, true)} ${col("hit rate", 9, true)}`,
	];
	for (const pool of ["shared", "per-session"] as Pool[]) {
		const a = scan.byPool.get(pool);
		if (!a) continue;
		lines.push(
			`${col(pool, 14)} ${col(num(a.requests), 10, true)} ${col(num(a.sessions.size), 9, true)} ${col(num(a.input), 12, true)} ${col(num(a.cacheRead), 12, true)} ${col(num(a.cacheWrite), 12, true)} ${col(pct(hitRate(a)), 9, true)}`,
		);
	}
	return lines;
}

function positionTable(scan: OpencodeScan, minRequests: number): string[] {
	const order: Position[] = ["first-warm", "first-cold", "mid-turn"];
	const label: Record<Position, string> = {
		"first-warm": "1st of turn, <1h since last",
		"first-cold": "1st of turn, cold/unknown",
		"mid-turn": "tool round (same turn)",
	};
	const providers = [...new Set([...scan.byPosition.keys()].map((k) => k.split("|")[1]))].sort();
	const lines = [
		`${col("pool", 12)} ${col("provider", 10)} ${col("position", 28)} ${col("reqs", 7, true)} ${col("uncached in", 12, true)} ${col("read/req", 9, true)} ${col("write/req", 9, true)} ${col("hit rate", 9, true)}`,
	];
	for (const pool of ["shared", "per-session"] as Pool[]) {
		for (const provider of providers) {
			for (const p of order) {
				const a = scan.byPosition.get(`${pool}|${provider}|${p}`);
				if (!a || a.requests < minRequests) continue;
				lines.push(
					`${col(pool, 12)} ${col(provider, 10)} ${col(label[p], 28)} ${col(num(a.requests), 7, true)} ${col(num(a.input), 12, true)} ${col(num(a.cacheRead / a.requests), 9, true)} ${col(num(a.cacheWrite / a.requests), 9, true)} ${col(pct(hitRate(a)), 9, true)}`,
				);
			}
		}
	}
	return lines;
}

function modelTable(scan: OpencodeScan, minRequests: number): string[] {
	const rows = [...scan.byModel.entries()]
		.filter(([, a]) => a.requests >= minRequests)
		.sort((a, b) => b[1].input - a[1].input);
	const lines = [
		`${col("pool", 12)} ${col("provider/model", 34)} ${col("requests", 9, true)} ${col("uncached in", 12, true)} ${col("cache read", 12, true)} ${col("hit rate", 9, true)} ${col("headroom", 10, true)}`,
	];
	for (const [key, a] of rows) {
		const [pool, provider, model] = key.split("|");
		lines.push(
			`${col(pool, 12)} ${col(`${provider}/${model}`, 34)} ${col(num(a.requests), 9, true)} ${col(num(a.input), 12, true)} ${col(num(a.cacheRead), 12, true)} ${col(pct(hitRate(a)), 9, true)} ${col(usd(headroomUsd(`${provider}|${model}`, a)), 10, true)}`,
		);
	}
	return lines;
}

function directTable(label: string, byModel: Map<string, Agg>): string[] {
	const lines: string[] = [];
	for (const [key, a] of [...byModel.entries()].sort((x, y) => y[1].input - x[1].input)) {
		const [provider, model] = key.split("|");
		lines.push(
			`${col(label, 15)} ${col(`${provider}/${model}`, 31)} ${col(num(a.requests), 9, true)} ${col(num(a.input), 12, true)} ${col(num(a.cacheRead), 12, true)} ${col(pct(hitRate(a)), 9, true)}`,
		);
	}
	return lines;
}

async function main(): Promise<void> {
	const argv = process.argv.slice(2);
	const flag = (name: string, fallback: number): number => {
		const i = argv.indexOf(`--${name}`);
		if (i === -1) return fallback;
		const v = Number(argv[i + 1]);
		return Number.isFinite(v) ? v : fallback;
	};
	const days = flag("days", 7);
	const minRequests = flag("min-requests", 50);
	const worstSessions = flag("sessions", 0);
	const asJson = argv.includes("--json");

	const cutoff = Date.now() - days * 86_400_000;
	const started = Date.now();
	const scan = await scanOpencode(cutoff);

	const claudeDays: EngineUsageScan["days"] = new Map();
	await scanClaudeDirect(claudeDays, cutoff);
	const codexDays: EngineUsageScan["days"] = new Map();
	await scanCodexDirect(codexDays, cutoff);
	const claude = foldDays(claudeDays);
	const codex = foldDays(codexDays);

	if (asJson) {
		const dump = (m: Map<string, Agg>) =>
			Object.fromEntries(
				[...m].map(([k, a]) => [
					k,
					{
						requests: a.requests,
						input: a.input,
						cacheRead: a.cacheRead,
						cacheWrite: a.cacheWrite,
						output: a.output,
						sessions: a.sessions.size,
						hitRate: hitRate(a),
					},
				]),
			);
		console.log(
			JSON.stringify(
				{
					days,
					since: new Date(cutoff).toISOString(),
					opencode: {
						byPool: dump(scan.byPool),
						byModel: dump(scan.byModel),
						byPosition: dump(scan.byPosition),
					},
					claudeDirect: dump(claude),
					codexDirect: dump(codex),
				},
				null,
				2,
			),
		);
		return;
	}

	const all = totals([...scan.byPool.values(), ...claude.values(), ...codex.values()]);
	console.log(`\nPrompt cache — last ${days} day(s), since ${new Date(cutoff).toISOString().slice(0, 16)}Z`);
	console.log(`${scan.dbs} shard DBs read, ${num(scan.rows)} priced opencode requests, ${((Date.now() - started) / 1000).toFixed(0)}s\n`);

	console.log("── opencode, by server pool ──");
	for (const l of poolTable(scan)) console.log(l);

	console.log("\n── opencode, by turn position ──");
	console.log("   (a prefix that changes between turns can only hurt the FIRST request of a turn:");
	console.log("    a warm one should read a whole context and write a small delta, not the reverse)");
	for (const l of positionTable(scan, Math.min(minRequests, 20))) console.log(l);

	console.log(`\n── opencode, by model (>= ${minRequests} requests) ──`);
	for (const l of modelTable(scan, minRequests)) console.log(l);

	if (claude.size || codex.size) {
		console.log("\n── direct engines (totals only; no pool or turn split in their stores) ──");
		console.log(
			`${col("engine", 15)} ${col("provider/model", 31)} ${col("requests", 9, true)} ${col("uncached in", 12, true)} ${col("cache read", 12, true)} ${col("hit rate", 9, true)}`,
		);
		for (const l of directTable("claude-direct", claude)) console.log(l);
		for (const l of directTable("codex-direct", codex)) console.log(l);
	}

	if (worstSessions > 0) {
		console.log(`\n── worst ${worstSessions} sessions by uncached input on warm first-of-turn requests ──`);
		const rows = [...scan.bySession.entries()].sort((a, b) => b[1].input - a[1].input).slice(0, worstSessions);
		for (const [key, a] of rows) {
			const [pool, provider, session] = key.split("|");
			console.log(
				`${col(pool, 12)} ${col(provider, 10)} ${col(session, 32)} ${col(`${a.requests} req`, 9, true)} ${col(num(a.input), 12, true)} ${col(pct(hitRate(a)), 9, true)}`,
			);
		}
	}

	console.log(
		`\noverall: ${pct(hitRate(all))} of ${num(all.cacheRead + all.input)} prompt tokens served from cache ` +
			`(${num(all.input)} uncached, ${num(all.cacheRead)} cached)\n`,
	);
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
