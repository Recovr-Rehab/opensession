import { describe, expect, test } from "bun:test";
import {
	anchoredCommentPosition,
	imageRegionBetween,
	imageRegionOutputSize,
	imageRegionPixels,
} from "./image-region-comment";
import {
	canCommentOnImageRegion,
	registerImageRegionCommentHandler,
	submitImageRegionComment,
} from "./image-region-comment-registry";

describe("image region geometry", () => {
	test("a reverse drag becomes a top-left rectangle", () => {
		expect(imageRegionBetween({ x: 0.8, y: 0.7 }, { x: 0.2, y: 0.1 })).toEqual({
			x: 0.2,
			y: 0.1,
			width: 0.6000000000000001,
			height: 0.6,
		});
	});

	test("a drag is clamped to the image", () => {
		expect(imageRegionBetween({ x: -1, y: 0.25 }, { x: 2, y: 1.5 })).toEqual({
			x: 0,
			y: 0.25,
			width: 1,
			height: 0.75,
		});
	});

	test("normalized edges become bounded intrinsic pixels", () => {
		expect(
			imageRegionPixels({ x: 0.25, y: 0.2, width: 0.5, height: 0.5 }, 1200, 800),
		).toEqual({ x: 300, y: 160, width: 600, height: 400 });
	});

	test("even a tiny edge selection keeps one pixel", () => {
		expect(
			imageRegionPixels({ x: 1, y: 1, width: 0, height: 0 }, 100, 50),
		).toEqual({ x: 99, y: 49, width: 1, height: 1 });
	});

	test("large retina crops are bounded without changing their ratio", () => {
		expect(imageRegionOutputSize(4000, 2000)).toEqual({
			width: 2000,
			height: 1000,
			scale: 0.5,
		});
	});
});

describe("image region comment registry", () => {
	test("dispatches to the owning session and cleans up by identity", async () => {
		const calls: string[] = [];
		const first = async () => {
			calls.push("first");
		};
		const second = async () => {
			calls.push("second");
		};
		const unregisterFirst = registerImageRegionCommentHandler("session-1", first);
		const unregisterSecond = registerImageRegionCommentHandler("session-1", second);
		unregisterFirst();
		expect(canCommentOnImageRegion("session-1")).toBe(true);
		await submitImageRegionComment({
			sessionId: "session-1",
			src: "/media?path=image.png",
			region: { x: 0, y: 0, width: 1, height: 1 },
			text: "Fix this",
		});
		expect(calls).toEqual(["second"]);
		unregisterSecond();
		expect(canCommentOnImageRegion("session-1")).toBe(false);
	});
});

describe("the comment card sits against its region", () => {
	const card = { width: 340, height: 140 };
	const viewport = { width: 1440, height: 900 };

	test("hangs under the selection, aligned to its left edge", () => {
		expect(
			anchoredCommentPosition(
				{ left: 500, top: 200, width: 260, height: 120 },
				card,
				viewport,
			),
		).toEqual({ left: 500, top: 330, placement: "below" });
	});

	test("flips above a region that reaches the bottom of the screen", () => {
		expect(
			anchoredCommentPosition(
				{ left: 500, top: 640, width: 260, height: 200 },
				card,
				viewport,
			),
		).toEqual({ left: 500, top: 490, placement: "above" });
	});

	test("keeps Send on screen when a region fills the height", () => {
		const placed = anchoredCommentPosition(
			{ left: 40, top: 10, width: 300, height: 880 },
			card,
			viewport,
		);
		expect(placed.placement).toBe("clamped");
		expect(placed.top + card.height).toBeLessThanOrEqual(viewport.height - 12);
	});

	test("never runs off the right edge of a phone", () => {
		const phone = { width: 390, height: 844 };
		const placed = anchoredCommentPosition(
			{ left: 300, top: 120, width: 80, height: 60 },
			{ width: 340, height: 150 },
			phone,
		);
		expect(placed.left).toBe(38);
		expect(placed.left + 340).toBeLessThanOrEqual(phone.width - 12);
	});
});
