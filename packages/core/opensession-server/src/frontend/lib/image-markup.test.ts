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
	appendImageNotes,
	badgeInk,
	noteBadge,
	noteTexts,
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

function note(id: string, text: string, color = "#FF3B30") {
	return {
		id,
		tool: "note" as const,
		color,
		points: [
			{ x: 200, y: 120 },
			{ x: 400, y: 260 },
		],
		note: text,
	};
}

describe("noteBadge", () => {
	test("sits on the region's own top-left corner", () => {
		const badge = noteBadge(note("n1", "wrong colour"), 6);

		// The number belongs to the box, so it rides the corner rather than
		// floating beside it where a small region would lose track of it.
		expect(badge?.cx).toBe(200);
		expect(badge?.cy).toBe(120);
		expect(badge?.r).toBeGreaterThan(6);
	});

	test("a region against the edge keeps its whole badge", () => {
		const corner = { ...note("n1", "this bit"), points: [
			{ x: 0, y: 0 },
			{ x: 120, y: 90 },
		] };

		const badge = noteBadge(corner, 6, { w: 1200, h: 700 });

		// Undrawn ink is worse than misplaced ink: a badge half outside the
		// picture is cropped by the export and the number is simply gone.
		expect(badge?.cx).toBe(badge?.r);
		expect(badge?.cy).toBe(badge?.r);
	});

	test("an unfinished region has no badge to draw", () => {
		expect(noteBadge({ ...note("n1", "x"), points: [] }, 6)).toBeNull();
	});

	test("the number is written in ink that shows on its own badge", () => {
		expect(badgeInk("#FF3B30")).toBe("#FFFFFF");
		expect(badgeInk("#FFFFFF")).toBe("#101114");
	});
});

describe("the notes a picture carries", () => {
	test("reads them in draw order, ignoring silent ink", () => {
		const shapes = [
			shape({ id: "a" }),
			note("n1", "this should be secondary"),
			shape({ id: "b", tool: "box" }),
			note("n2", "this amount is stale"),
		];

		expect(noteTexts(shapes)).toEqual([
			"this should be secondary",
			"this amount is stale",
		]);
	});

	test("the message numbers the lines the way the picture numbers the boxes", () => {
		const out = appendImageNotes("", ["button is wrong", "amount is stale"]);

		expect(out).toBe("1. button is wrong\n2. amount is stale");
	});

	test("what was already typed stays the opening sentence", () => {
		const out = appendImageNotes("Two things on the billing screen:", [
			"button is wrong",
		]);

		expect(out).toBe(
			"Two things on the billing screen:\n\n1. button is wrong",
		);
	});

	test("a trailing newline does not become a third blank line", () => {
		expect(appendImageNotes("Look here:\n\n", ["fix it"])).toBe(
			"Look here:\n\n1. fix it",
		);
	});

	test("an image with nothing said about it leaves the message alone", () => {
		expect(appendImageNotes("just a screenshot", [])).toBe("just a screenshot");
	});
});

describe("renderMarkup", () => {
	function fakeContext() {
		const strokes: { d: string; color: string; width: number }[] = [];
		const fills: { d: string; color: string }[] = [];
		const texts: { text: string; x: number; y: number; color: string }[] = [];
		const ctx = {
			strokeStyle: "",
			fillStyle: "",
			lineWidth: 0,
			lineCap: "",
			lineJoin: "",
			font: "",
			textAlign: "",
			textBaseline: "",
			stroke(path: unknown) {
				strokes.push({
					d: String(path),
					color: String(ctx.strokeStyle),
					width: ctx.lineWidth,
				});
			},
			fill(path: unknown) {
				fills.push({ d: String(path), color: String(ctx.fillStyle) });
			},
			fillText(text: string, x: number, y: number) {
				texts.push({ text, x, y, color: String(ctx.fillStyle) });
			},
		};
		return { ctx, strokes, fills, texts };
	}

	test("draws every shape in its own colour, at one width", () => {
		const { ctx, strokes } = fakeContext();

		renderMarkup(
			ctx,
			[shape(), shape({ id: "s2", tool: "box", color: "#0A84FF" })],
			7,
			(d) => d,
		);

		// Arrow contributes two paths, box one.
		expect(strokes).toHaveLength(3);
		expect(strokes[0].color).toBe("#FF3B30");
		expect(strokes[2].color).toBe("#0A84FF");
		expect(new Set(strokes.map((x) => x.width))).toEqual(new Set([7]));
		expect(ctx.lineCap).toBe("round");
	});

	test("a note draws its region, then its number on top of it", () => {
		const { ctx, strokes, fills, texts } = fakeContext();

		renderMarkup(ctx, [note("n1", "this button is wrong")], 6, (d) => d);

		expect(strokes).toHaveLength(1);
		expect(fills).toHaveLength(1);
		expect(fills[0].color).toBe("#FF3B30");
		expect(texts).toEqual([
			{ text: "1", x: 200, y: 120, color: "#FFFFFF" },
		]);
		expect(ctx.textBaseline).toBe("middle");
	});

	test("the numbers follow draw order and skip the silent tools", () => {
		const { ctx, texts } = fakeContext();

		renderMarkup(
			ctx,
			[
				shape({ id: "arrow" }),
				note("n1", "first"),
				shape({ id: "box", tool: "box" }),
				note("n2", "second"),
			],
			6,
			(d) => d,
		);

		// An arrow between two notes must not consume a number: the picture and
		// the message would then disagree about which sentence is about what.
		expect(texts.map((t) => t.text)).toEqual(["1", "2"]);
	});
});
