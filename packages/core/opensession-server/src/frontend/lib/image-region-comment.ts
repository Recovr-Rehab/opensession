/**
 * Selecting a region of an existing transcript image.
 *
 * Regions stay normalized while they are on screen. The lightbox can resize
 * when a phone keyboard opens, but 0..1 coordinates continue to name the same
 * pixels. The crop is only converted to intrinsic pixels when it is sent.
 */

export interface ImageRegion {
	x: number;
	y: number;
	width: number;
	height: number;
}

export interface ImageRegionPoint {
	x: number;
	y: number;
}

const MAX_CROP_EDGE = 2000;

function clampUnit(value: number): number {
	if (!Number.isFinite(value)) return 0;
	return Math.min(1, Math.max(0, value));
}

/** A drag in either direction, clamped to the image's normalized bounds. */
export function imageRegionBetween(
	start: ImageRegionPoint,
	end: ImageRegionPoint,
): ImageRegion {
	const ax = clampUnit(start.x);
	const ay = clampUnit(start.y);
	const bx = clampUnit(end.x);
	const by = clampUnit(end.y);
	return {
		x: Math.min(ax, bx),
		y: Math.min(ay, by),
		width: Math.abs(bx - ax),
		height: Math.abs(by - ay),
	};
}

/** Pixel rectangle inside a decoded source. Every edge remains in bounds. */
export function imageRegionPixels(
	region: ImageRegion,
	naturalWidth: number,
	naturalHeight: number,
): { x: number; y: number; width: number; height: number } {
	const sourceWidth = Math.max(1, Math.round(naturalWidth) || 1);
	const sourceHeight = Math.max(1, Math.round(naturalHeight) || 1);
	const x = Math.min(sourceWidth - 1, Math.max(0, Math.floor(clampUnit(region.x) * sourceWidth)));
	const y = Math.min(sourceHeight - 1, Math.max(0, Math.floor(clampUnit(region.y) * sourceHeight)));
	const right = Math.min(
		sourceWidth,
		Math.max(x + 1, Math.ceil(clampUnit(region.x + region.width) * sourceWidth)),
	);
	const bottom = Math.min(
		sourceHeight,
		Math.max(y + 1, Math.ceil(clampUnit(region.y + region.height) * sourceHeight)),
	);
	return { x, y, width: right - x, height: bottom - y };
}

/** Output size for the derived attachment. Large retina crops are reduced. */
export function imageRegionOutputSize(
	width: number,
	height: number,
): { width: number; height: number; scale: number } {
	const w = Math.max(1, Math.round(width) || 1);
	const h = Math.max(1, Math.round(height) || 1);
	const scale = Math.min(1, MAX_CROP_EDGE / Math.max(w, h));
	return {
		width: Math.max(1, Math.round(w * scale)),
		height: Math.max(1, Math.round(h * scale)),
		scale,
	};
}

export interface ScreenRect {
	left: number;
	top: number;
	width: number;
	height: number;
}

/**
 * Where the comment card sits relative to the region it is about.
 *
 * Directly under the selection, so the words and the pixels they describe read
 * as one thing. It flips above when the region sits low, and it never leaves
 * the viewport: a card that hangs off the edge of a phone takes the Send button
 * with it.
 */
export function anchoredCommentPosition(
	region: ScreenRect,
	card: { width: number; height: number },
	viewport: { width: number; height: number },
	gap = 10,
	margin = 12,
): { left: number; top: number; placement: "below" | "above" | "clamped" } {
	const maxLeft = Math.max(margin, viewport.width - card.width - margin);
	const left = Math.min(Math.max(margin, region.left), maxLeft);
	const below = region.top + region.height + gap;
	if (below + card.height <= viewport.height - margin) {
		return { left, top: below, placement: "below" };
	}
	const above = region.top - gap - card.height;
	if (above >= margin) return { left, top: above, placement: "above" };
	return {
		left,
		top: Math.max(margin, viewport.height - card.height - margin),
		placement: "clamped",
	};
}

async function decodedImage(blob: Blob): Promise<{
	source: CanvasImageSource;
	width: number;
	height: number;
	close: () => void;
}> {
	if (typeof createImageBitmap === "function") {
		const bitmap = await createImageBitmap(blob);
		return {
			source: bitmap,
			width: bitmap.width,
			height: bitmap.height,
			close: () => bitmap.close(),
		};
	}

	const url = URL.createObjectURL(blob);
	const image = new Image();
	try {
		await new Promise<void>((resolve, reject) => {
			image.onload = () => resolve();
			image.onerror = () => reject(new Error("Could not read this image"));
			image.src = url;
		});
		return {
			source: image,
			width: image.naturalWidth,
			height: image.naturalHeight,
			close: () => URL.revokeObjectURL(url),
		};
	} catch (error) {
		URL.revokeObjectURL(url);
		throw error;
	}
}

function canvasBlob(canvas: HTMLCanvasElement): Promise<Blob> {
	return new Promise((resolve, reject) => {
		canvas.toBlob(
			(blob) => (blob ? resolve(blob) : reject(new Error("Could not create the selected image"))),
			"image/png",
		);
	});
}

/**
 * Fetch and crop an image into a normal PNG attachment.
 *
 * Internal transcript images use authenticated same-origin routes. An external
 * image only works when its host allows browser reads through CORS. A blocked
 * source fails plainly instead of silently sending the full image.
 */
export async function cropImageRegionFile(
	src: string,
	region: ImageRegion,
): Promise<File> {
	let response: Response;
	try {
		response = await fetch(src, { credentials: "same-origin" });
	} catch {
		throw new Error("This image cannot be selected from its source");
	}
	if (!response.ok) throw new Error("Could not load this image for selection");
	const blob = await response.blob();
	if (blob.type && !blob.type.startsWith("image/")) {
		throw new Error("This source is not an image");
	}

	const decoded = await decodedImage(blob);
	try {
		const crop = imageRegionPixels(region, decoded.width, decoded.height);
		const output = imageRegionOutputSize(crop.width, crop.height);
		const canvas = document.createElement("canvas");
		canvas.width = output.width;
		canvas.height = output.height;
		const context = canvas.getContext("2d");
		if (!context) throw new Error("Image selection is unavailable in this browser");
		context.drawImage(
			decoded.source,
			crop.x,
			crop.y,
			crop.width,
			crop.height,
			0,
			0,
			output.width,
			output.height,
		);
		const result = await canvasBlob(canvas);
		return new File([result], `image-comment-${Date.now()}.png`, {
			type: "image/png",
		});
	} catch (error) {
		if (error instanceof Error) throw error;
		throw new Error("Could not create the selected image");
	} finally {
		decoded.close();
	}
}
