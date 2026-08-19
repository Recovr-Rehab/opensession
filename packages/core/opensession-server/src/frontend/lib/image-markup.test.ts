import { describe, expect, test } from "bun:test";

import {
	MAX_MARKUP_EDGE,
	type MarkupShape,
	markupExportSize,
	markupExportType,
	markupFileName,
	markupStrokeWidth,
	recallMarkup,
	rememberMarkup,
	renderMarkup,
	shapeHasInk,
	shapePaths,
} from "./image-markup";

function shape(over: Partial<MarkupShape> = {}): MarkupShape {
	return {
		id: "s1",
		tool: "arrow",
		color: "#FF3B30",
		points: [
			{ x: 10, y: 10 },
			{ x: 210, y: 110 },
		],
		...over,
	};
}

describe("markupStrokeWidth", () => {
	test("scales with the image so one pen reads the same at any size", () => {
		// A retina capture and a small crop of the same UI should come back
		// looking like the same annotation.
		expect(markupStrokeWidth(2880)).toBeGreaterThan(markupStrokeWidth(1200));
	});

	test("clamps both ends", () => {
		expect(markupStrokeWidth(40)).toBe(3);
		expect(markupStrokeWidth(12000)).toBe(14);
	});

	test("survives a source whose size never resolved", () => {
		expect(markupStrokeWidth(0)).toBeGreaterThan(0);
		expect(markupStrokeWidth(Number.NaN)).toBeGreaterThan(0);
	});
});

describe("markupExportSize", () => {
	test("caps the long edge and keeps the aspect ratio", () => {
		const { width, height, scale } = markupExportSize(2880, 1800);
		expect(width).toBe(MAX_MARKUP_EDGE);
		expect(height).toBe(1250);
		expect(scale).toBeCloseTo(2000 / 2880, 6);
	});

	test("never upscales a small source", () => {
		expect(markupExportSize(640, 400)).toEqual({
			width: 640,
			height: 400,
			scale: 1,
		});
	});

	test("caps on the taller edge too", () => {
		expect(markupExportSize(900, 4000).height).toBe(MAX_MARKUP_EDGE);
	});
});

describe("shapePaths", () => {
	test("an arrow is a shaft plus a head, not one joined stroke", () => {
		const paths = shapePaths(shape(), 6);
		expect(paths).toHaveLength(2);
		expect(paths[0]).toBe("M 10 10 L 210 110");
		// The head ends on the tip from both sides.
		expect(paths[1].split("L")).toHaveLength(3);
	});

	test("the head grows with the stroke, so a short jab still shows one", () => {
		const short = shape({
			points: [
				{ x: 0, y: 0 },
				{ x: 20, y: 0 },
			],
		});
		const thin = shapePaths(short, 2)[1];
		const thick = shapePaths(short, 8)[1];
		expect(thin).not.toBe(thick);
	});

	test("a box normalizes whichever corner you dragged from", () => {
		const downRight = shapePaths(
			shape({
				tool: "box",
				points: [
					{ x: 10, y: 20 },
					{ x: 110, y: 220 },
				],
			}),
			4,
		);
		const upLeft = shapePaths(
			shape({
				tool: "box",
				points: [
					{ x: 110, y: 220 },
					{ x: 10, y: 20 },
				],
			}),
			4,
		);
		expect(downRight).toEqual(upLeft);
		expect(downRight[0].endsWith("Z")).toBe(true);
	});

	test("a pen tap still paints a dot", () => {
		const paths = shapePaths(
			shape({ tool: "pen", points: [{ x: 5, y: 7 }] }),
			4,
		);
		expect(paths).toEqual(["M 5 7 L 5 7"]);
	});

	test("a pen stroke is smoothed rather than a raw polyline", () => {
		const d = shapePaths(
			shape({
				tool: "pen",
				points: [
					{ x: 0, y: 0 },
					{ x: 10, y: 10 },
					{ x: 20, y: 0 },
					{ x: 30, y: 10 },
				],
			}),
			4,
		)[0];
		expect(d).toContain("Q");
	});

	test("an unfinished shape draws nothing rather than throwing", () => {
		expect(shapePaths(shape({ points: [] }), 4)).toEqual([]);
	});
});

describe("shapeHasInk", () => {
	test("a click that never dragged is not an arrow", () => {
		const tap = shape({
			points: [
				{ x: 50, y: 50 },
				{ x: 52, y: 51 },
			],
		});
		expect(shapeHasInk(tap, 6)).toBe(false);
		expect(shapeHasInk(shape(), 6)).toBe(true);
	});

	test("the threshold follows the stroke width", () => {
		const nudge = shape({
			points: [
				{ x: 0, y: 0 },
				{ x: 8, y: 0 },
			],
		});
		expect(shapeHasInk(nudge, 3)).toBe(true);
		expect(shapeHasInk(nudge, 12)).toBe(false);
	});

	test("a deliberate pen dot counts", () => {
		expect(shapeHasInk(shape({ tool: "pen", points: [{ x: 1, y: 1 }] }), 6)).toBe(
			true,
		);
	});
});

describe("markupExportType", () => {
	test("a screenshot round-trips as PNG", () => {
		const t = markupExportType("/media?path=%2Fhome%2Fu%2Fshot.png");
		expect(t.mime).toBe("image/png");
		expect(t.extension).toBe(".png");
		expect(t.losesAnimation).toBe(false);
	});

	test("a photo stays JPEG instead of ballooning", () => {
		const t = markupExportType("/media?path=%2Fhome%2Fu%2Fholiday.jpg");
		expect(t.mime).toBe("image/jpeg");
		expect(t.quality).toBeLessThan(1);
	});

	test("a GIF is flagged, because flattening keeps frame one", () => {
		expect(markupExportType("/media?path=%2Ftmp%2Floop.gif").losesAnimation).toBe(
			true,
		);
	});

	test("reads a data URL's own type", () => {
		expect(markupExportType("data:image/jpeg;base64,AAAA").mime).toBe(
			"image/jpeg",
		);
	});

	test("the filename carries the encoded type, which is all the server has", () => {
		expect(markupFileName("/media?path=%2Ftmp%2Fa.jpg").endsWith(".jpg")).toBe(
			true,
		);
		expect(markupFileName("/media?path=%2Ftmp%2Fa.png").endsWith(".png")).toBe(
			true,
		);
	});
});

describe("remembering what a markup was made from", () => {
	test("a second pass points back at the picture with no ink on it", () => {
		const shapes = [shape()];
		rememberMarkup("/media?path=one", { original: "/media?path=clean", shapes });
		rememberMarkup("/media?path=two", {
			original: "/media?path=one",
			shapes: [...shapes, shape({ id: "s2" })],
		});
		expect(recallMarkup("/media?path=two")?.original).toBe("/media?path=clean");
		expect(recallMarkup("/media?path=two")?.shapes).toHaveLength(2);
	});

	test("an attachment nobody annotated is not remembered", () => {
		expect(recallMarkup("/media?path=never-touched")).toBeUndefined();
	});
});

describe("renderMarkup", () => {
	test("draws every shape in its own colour, at one width", () => {
		const drawn: { d: string; color: string; width: number }[] = [];
		const ctx = {
			strokeStyle: "",
			lineWidth: 0,
			lineCap: "",
			lineJoin: "",
			stroke(path: unknown) {
				drawn.push({
					d: String(path),
					color: this.strokeStyle,
					width: this.lineWidth,
				});
			},
		};
		renderMarkup(
			ctx,
			[shape(), shape({ id: "s2", tool: "box", color: "#0A84FF" })],
			7,
			(d) => d,
		);
		// Arrow contributes two paths, box one.
		expect(drawn).toHaveLength(3);
		expect(drawn[0].color).toBe("#FF3B30");
		expect(drawn[2].color).toBe("#0A84FF");
		expect(new Set(drawn.map((x) => x.width))).toEqual(new Set([7]));
		expect(ctx.lineCap).toBe("round");
	});
});
