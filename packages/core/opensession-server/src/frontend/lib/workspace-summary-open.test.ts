import { describe, expect, test } from "bun:test";
import {
	WS_SUMMARY_MAX_SHIFT,
	WS_SUMMARY_ROOM_W,
	workspaceSummaryShift,
} from "./workspace-summary-open";

/**
 * Opening the card deliberately composes the transcript and card side by side:
 * every pane that can show the card gets the same visible left step, while a
 * pane too narrow to show it stays still.
 */
describe("workspaceSummaryShift", () => {
	test("moves the transcript and composer by the full step when the card fits", () => {
		expect(workspaceSummaryShift(WS_SUMMARY_ROOM_W)).toBe(WS_SUMMARY_MAX_SHIFT);
	});

	test("keeps the visible step on wider panes", () => {
		expect(workspaceSummaryShift(WS_SUMMARY_ROOM_W + 320)).toBe(
			WS_SUMMARY_MAX_SHIFT,
		);
		expect(workspaceSummaryShift(2400)).toBe(WS_SUMMARY_MAX_SHIFT);
	});

	test("does not move a pane too narrow to show the card", () => {
		expect(workspaceSummaryShift(WS_SUMMARY_ROOM_W - 1)).toBe(0);
		expect(workspaceSummaryShift(0)).toBe(0);
	});
});
