import { composerSessionRanges, type SessionRange } from "./composer-highlight";
import { sessionTitleFor } from "./markdown";

export interface DisplaySessionRange extends SessionRange {
	canonicalStart: number;
	canonicalEnd: number;
	label?: string;
}

export interface ComposerSessionProjection {
	canonicalText: string;
	displayText: string;
	sessions: DisplaySessionRange[];
}

function codeRanges(text: string): Array<{ start: number; end: number }> {
	const ranges: Array<{ start: number; end: number }> = [];
	const fences = /```[\s\S]*?```|```[\s\S]*$/g;
	for (let match = fences.exec(text); match; match = fences.exec(text))
		ranges.push({ start: match.index, end: match.index + match[0].length });

	const inline = /`[^`\n]+`/g;
	for (let match = inline.exec(text); match; match = inline.exec(text)) {
		const start = match.index;
		if (!ranges.some((range) => start >= range.start && start < range.end))
			ranges.push({ start, end: start + match[0].length });
	}
	return ranges;
}

/** Show known session names while retaining canonical ids in draft state. */
export function projectComposerSessions(
	canonicalText: string,
): ComposerSessionProjection {
	const sessions: DisplaySessionRange[] = [];
	const protectedRanges = codeRanges(canonicalText);
	let displayText = "";
	let canonicalCursor = 0;
	for (const range of composerSessionRanges(canonicalText)) {
		if (
			protectedRanges.some(
				(protectedRange) =>
					range.start >= protectedRange.start && range.start < protectedRange.end,
			)
		)
			continue;
		displayText += canonicalText.slice(canonicalCursor, range.start);
		const label = sessionTitleFor(range.id);
		const start = displayText.length;
		displayText += label ?? range.id;
		sessions.push({
			start,
			end: displayText.length,
			id: range.id,
			canonicalStart: range.start,
			canonicalEnd: range.end,
			label,
		});
		canonicalCursor = range.end;
	}
	displayText += canonicalText.slice(canonicalCursor);
	return { canonicalText, displayText, sessions };
}

export function composerCanonicalOffset(
	projection: ComposerSessionProjection,
	offset: number,
): number {
	let delta = 0;
	for (const session of projection.sessions) {
		if (offset <= session.start) return offset + delta;
		if (offset < session.end) return session.canonicalStart;
		delta +=
			session.canonicalEnd -
			session.canonicalStart -
			(session.end - session.start);
	}
	return offset + delta;
}

/**
 * Apply one native textarea edit to canonical text. An edit that touches a
 * named session consumes the whole token, matching its atomic presentation.
 */
export function applyComposerSessionEdit(
	projection: ComposerSessionProjection,
	nextDisplayText: string,
	selectionStart = nextDisplayText.length,
	selectionEnd = selectionStart,
): {
	canonicalText: string;
	canonicalSelectionStart: number;
	canonicalSelectionEnd: number;
	touchedSession: boolean;
} {
	const previous = projection.displayText;
	let start = 0;
	while (
		start < previous.length &&
		start < nextDisplayText.length &&
		previous[start] === nextDisplayText[start]
	)
		start++;

	let previousEnd = previous.length;
	let nextEnd = nextDisplayText.length;
	while (
		previousEnd > start &&
		nextEnd > start &&
		previous[previousEnd - 1] === nextDisplayText[nextEnd - 1]
	) {
		previousEnd--;
		nextEnd--;
	}

	const touched = projection.sessions.filter(
		(session) =>
			(start < session.end && previousEnd > session.start) ||
			(start === previousEnd && start > session.start && start < session.end),
	);
	const mappedStart = composerCanonicalOffset(projection, start);
	const mappedEnd = composerCanonicalOffset(projection, previousEnd);
	const canonicalStart = touched.length
		? Math.min(mappedStart, ...touched.map((session) => session.canonicalStart))
		: mappedStart;
	const canonicalEnd = touched.length
		? Math.max(mappedEnd, ...touched.map((session) => session.canonicalEnd))
		: mappedEnd;
	const inserted = nextDisplayText.slice(start, nextEnd);
	const canonicalText =
		projection.canonicalText.slice(0, canonicalStart) +
		inserted +
		projection.canonicalText.slice(canonicalEnd);
	const insertedSelectionStart = Math.max(
		0,
		Math.min(inserted.length, selectionStart - start),
	);
	const insertedSelectionEnd = Math.max(
		insertedSelectionStart,
		Math.min(inserted.length, selectionEnd - start),
	);
	return {
		canonicalText,
		canonicalSelectionStart: canonicalStart + insertedSelectionStart,
		canonicalSelectionEnd: canonicalStart + insertedSelectionEnd,
		touchedSession: touched.length > 0,
	};
}

/** Translate a canonical caret position into the projected field. */
export function composerDisplayOffset(
	projection: ComposerSessionProjection,
	canonicalOffset: number,
): number {
	let delta = 0;
	for (const session of projection.sessions) {
		if (canonicalOffset <= session.canonicalStart) return canonicalOffset + delta;
		if (canonicalOffset < session.canonicalEnd) return session.start;
		delta +=
			session.end -
			session.start -
			(session.canonicalEnd - session.canonicalStart);
	}
	return canonicalOffset + delta;
}
