import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadRates, priceDay, resetRatesForTest } from "./engine-usage";

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
