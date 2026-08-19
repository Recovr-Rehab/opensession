/**
 * Screenshot markup: the geometry behind drawing on an attached image.
 *
 * The point of the feature is "look at THIS": a screenshot goes into the
 * composer, you put an arrow on the button that is wrong, you type the
 * sentence, you send. Everything here is the part of that which can be
 * reasoned about without a DOM, so it can be tested and so the editor
 * (components/ImageMarkup.tsx) stays about pointers and layout.
 *
 * One rule decides most of this file: **a shape is stored in the image's own
 * natural pixels**, never in the coordinates of the box it is being drawn in.
 * A viewport is temporary. Resize the window mid-edit, rotate a phone, open
 * the same picture on a desktop after starting on a phone, and display-space
 * shapes are all in the wrong place. Natural space also makes the export a
 * plain render rather than a second transform, and it makes the SVG overlay
 * free: give it `viewBox="0 0 naturalW naturalH"` and the browser scales the
 * ink for us at whatever size the picture is being shown.
 *
 * The same reasoning sets the stroke width. It is derived from the image, not
 * chosen in CSS pixels, so a phone edit and a desktop edit of the same
 * screenshot produce the same file.
 */

/**
 * What a stroke is.
 *
 * `note` is the one that carries words: you drag a box around a region and
 * then say what is wrong with THAT region, and the sentence leaves with the
 * picture as a numbered line. The other three are silent ink, for when
 * pointing is the whole message: an arrow points, a box frames, a pen circles.
 */
export type MarkupTool = "note" | "arrow" | "box" | "pen";

export interface MarkupPoint {
	x: number;
	y: number;
}

export interface MarkupShape {
	id: string;
	tool: MarkupTool;
	color: string;
	/** Points in NATURAL image pixels. Arrow, box and note carry exactly two
	 *  (start, end); pen carries the sampled path. */
	points: MarkupPoint[];
	/** What this region is about. Present only on a `note`, and only once its
	 *  text has been committed, which is what separates a finished note from
	 *  the box still waiting for someone to type into it. */
	note?: string;
}

/** The notes on a set of shapes, in the order they were drawn, which is the
 *  order their badges are numbered in. */
export function noteTexts(shapes: MarkupShape[]): string[] {
	const notes: string[] = [];
	for (const shape of shapes) if (shape.note) notes.push(shape.note);
	return notes;
}

/**
 * Fold the notes into the message being written.
 *
 * Numbered, because the badges on the picture are numbered: "2. this amount is
 * stale" is only useful next to a 2 drawn around the amount. Appended rather
 * than prepended so whatever was already typed stays the opening sentence, and
 * separated by a blank line so a paragraph and a list do not run together.
 */
export function appendImageNotes(text: string, notes: string[]): string {
	const lines = notes
		.map((note, i) => `${i + 1}. ${note.trim()}`)
		.filter((line) => line.length > 3)
		.join("\n");
	if (!lines) return text;
	const base = text.replace(/\s+$/, "");
	return base ? `${base}\n\n${lines}` : lines;
}

/**
 * Annotation ink, which is deliberately NOT the theme's tokens.
 *
 * Every other colour in this app resolves against the app's own surface. This
 * one has to read on top of whatever the user screenshotted, which is often
 * another app entirely, so the palette is fixed and high-chroma. These are the
 * system accents (Apple's red/orange/green/blue) plus a neutral pair, because
 * a red arrow on a red error banner is invisible and the fix is a second
 * colour rather than a cleverer stroke.
 */
export const MARKUP_COLORS: { id: string; name: string; value: string }[] = [
	{ id: "red", name: "Red", value: "#FF3B30" },
	{ id: "orange", name: "Orange", value: "#FF9F0A" },
	{ id: "green", name: "Green", value: "#30D158" },
	{ id: "blue", name: "Blue", value: "#0A84FF" },
	{ id: "white", name: "White", value: "#FFFFFF" },
	{ id: "black", name: "Black", value: "#101114" },
];

export const DEFAULT_MARKUP_COLOR = MARKUP_COLORS[0].value;

/**
 * How thick a stroke is, in natural image pixels.
 *
 * Derived from the image's width so the ink is a constant FRACTION of the
 * picture. A 2880px retina screenshot and a 720px crop of it should come back
 * looking like the same pen. The floor keeps a thumbnail-sized source from
 * getting a hairline; the ceiling keeps a very wide capture from getting a
 * marker.
 */
export function markupStrokeWidth(naturalWidth: number): number {
	if (!Number.isFinite(naturalWidth) || naturalWidth <= 0) return 4;
	return Math.min(14, Math.max(3, Math.round(naturalWidth / 340)));
}

/**
 * Longest edge of the exported file.
 *
 * The consumer is a vision model and a chat transcript, and both downscale
 * well below this. Re-encoding a 2880x1800 retina capture as a lossless PNG
 * spends megabytes on detail nothing downstream reads, and a thin arrow can
 * disappear in the model-side resize anyway. Capping here keeps the upload
 * small and keeps the annotation proportionally thick.
 */
export const MAX_MARKUP_EDGE = 2000;

/** Pixel size of the exported image, and the scale from natural space to it. */
export function markupExportSize(
	naturalWidth: number,
	naturalHeight: number,
): { width: number; height: number; scale: number } {
	const w = Math.max(1, Math.round(naturalWidth) || 1);
	const h = Math.max(1, Math.round(naturalHeight) || 1);
	const scale = Math.min(1, MAX_MARKUP_EDGE / Math.max(w, h));
	return {
		width: Math.max(1, Math.round(w * scale)),
		height: Math.max(1, Math.round(h * scale)),
		scale,
	};
}

/** Trim coordinates to one decimal. A path string carries no more precision
 *  than a tenth of a source pixel usefully, and the short form keeps the
 *  in-memory shape list small enough to be worth remembering. */
function n(v: number): number {
	return Math.round(v * 10) / 10;
}

function line(a: MarkupPoint, b: MarkupPoint): string {
	return `M ${n(a.x)} ${n(a.y)} L ${n(b.x)} ${n(b.y)}`;
}

/**
 * The two barbs of an arrow head, as one open path so round joins land on the
 * tip. Length grows with the shaft but is bounded by the stroke, so a short
 * jab still gets a head you can see and a long sweep does not get a spear.
 */
function arrowHead(
	from: MarkupPoint,
	to: MarkupPoint,
	strokeWidth: number,
): string {
	const dx = to.x - from.x;
	const dy = to.y - from.y;
	const len = Math.hypot(dx, dy) || 1;
	const head = Math.min(Math.max(strokeWidth * 3.2, len * 0.22), len * 0.6);
	const angle = Math.atan2(dy, dx);
	const spread = 0.42; // ~24 degrees off the shaft, on each side.
	const a = {
		x: to.x - head * Math.cos(angle - spread),
		y: to.y - head * Math.sin(angle - spread),
	};
	const b = {
		x: to.x - head * Math.cos(angle + spread),
		y: to.y - head * Math.sin(angle + spread),
	};
	return `M ${n(a.x)} ${n(a.y)} L ${n(to.x)} ${n(to.y)} L ${n(b.x)} ${n(b.y)}`;
}

/** A freehand stroke, smoothed by running quadratics through the midpoints of
 *  the sampled points. Raw polyline segments read as a jagged mouse trail at
 *  export resolution; this costs nothing and looks like a pen. */
function penPath(points: MarkupPoint[]): string {
	if (points.length === 1) {
		// A tap still has to paint something, or the dot the user placed
		// vanishes. A zero-length segment with a round cap is that dot.
		const p = points[0];
		return `M ${n(p.x)} ${n(p.y)} L ${n(p.x)} ${n(p.y)}`;
	}
	let d = `M ${n(points[0].x)} ${n(points[0].y)}`;
	for (let i = 1; i < points.length - 1; i++) {
		const mid = {
			x: (points[i].x + points[i + 1].x) / 2,
			y: (points[i].y + points[i + 1].y) / 2,
		};
		d += ` Q ${n(points[i].x)} ${n(points[i].y)} ${n(mid.x)} ${n(mid.y)}`;
	}
	const last = points[points.length - 1];
	d += ` L ${n(last.x)} ${n(last.y)}`;
	return d;
}

/**
 * SVG path data for one shape, in natural image coordinates.
 *
 * Returns a LIST because an arrow is two strokes (shaft and head) that must
 * not be joined into one, and because the same strings drive both the live
 * SVG overlay and the export canvas. One geometry, drawn twice, so what you
 * saw is what gets sent.
 */
export function shapePaths(shape: MarkupShape, strokeWidth: number): string[] {
	const [a, b] = shape.points;
	if (shape.tool === "pen") {
		return shape.points.length ? [penPath(shape.points)] : [];
	}
	if (!a || !b) return [];
	if (shape.tool === "arrow") return [line(a, b), arrowHead(a, b, strokeWidth)];
	const x0 = n(Math.min(a.x, b.x));
	const y0 = n(Math.min(a.y, b.y));
	const x1 = n(Math.max(a.x, b.x));
	const y1 = n(Math.max(a.y, b.y));
	return [`M ${x0} ${y0} L ${x1} ${y0} L ${x1} ${y1} L ${x0} ${y1} Z`];
}

/**
 * Whether a shape is a mark or an accident.
 *
 * A click that does not drag is not an arrow, and a box with no area is not a
 * region. Both happen constantly while aiming, and both would otherwise leave
 * an invisible entry that Undo has to be pressed twice for. Measured against
 * the stroke width rather than a fixed pixel count, since everything else here
 * scales with the image too. The pen is exempt: a deliberate dot is a mark.
 */
export function shapeHasInk(shape: MarkupShape, strokeWidth: number): boolean {
	if (shape.tool === "pen") return shape.points.length > 0;
	const [a, b] = shape.points;
	if (!a || !b) return false;
	return Math.hypot(b.x - a.x, b.y - a.y) > strokeWidth * 1.5;
}

/**
 * The file type the annotated copy is written as.
 *
 * PNG for screenshots, which is what almost everything here is: flat UI
 * re-encodes cleanly and the arrow's edges stay crisp. A photo source (JPEG)
 * stays JPEG, because a lossless re-encode of a camera image is many times
 * the original for no gain anybody can see. A GIF cannot survive this at all:
 * drawing it to a canvas keeps frame one, so the caller is told to say so.
 */
export function markupExportType(src: string): {
	mime: string;
	extension: string;
	quality?: number;
	/** True when flattening destroys something the source had. */
	losesAnimation: boolean;
} {
	const lower = src.toLowerCase();
	const isJpeg = /\.jpe?g(\?|$)|%2ejpe?g|data:image\/jpeg/.test(lower);
	const isGif = /\.gif(\?|$)|%2egif|data:image\/gif/.test(lower);
	if (isJpeg)
		return {
			mime: "image/jpeg",
			extension: ".jpg",
			quality: 0.9,
			losesAnimation: false,
		};
	return { mime: "image/png", extension: ".png", losesAnimation: isGif };
}

/** Name for the annotated upload. The extension is the only record of an
 *  image's type once it is staged (see server/uploads.ts), so it has to match
 *  what was encoded. */
export function markupFileName(src: string): string {
	return `markup-${Date.now()}${markupExportType(src).extension}`;
}

/**
 * What the annotated image was made from, kept for the length of the page
 * session only.
 *
 * Saving flattens the shapes into pixels and REPLACES the attachment, because
 * sending both copies means the agent gets two near-identical screenshots and
 * the composer grows a duplicate tile. That trade is only fair if you can get
 * back in, so the original ref and the shape list are remembered here and the
 * editor reopens on them: move the arrow, change your mind, remove the markup
 * entirely.
 *
 * Deliberately in memory rather than in the draft. The composer's durable
 * outbox persists drafts to localStorage, where the whole origin gets about
 * 5MB and the `images` entries are plain strings by design (lib/images.ts
 * explains what base64 in that budget does to the app). A shape list is small,
 * but widening the persisted draft schema is a migration, and losing
 * re-editability across a reload costs a user one flattened picture. So: not
 * yet, and not for free.
 */
const remembered = new Map<string, { original: string; shapes: MarkupShape[] }>();

export function rememberMarkup(
	ref: string,
	entry: { original: string; shapes: MarkupShape[] },
): void {
	// Chain through: annotating an annotated image still points back at the
	// picture that had no ink on it, so "Remove markup" always lands on the
	// original rather than on the previous pass.
	const root = remembered.get(entry.original);
	remembered.set(ref, {
		original: root?.original ?? entry.original,
		shapes: entry.shapes,
	});
}

export function recallMarkup(
	ref: string,
): { original: string; shapes: MarkupShape[] } | undefined {
	return remembered.get(ref);
}

/**
 * A note's numbered badge, in natural image pixels.
 *
 * It sits ON the region's top-left corner rather than beside it, so the number
 * cannot drift away from the thing it numbers when the box is small. Clamped
 * into the picture when bounds are given, because a region drawn against an
 * edge (which is most of them: the thing that is wrong is usually in a corner)
 * would otherwise have half its badge cropped off by the export.
 */
export function noteBadge(
	shape: MarkupShape,
	strokeWidth: number,
	bounds?: { w: number; h: number },
): { cx: number; cy: number; r: number } | null {
	const [a, b] = shape.points;
	if (!a || !b) return null;
	const r = Math.max(strokeWidth * 2.4, 9);
	let cx = Math.min(a.x, b.x);
	let cy = Math.min(a.y, b.y);
	if (bounds) {
		cx = Math.min(Math.max(cx, r), Math.max(r, bounds.w - r));
		cy = Math.min(Math.max(cy, r), Math.max(r, bounds.h - r));
	}
	return { cx: n(cx), cy: n(cy), r: n(r) };
}

/** What a number is written in, on top of its own badge. Every ink in the
 *  palette carries white except the white one, which would be invisible. */
export function badgeInk(color: string): string {
	return /^#f{3,}$|^#ffffff$/i.test(color.trim()) ? "#101114" : "#FFFFFF";
}

/** A circle as path data, so the badge draws through the same makePath seam as
 *  every other mark instead of needing an arc() on the context interface. */
function circlePath(cx: number, cy: number, r: number): string {
	return `M ${n(cx - r)} ${n(cy)} A ${n(r)} ${n(r)} 0 1 0 ${n(cx + r)} ${n(cy)} A ${n(r)} ${n(r)} 0 1 0 ${n(cx - r)} ${n(cy)} Z`;
}

/** Minimal 2D-context surface used by the export path, so this module stays
 *  free of DOM lib assumptions and remains testable with a fake. */
export interface MarkupContext {
	/** A real 2D context also accepts a gradient or a pattern here. Markup only
	 *  ever writes a colour string, but the type has to admit the wider DOM one
	 *  or CanvasRenderingContext2D does not satisfy this interface. `object`
	 *  rather than the DOM types keeps this module free of the DOM lib. */
	strokeStyle: string | object;
	fillStyle: string | object;
	lineWidth: number;
	lineCap: string;
	lineJoin: string;
	font: string;
	textAlign: string;
	textBaseline: string;
	stroke(path: unknown): void;
	fill(path: unknown): void;
	fillText(text: string, x: number, y: number): void;
}

/**
 * Draw the shapes onto an export context, in natural coordinates.
 *
 * The caller sets up the transform (see markupExportSize) and has already
 * drawn the source image, so this only puts ink down. `makePath` is passed in
 * rather than referencing Path2D directly for the same reason as
 * MarkupContext.
 */
export function renderMarkup(
	ctx: MarkupContext,
	shapes: MarkupShape[],
	strokeWidth: number,
	makePath: (d: string) => unknown,
	bounds?: { w: number; h: number },
): void {
	ctx.lineCap = "round";
	ctx.lineJoin = "round";
	ctx.lineWidth = strokeWidth;
	let number = 0;
	for (const shape of shapes) {
		ctx.strokeStyle = shape.color;
		for (const d of shapePaths(shape, strokeWidth)) ctx.stroke(makePath(d));
		if (!shape.note) continue;
		// The badge is drawn in the same pass as its region, so the numbering in
		// the picture is draw order, which is the order the notes leave in.
		number += 1;
		const badge = noteBadge(shape, strokeWidth, bounds);
		if (!badge) continue;
		ctx.fillStyle = shape.color;
		ctx.fill(makePath(circlePath(badge.cx, badge.cy, badge.r)));
		ctx.fillStyle = badgeInk(shape.color);
		ctx.font = `600 ${Math.round(badge.r * 1.25)}px system-ui, -apple-system, sans-serif`;
		ctx.textAlign = "center";
		ctx.textBaseline = "middle";
		ctx.fillText(String(number), badge.cx, badge.cy);
	}
}
