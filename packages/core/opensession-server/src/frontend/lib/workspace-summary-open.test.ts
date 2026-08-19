import { describe, expect, test } from "bun:test";
import {
	WS_SUMMARY_MAX_SHIFT,
	WS_SUMMARY_ROOM_W,
	workspaceSummaryShift,
} from "./workspace-summary-open";

/**
 * The step exists to keep the card off the words, and for no other reason. Its
 * shape is therefore the whole contract: full at the width where the card only
 * just fits, nothing at all once the pane can hold both, and never a jump
 * between the two.
 */
describe("workspaceSummaryShift", () => {
	test("gives up half the card's footprint at the narrowest pane that keeps it", () => {
		expect(workspaceSummaryShift(WS_SUMMARY_ROOM_W)).toBe(WS_SUMMARY_MAX_SHIFT);
	});

	test("never steps further than that, however narrow the pane reports", () => {
		expect(workspaceSummaryShift(WS_SUMMARY_ROOM_W - 400)).toBe(
			WS_SUMMARY_MAX_SHIFT,
		);
	});

	test("stands still on a pane wide enough to hold the card clear", () => {
		// Two pixels of pane per pixel of step, so the step is spent by here.
		const clear = WS_SUMMARY_ROOM_W + WS_SUMMARY_MAX_SHIFT * 2;
		expect(workspaceSummaryShift(clear)).toBe(0);
		expect(workspaceSummaryShift(clear + 600)).toBe(0);
	});

	test("spends the step at half the rate the pane grows", () => {
		expect(workspaceSummaryShift(WS_SUMMARY_ROOM_W + 100)).toBe(
			WS_SUMMARY_MAX_SHIFT - 50,
		);
		expect(workspaceSummaryShift(WS_SUMMARY_ROOM_W + 200)).toBe(
			WS_SUMMARY_MAX_SHIFT - 100,
		);
	});

	test("never widens the gap the flat step used to leave", () => {
		// The step it replaced was WS_SUMMARY_MAX_SHIFT at every width. Each
		// pixel of pane above the threshold hands the column half a pixel of
		// gutter, so the clearance this leaves is never less than that.
		for (let w = WS_SUMMARY_ROOM_W; w <= 2400; w += 20) {
			const gutter = (w - WS_SUMMARY_ROOM_W) / 2;
			expect(workspaceSummaryShift(w) + gutter).toBeGreaterThanOrEqual(
				WS_SUMMARY_MAX_SHIFT,
			);
		}
	});

	test("an unmeasured pane paints centred rather than stepped", () => {
		expect(workspaceSummaryShift(0)).toBe(0);
	});

	test("returns whole pixels, so the column lands on the device grid", () => {
		const step = workspaceSummaryShift(WS_SUMMARY_ROOM_W + 51);
		expect(Number.isInteger(step)).toBe(true);
	});
});
