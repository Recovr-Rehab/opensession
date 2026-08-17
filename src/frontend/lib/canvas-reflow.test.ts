// First on purpose: canvas-cards.tsx pulls in the tldraw runtime, which dies
// at module scope on the one-key `window` stub other test files leak. See the
// shim's module doc.
import "./tldraw-test-window";
import { describe, expect, it } from "bun:test";
import { CARD_GAP, CARD_H, CARD_W } from "./canvas-cards";
import { reflowColumns, reflowSlot } from "./canvas-reflow";

const DESKTOP = { width: 1440, height: 900 };
const PHONE = { width: 390, height: 844 };

/** What the camera can do with a grid of this shape, which is what we optimise. */
function fitScale(count: number, cols: number, view: { width: number; height: number }) {
	const rows = Math.ceil(count / cols);
	return Math.min(
		(view.width - 96) / (cols * (CARD_W + CARD_GAP) - CARD_GAP),
		(view.height - 96) / (rows * (CARD_H + CARD_GAP) - CARD_GAP),
	);
}

describe("reflowColumns", () => {
	it("keeps one card in one column", () => {
		expect(reflowColumns(1, DESKTOP)).toBe(1);
		expect(reflowColumns(0, DESKTOP)).toBe(1);
	});

	it("picks the grid the viewport can show largest", () => {
		for (const count of [2, 3, 4, 5, 6, 9, 12, 20, 30]) {
			for (const view of [DESKTOP, PHONE]) {
				const chosen = reflowColumns(count, view);
				const best = Math.max(
					...Array.from({ length: count }, (_, i) => fitScale(count, i + 1, view)),
				);
				expect(fitScale(count, chosen, view)).toBeCloseTo(best, 6);
			}
		}
	});

	it("lays a wide viewport out wide and a tall one tall", () => {
		// The same cards, arranged for the frame: the board's own five columns
		// would leave a laptop three-quarters empty and a phone unreadable.
		expect(reflowColumns(3, DESKTOP)).toBe(3);
		expect(reflowColumns(4, DESKTOP)).toBe(2);
		expect(reflowColumns(6, DESKTOP)).toBe(3);
		expect(reflowColumns(4, PHONE)).toBe(1);
		expect(reflowColumns(6, PHONE)).toBe(2);
	});

	it("breaks a tie toward the grid without a ragged last row", () => {
		// 4 cards in 2 or 3 columns are both two rows tall on a laptop, so the
		// camera cannot tell them apart. 2x2 is the one that is actually full.
		expect(fitScale(4, 2, DESKTOP)).toBeCloseTo(fitScale(4, 3, DESKTOP), 6);
		expect(reflowColumns(4, DESKTOP)).toBe(2);
	});

	it("survives a viewport with no room in it", () => {
		expect(reflowColumns(6, { width: 0, height: 0 })).toBeGreaterThan(0);
	});
});

describe("reflowSlot", () => {
	it("packs row-major on the board's own pitch", () => {
		expect(reflowSlot(0, 3)).toEqual({ x: 0, y: 0 });
		expect(reflowSlot(1, 3)).toEqual({ x: CARD_W + CARD_GAP, y: 0 });
		expect(reflowSlot(3, 3)).toEqual({ x: 0, y: CARD_H + CARD_GAP });
	});

	it("never divides by a zero column count", () => {
		expect(reflowSlot(2, 0)).toEqual({ x: 0, y: 2 * (CARD_H + CARD_GAP) });
	});
});
