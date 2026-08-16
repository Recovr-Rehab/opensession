import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { LiveTurnStore } from "./live-turn-store";

// os1-tui's tests run earlier in the same bun-test process and leak
// @opentui/core's renderer-bound requestAnimationFrame: it invokes a callback
// at most once (synchronously, when it flips the renderer's idle loop live)
// and never again once that renderer is gone — so no real frames ever fire
// here. Drop the leaked globals for this file; the store then uses its
// setTimeout(16ms) fallback, which the sleeps below already cover.
const savedRaf = globalThis.requestAnimationFrame;
const savedCancel = globalThis.cancelAnimationFrame;
beforeAll(() => {
	delete (globalThis as { requestAnimationFrame?: unknown }).requestAnimationFrame;
	delete (globalThis as { cancelAnimationFrame?: unknown }).cancelAnimationFrame;
});
afterAll(() => {
	if (savedRaf) globalThis.requestAnimationFrame = savedRaf;
	if (savedCancel) globalThis.cancelAnimationFrame = savedCancel;
});

describe("LiveTurnStore", () => {
	test("coalesces a burst of deltas into one published text snapshot", async () => {
		const store = new LiveTurnStore();
		let notifications = 0;
		const unsubscribe = store.subscribe(() => notifications++);
		store.start("Jaap", "run-1");
		for (let index = 0; index < 100; index++) store.append(String(index % 10));
		await Bun.sleep(25);
		expect(store.getSnapshot().text).toHaveLength(100);
		// start + a single frame flush (the 130ms markdown-settle tick is later).
		expect(notifications).toBe(2);
		unsubscribe();
		store.clear();
	});

	test("deduplicates committed text in either arrival order", async () => {
		const store = new LiveTurnStore();
		store.start(undefined, "run-2");
		store.land(["already committed"]);
		store.append("already committed");
		await Bun.sleep(25);
		expect(store.getSnapshot().text).toBe("");

		store.append("streamed first");
		await Bun.sleep(25);
		store.land(["streamed first"]);
		expect(store.getSnapshot().text).toBe("");
		store.clear();
	});

	test("drops a half-streamed block when its durable entry lands mid-flight", async () => {
		// Live typing (stream-text.ts) delivers a block as deltas, so the
		// transcript entry can arrive while the tail is still coming. Without
		// prefix matching the bubble keeps growing beside the durable entry and
		// the reply shows twice.
		const store = new LiveTurnStore();
		store.start(undefined, "run-3");
		store.append("Hello ");
		store.append("there, ");
		await Bun.sleep(25);
		store.land(["Hello there, world"]);
		expect(store.getSnapshot().text).toBe("");

		// The rest of the block still arrives; it must be swallowed, not shown.
		store.append("wor");
		store.append("ld");
		await Bun.sleep(25);
		expect(store.getSnapshot().text).toBe("");
		store.clear();
	});

	test("keeps streaming text that follows a landed block", async () => {
		const store = new LiveTurnStore();
		store.start(undefined, "run-4");
		store.append("first block");
		await Bun.sleep(25);
		store.land(["first block"]);
		store.append("second block");
		await Bun.sleep(25);
		expect(store.getSnapshot().text).toBe("second block");
		store.clear();
	});
});
