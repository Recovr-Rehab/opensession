import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadRates, priceDay, resetRatesForTest, scanClaudeDirect, scanCodexDirect } from "./engine-usage";

/**
 * Pricing is the whole point of this module: the audit log's own cost field
 * reported $0 for the OpenAI pool, which hid the single largest line.
 */

let dir = "";
const prevEnv = process.env.OPENCODE_MODELS_JSON;

const CATALOG = {
	anthropic: {
		models: {
			"claude-opus-5": { cost: { input: 5, output: 25, cache_read: 0.5, cache_write: 6.25 } },
			"claude-fable-5": { cost: { input: 10, output: 50, cache_read: 1, cache_write: 12.5 } },
		},
	},
	openai: {
		models: {
			"gpt-5.6-sol": { cost: { input: 5, output: 30, cache_read: 0.5, cache_write: 6.25 } },
		},
	},
	// A provider whose models carry no price must not throw or count as free.
	cerebras: { models: { "gpt-oss-120b": {} } },
};

beforeAll(() => {
	dir = mkdtempSync(join(tmpdir(), "engine-usage-"));
	const p = join(dir, "models.json");
	writeFileSync(p, JSON.stringify(CATALOG));
	process.env.OPENCODE_MODELS_JSON = p;
	resetRatesForTest();
});

afterAll(() => {
	if (prevEnv === undefined) delete process.env.OPENCODE_MODELS_JSON;
	else process.env.OPENCODE_MODELS_JSON = prevEnv;
	resetRatesForTest();
	rmSync(dir, { recursive: true, force: true });
});

const bucket = (input: number, output: number, cacheRead: number, cacheWrite: number, requests = 1) => ({
	requests,
	input,
	output,
	cacheRead,
	cacheWrite,
});

describe("engine usage pricing", () => {
	test("Anthropic cache writes bill at 2x input, not the catalog's 1.25x", () => {
		// Every cache write we make carries the 1-hour TTL, which is 2x base
		// input. The catalog's cache_write field is the 5-minute rate.
		const rates = loadRates();
		expect(rates.get("anthropic|claude-opus-5")?.cacheWrite).toBe(10);
		expect(rates.get("anthropic|claude-fable-5")?.cacheWrite).toBe(20);
		// Non-Anthropic providers keep the catalog rate.
		expect(rates.get("openai|gpt-5.6-sol")?.cacheWrite).toBe(6.25);
	});

	test("a day prices every model request, both providers", () => {
		const day = priceDay(
			"2026-08-14",
			new Map([
				["anthropic|claude-opus-5", bucket(1_000_000, 1_000_000, 1_000_000, 1_000_000, 3)],
				["openai|gpt-5.6-sol", bucket(1_000_000, 0, 0, 0, 2)],
			]),
		);
		// opus-5: 5 + 25 + 0.5 + 10 = 40.5;  sol: 5
		expect(day.costUsd).toBeCloseTo(45.5);
		expect(day.requests).toBe(5);
		expect(day.totalTokens).toBe(5_000_000);
		expect(day.unpricedRequests).toBe(0);
	});

	test("an unpriced model still counts its tokens but adds no cost", () => {
		const day = priceDay(
			"2026-08-14",
			new Map([
				["anthropic|claude-opus-5", bucket(1_000_000, 0, 0, 0, 1)],
				["cerebras|gpt-oss-120b", bucket(9_000_000, 0, 0, 0, 4)],
			]),
		);
		expect(day.costUsd).toBeCloseTo(5);
		expect(day.totalTokens).toBe(10_000_000);
		// Silently pricing an unknown model at zero would read as "free".
		expect(day.unpricedRequests).toBe(4);
	});

	test("a day past the store's retention is unmeasured, not zero", () => {
		// The shard DBs prune at about a month. Charting a pruned day as 0
		// would read as "usage started here", so it carries a flag instead.
		const pruned = priceDay("2026-05-20", new Map(), true);
		expect(pruned.unmeasured).toBe(true);
		expect(pruned.costUsd).toBe(0);
		// A day inside the window with no traffic is a real zero.
		const quiet = priceDay("2026-08-14", new Map());
		expect(quiet.unmeasured).toBe(false);
	});

	test("models are ordered by cost, so the expensive one leads", () => {
		const day = priceDay(
			"2026-08-14",
			new Map([
				["openai|gpt-5.6-sol", bucket(1_000_000, 0, 0, 0)],
				["anthropic|claude-fable-5", bucket(1_000_000, 0, 0, 0)],
			]),
		);
		expect(day.byModel[0].model).toBe("claude-fable-5");
	});
});

// ── The direct engines ──
//
// Neither writes to the opencode shard DBs, so an engine we do not read reports
// as zero rather than as missing, and nothing else detects it. Each format
// carries one trap worth about 2x if mishandled: replayed history on the Claude
// side, repeated token_count events on the codex side.

const CUTOFF = Date.parse("2026-08-10T00:00:00Z");

describe("claude-direct transcripts", () => {
	const usage = (input: number, output: number, cacheRead: number, cacheWrite: number) => ({
		input_tokens: input,
		output_tokens: output,
		cache_read_input_tokens: cacheRead,
		cache_creation_input_tokens: cacheWrite,
	});
	const assistant = (o: { id?: string; uuid?: string; at: string; model?: string; usage: object }) =>
		JSON.stringify({
			type: "assistant",
			requestId: o.id,
			uuid: o.uuid,
			timestamp: o.at,
			message: { model: o.model ?? "claude-opus-5", usage: o.usage },
		});

	test("counts a replayed request once and ignores synthetic lines", async () => {
		const root = join(dir, "claude");
		const proj = join(root, "acct-1", "projects", "-tmp-work");
		mkdirSync(proj, { recursive: true });
		writeFileSync(
			join(proj, "a.jsonl"),
			[
				assistant({ id: "req_1", at: "2026-08-14T10:00:00Z", usage: usage(10, 20, 30, 40) }),
				// Written locally to keep the transcript well formed; no request.
				assistant({ id: "req_s", at: "2026-08-14T10:01:00Z", model: "<synthetic>", usage: usage(9, 9, 9, 9) }),
				JSON.stringify({ type: "user", timestamp: "2026-08-14T10:02:00Z", message: { content: "hi" } }),
				// Older than the range.
				assistant({ id: "req_0", at: "2026-08-01T10:00:00Z", usage: usage(7, 7, 7, 7) }),
			].join("\n"),
		);
		// A resume replays the history verbatim into a new file, timestamps
		// included, and adds one request. req_1 must be counted once in total.
		writeFileSync(
			join(proj, "b.jsonl"),
			[
				assistant({ id: "req_1", at: "2026-08-14T10:00:00Z", usage: usage(10, 20, 30, 40) }),
				// No requestId: the uuid is the fallback key.
				assistant({ uuid: "u-2", at: "2026-08-14T11:00:00Z", usage: usage(1, 2, 3, 4) }),
			].join("\n"),
		);

		const days = new Map();
		await scanClaudeDirect(days, CUTOFF, root);

		expect([...days.keys()]).toEqual(["2026-08-14"]);
		const b = days.get("2026-08-14").get("anthropic|claude-opus-5");
		expect(b.requests).toBe(2);
		expect(b.input).toBe(11);
		expect(b.output).toBe(22);
		expect(b.cacheRead).toBe(33);
		expect(b.cacheWrite).toBe(44);
	});
});

describe("codex-direct rollouts", () => {
	const tokenCount = (at: string, input: number, cached: number, output: number) =>
		JSON.stringify({
			timestamp: at,
			type: "event_msg",
			payload: {
				type: "token_count",
				info: { total_token_usage: { input_tokens: input, cached_input_tokens: cached, output_tokens: output } },
			},
		});
	const turnContext = (at: string, model: string) =>
		JSON.stringify({ timestamp: at, type: "turn_context", payload: { model } });
	const rollout = (name: string, lines: string[]) => {
		const root = join(dir, name);
		const day = join(root, "acct-1", "sessions", "2026", "08", "14");
		mkdirSync(day, { recursive: true });
		writeFileSync(join(day, "rollout-2026-08-14T10-00-00-abc.jsonl"), lines.join("\n"));
		return root;
	};

	test("bills the delta of the running total, so a repeated event is free", async () => {
		const root = rollout("codex-a", [
			turnContext("2026-08-09T22:00:00Z", "gpt-5.6-sol"),
			// Before the range, so not counted — but it must still seed the
			// baseline, or the next event books the whole running total.
			tokenCount("2026-08-09T23:00:00Z", 100, 40, 10),
			tokenCount("2026-08-14T10:00:00Z", 300, 140, 30),
			// codex repeats token_count on an aborted turn, and the running
			// total correctly stands still. Summing last_token_usage instead
			// would charge this twice.
			tokenCount("2026-08-14T10:05:00Z", 300, 140, 30),
			tokenCount("2026-08-14T10:10:00Z", 500, 240, 50),
		]);

		const days = new Map();
		await scanCodexDirect(days, CUTOFF, root);

		const b = days.get("2026-08-14").get("openai|gpt-5.6-sol");
		expect(b.requests).toBe(2);
		// input_tokens includes the cached part, so uncached is the difference.
		expect(b.input).toBe(200);
		expect(b.cacheRead).toBe(200);
		expect(b.output).toBe(40);
		// OpenAI bills no cache writes.
		expect(b.cacheWrite).toBe(0);
	});

	test("cached input prices as a cache read, not as input", async () => {
		const root = rollout("codex-b", [
			turnContext("2026-08-14T09:00:00Z", "gpt-5.6-sol"),
			tokenCount("2026-08-14T10:00:00Z", 1_000_000, 900_000, 0),
		]);
		const days = new Map();
		await scanCodexDirect(days, CUTOFF, root);
		// 100k uncached at $5/Mtok, 900k cached at $0.50/Mtok.
		expect(priceDay("2026-08-14", days.get("2026-08-14")).costUsd).toBeCloseTo(0.95);
	});

	test("a reset total starts a fresh baseline rather than booking a negative", async () => {
		const root = rollout("codex-c", [
			turnContext("2026-08-14T09:00:00Z", "gpt-5.6-sol"),
			tokenCount("2026-08-14T10:00:00Z", 500, 0, 50),
			tokenCount("2026-08-14T10:05:00Z", 200, 0, 20),
		]);
		const days = new Map();
		await scanCodexDirect(days, CUTOFF, root);
		const b = days.get("2026-08-14").get("openai|gpt-5.6-sol");
		expect(b.requests).toBe(2);
		expect(b.input).toBe(700);
		expect(b.output).toBe(70);
	});
});
