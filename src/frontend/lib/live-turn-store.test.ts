import { describe, expect, test } from "bun:test";
import { LiveTurnStore } from "./live-turn-store";

describe("LiveTurnStore", () => {
	test("coalesces a burst of deltas into one published text snapshot", async () => {
		const store = new LiveTurnStore();
		let notifications = 0;
		const unsubscribe = store.subscribe(() => notifications++);
		store.start("Jaap", "run-1");
		for (let index = 0; index < 100; index++) store.append(String(index % 10));
		await Bun.sleep(25);
		expect(store.getSnapshot().text).toHaveLength(100);
		// start + a single frame flush.
		expect(notifications).toBe(2);
		unsubscribe();
		store.clear();
	});

	test("deduplicates committed text in either arrival order", async () => {
		const store = new LiveTurnStore();
		store.start(undefined, "run-2");
		store.land([{ content: "already committed" }]);
		store.append("already committed");
		await Bun.sleep(25);
		expect(store.getSnapshot().text).toBe("");

		store.append("streamed first");
		await Bun.sleep(25);
		store.land([{ content: "streamed first" }]);
		expect(store.getSnapshot().text).toBe("");
		store.clear();
	});

	test("drops a half-streamed block when its durable entry lands mid-flight", async () => {
		// The opencode runner delivers a block as deltas, so the transcript
		// entry can arrive while the tail is still coming. Without prefix
		// matching the bubble keeps growing beside the durable entry and the
		// reply shows twice.
		const store = new LiveTurnStore();
		store.start(undefined, "run-3");
		store.append("Hello ");
		store.append("there, ");
		await Bun.sleep(25);
		store.land([{ content: "Hello there, world" }]);
		expect(store.getSnapshot().text).toBe("");

		// The rest of the block still arrives; it must be swallowed, not shown.
		store.append("wor");
		store.append("ld");
		await Bun.sleep(25);
		expect(store.getSnapshot().text).toBe("");
		store.clear();
	});

	test("cancels a block by id, whatever the durable text ended up being", async () => {
		// The wire normalizes and clamps entry content, so the durable text is
		// not always the streamed text character for character. The engine's
		// block id is, and it is what the entry carries.
		const store = new LiveTurnStore();
		store.start(undefined, "run-5");
		store.append("Here is the clip.\nOPENSESSION_VIDEO: /tmp/a.mp4\n", "prt_1");
		await Bun.sleep(25);
		store.land([{ id: "prt_1", content: "Here is the clip." }]);
		expect(store.getSnapshot().text).toBe("");

		// A late frame for that block is the entry's own words, not new text.
		store.append("trailing", "prt_1");
		await Bun.sleep(25);
		expect(store.getSnapshot().text).toBe("");
		store.clear();
	});

	test("keeps streaming text that follows a landed block", async () => {
		const store = new LiveTurnStore();
		store.start(undefined, "run-4");
		store.append("first block");
		await Bun.sleep(25);
		store.land([{ content: "first block" }]);
		store.append("second block");
		await Bun.sleep(25);
		expect(store.getSnapshot().text).toBe("second block");
		store.clear();
	});
});
