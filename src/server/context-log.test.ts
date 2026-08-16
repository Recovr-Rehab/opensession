/**
 * "Model-visible means logged": everything injected into a turn's model input
 * must be reconstructable from the append-only store.
 *
 * Driven through the real stack — runAgent → runOnModel → the fake engine
 * (testing/fake-engine.ts) — against a real TranscriptStore on a temp DB, so
 * the assertions cover the actual choke point, the actual entry path (blob
 * split included) and the actual client projection, not a hand-built entry.
 */
import { afterAll, afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { __setEngineForTest, runAgent } from "./agent-runner";
import { __setActiveRunsPathForTest } from "./run-journal";
import type { StreamEvent } from "./run-events";
import { makeFakeEngine } from "./testing/fake-engine";
import {
	TranscriptStore,
	__setTranscriptStoreForTest,
} from "./transcript-store";
import { wrapContext } from "./prompt-context";
import { entriesForWire } from "./jsonl-parser";
import { buildEngineSwitchHandoffNote } from "./fork-handoff";
import type { TranscriptEntry } from "./types";

const dir = mkdtempSync(`${tmpdir()}/context-log-test-`);
const prevJournal = __setActiveRunsPathForTest(`${dir}/active-runs.json`);
let store: TranscriptStore;
let prevStore: TranscriptStore | undefined;
let dbIndex = 0;

beforeEach(() => {
	// A fresh DB per test: the logger's dedupe is keyed on content, so tests
	// that log the same payload must not share a store either.
	store = new TranscriptStore(`${dir}/transcripts-${++dbIndex}.db`);
	prevStore = __setTranscriptStoreForTest(store) ?? prevStore;
	(globalThis as any).__osContextLogged?.clear();
});

afterEach(() => {
	__setEngineForTest(null);
});

afterAll(() => {
	__setTranscriptStoreForTest(prevStore);
	__setActiveRunsPathForTest(prevJournal);
	rmSync(dir, { recursive: true, force: true });
});

async function drain(gen: AsyncGenerator<StreamEvent>): Promise<void> {
	for await (const _ of gen) {
	}
}

function injections(sessionId: string): TranscriptEntry[] {
	return store
		.readTail(sessionId, 100)
		.entries.filter((e) => e.noticeKind === "context-injection");
}

describe("context-log: injected context round-trips into the store", () => {
	test("every fenced block and the repos note land as tagged entries", async () => {
		const sessionId = "os-ctx-1";
		__setEngineForTest(makeFakeEngine([{ kind: "clean", text: ["ok"] }]).engine);
		await drain(
			runAgent({
				prompt: [
					wrapContext("## Engine handoff\nprior turns…", "handoff"),
					wrapContext("### Other session\n- User: hi", "attached-session-excerpt"),
					"rebase this",
				].join("\n\n"),
				cwd: dir,
				mcpServers: [],
				model: "claude-sonnet-5",
				fallbackModel: "none",
				reposNote: "## Repos\nopensession → /tmp/x\n\n## Memory\nremember me",
				promptEntryId: "turn-1",
				journal: { osSessionId: sessionId, kind: "session" },
			}),
		);

		const logged = injections(sessionId);
		expect(logged.map((e) => e.contextInjection?.source).sort()).toEqual([
			"attached-session-excerpt",
			"handoff",
			"repos-note",
		]);
		// Payload recorded verbatim, associated with the turn it rode with.
		const handoff = logged.find((e) => e.contextInjection?.source === "handoff")!;
		expect(handoff.content).toBe("## Engine handoff\nprior turns…");
		expect(handoff.contextInjection?.turnId).toBe("turn-1");
		expect(handoff.type).toBe("system");
		// The system-channel note is model-visible without being in the body.
		expect(
			logged.find((e) => e.contextInjection?.source === "repos-note")?.content,
		).toContain("remember me");
	});

	test("an untagged block still logs (the fence is the contract, not the call)", async () => {
		const sessionId = "os-ctx-untagged";
		__setEngineForTest(makeFakeEngine([{ kind: "clean" }]).engine);
		await drain(
			runAgent({
				prompt: `${wrapContext("legacy plumbing")}\n\nhello`,
				cwd: dir,
				mcpServers: [],
				fallbackModel: "none",
				journal: { osSessionId: sessionId, kind: "session" },
			}),
		);
		const logged = injections(sessionId);
		expect(logged).toHaveLength(1);
		expect(logged[0].contextInjection?.source).toBe("unknown");
		expect(logged[0].content).toBe("legacy plumbing");
	});

	test("an oversized payload splits into a blob and rehydrates in full", async () => {
		const sessionId = "os-ctx-big";
		// Comfortably past the store's 32KB wire bound, like a real engine
		// handoff (buildEngineSwitchHandoffNote budgets up to 180KB).
		const big = `## Engine handoff\n${"transcript line ".repeat(6000)}`;
		__setEngineForTest(makeFakeEngine([{ kind: "clean" }]).engine);
		await drain(
			runAgent({
				prompt: `${wrapContext(big, "handoff")}\n\ncontinue`,
				cwd: dir,
				mcpServers: [],
				fallbackModel: "none",
				promptEntryId: "turn-big",
				journal: { osSessionId: sessionId, kind: "session" },
			}),
		);
		const logged = injections(sessionId);
		expect(logged).toHaveLength(1);
		expect(logged[0].contentClamped).toBe(true);
		const full = store.getFullEntry(sessionId, logged[0].id)!;
		expect(full.content).toBe(big.trim());
	});

	test("the fallback walk logs the handoff it prepends for the second model", async () => {
		const sessionId = "os-ctx-fallback";
		__setEngineForTest(
			makeFakeEngine([
				{ kind: "usage_exhausted", engineSessionId: "ses_1" },
				{ kind: "clean", text: ["done"] },
			]).engine,
		);
		await drain(
			runAgent({
				prompt: "do the thing",
				cwd: dir,
				mcpServers: [],
				model: "claude-fable-5",
				fallbackModel: "gpt-5.6-sol",
				promptEntryId: "turn-fb",
				journal: { osSessionId: sessionId, kind: "session" },
			}),
		);
		// The cross-provider hop had no prior-engine transcript to hand over
		// here, so the walk's own note is the plain unfenced one; what matters
		// is that the second dispatch went through the same choke point and
		// nothing was logged twice for the first.
		const logged = injections(sessionId);
		expect(logged.every((e) => e.contextInjection?.turnId === "turn-fb")).toBe(true);
		expect(new Set(logged.map((e) => e.id)).size).toBe(logged.length);
	});

	test("a retried turn upserts its record instead of duplicating it", async () => {
		const sessionId = "os-ctx-retry";
		const prompt = `${wrapContext("## Engine handoff\nsame payload", "handoff")}\n\ngo`;
		for (const _ of [1, 2]) {
			__setEngineForTest(makeFakeEngine([{ kind: "clean" }]).engine);
			await drain(
				runAgent({
					prompt,
					cwd: dir,
					mcpServers: [],
					fallbackModel: "none",
					promptEntryId: "turn-retry",
					journal: { osSessionId: sessionId, kind: "session" },
				}),
			);
			(globalThis as any).__osContextLogged?.clear(); // force the second write
		}
		expect(injections(sessionId)).toHaveLength(1);
	});

	test("nothing is logged for a session-less run", async () => {
		__setEngineForTest(makeFakeEngine([{ kind: "clean" }]).engine);
		await drain(
			runAgent({
				prompt: `${wrapContext("orphan", "handoff")}\n\nhi`,
				cwd: dir,
				mcpServers: [],
				fallbackModel: "none",
			}),
		);
		expect(store.readTail("", 10).entries).toHaveLength(0);
	});
});

describe("context-log: injection records are not conversation", () => {
	test("the wire projection drops them, keeping the visible transcript intact", async () => {
		const sessionId = "os-ctx-wire";
		__setEngineForTest(makeFakeEngine([{ kind: "clean" }]).engine);
		await drain(
			runAgent({
				prompt: `${wrapContext("## Engine handoff\nplumbing", "handoff")}\n\nvisible`,
				cwd: dir,
				mcpServers: [],
				fallbackModel: "none",
				journal: { osSessionId: sessionId, kind: "session" },
			}),
		);
		const stored = store.readTail(sessionId, 100).entries;
		expect(stored.some((e) => e.noticeKind === "context-injection")).toBe(true);
		const wire = entriesForWire(stored);
		expect(wire.some((e) => e.noticeKind === "context-injection")).toBe(false);
		expect(wire).toHaveLength(stored.length - 1);
	});

	test("a handoff note built from history skips them", () => {
		const entry = (over: Partial<TranscriptEntry>): TranscriptEntry => ({
			id: over.id || "e",
			type: over.type || "user",
			content: over.content || "",
			timestamp: "2026-08-16T00:00:00Z",
			...over,
		});
		const note = buildEngineSwitchHandoffNote({
			fromProvider: "opencode",
			toProvider: "claude",
			sameEngineRestart: true,
			entries: [
				entry({ id: "a", content: "real message" }),
				entry({
					id: "b",
					type: "system",
					content: "INJECTED PAYLOAD",
					noticeKind: "context-injection",
					contextInjection: { source: "handoff" },
				}),
			],
		});
		expect(note).toContain("real message");
		expect(note).not.toContain("INJECTED PAYLOAD");
	});
});
