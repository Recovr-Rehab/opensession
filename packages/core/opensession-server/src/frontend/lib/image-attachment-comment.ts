import type { ImageRegion } from "./image-region-comment";

const IMAGE_REFERENCE_RE = /\[Image (\d+) · (\d+)–(\d+)% × (\d+)–(\d+)%\][ \t]?/g;

function percent(value: number): number {
	return Math.min(100, Math.max(0, Math.round(value * 100)));
}

/** A compact, model-readable reference to one selected area of an attachment. */
export function imageAttachmentReference(
	index: number,
	region: ImageRegion,
): string {
	const left = percent(region.x);
	const top = percent(region.y);
	const right = percent(region.x + region.width);
	const bottom = percent(region.y + region.height);
	return `[Image ${index + 1} · ${left}–${right}% × ${top}–${bottom}%]`;
}

/** Add one complete image comment to the message being composed. */
export function appendImageAttachmentComment(
	text: string,
	index: number,
	region: ImageRegion,
	comment: string,
): string {
	const said = comment.trim();
	if (!said) return text;
	const line = `${imageAttachmentReference(index, region)} ${said}`;
	const base = text.replace(/\s+$/, "");
	return base ? `${base}\n${line}` : line;
}

/** Keep later attachment numbers correct when an earlier image is removed.
 * References to the removed image lose their token but keep the person's text. */
export function rebaseImageAttachmentReferences(
	text: string,
	removedIndex: number,
): string {
	const removedNumber = removedIndex + 1;
	return text.replace(
		IMAGE_REFERENCE_RE,
		(reference, rawNumber: string) => {
			const number = Number(rawNumber);
			if (number === removedNumber) return "";
			if (number < removedNumber) return reference;
			return reference.replace(`Image ${number}`, `Image ${number - 1}`);
		},
	);
}
