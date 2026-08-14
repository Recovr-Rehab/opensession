// Live styling for the composer draft: code markup, and @-mentions of
// teammates. The draft stays a plain <textarea> (native caret, selection,
// undo, IME); a metrics-identical mirror div behind it paints this HTML.
// Because the mirror must line up glyph-for-glyph with the textarea, styling
// is COLOR/BACKGROUND ONLY, plus the mention pill's outline, which paints
// outside the box. The markup here never adds padding, font, or size changes.

import type { Person } from "./people";

function esc(s: string): string {
	return s
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;");
}

/** One finished @-mention of a teammate, as offsets into the draft. */
export interface MentionRange {
	start: number;
	/** Exclusive: the character after the name. */
	end: number;
	/** Roster spelling, which may differ in case from what was typed. */
	name: string;
}

/** An `@` that starts a word, and the name after it. */
const MENTION_RE = /(^|[\s(\[])@([A-Za-z][\w.-]*)/g;
/** What may follow a name for it to count as finished. */
const TERMINATOR = /[\s.,;:!?)\]]/;

/**
 * The finished mentions in a draft. "Finished" is the whole point: a name only
 * chips once something terminates it, so `@Kent` doesn't pill while someone is
 * still typing `@Kentucky` and no name flashes mid-word. The picker inserts a
 * trailing space, so a picked mention chips the moment it lands; a typed one
 * chips on the next space.
 *
 * Only roster names count. Prose is full of `@` that means nothing to us — an
 * email address, a handle on another service — and chipping those would invent
 * a teammate (same rule as lib/mention-text.ts and the markdown renderer).
 */
export function composerMentionRanges(
	text: string,
	people: Person[],
): MentionRange[] {
	if (!people.length || !text.includes("@")) return [];
	const out: MentionRange[] = [];
	MENTION_RE.lastIndex = 0;
	for (let m = MENTION_RE.exec(text); m; m = MENTION_RE.exec(text)) {
		// Trailing punctuation belongs to the sentence, not to the name.
		const name = m[2]!.replace(/[.,;:!?]+$/, "");
		if (!name) continue;
		const start = m.index + m[1]!.length;
		const end = start + 1 + name.length;
		const after = text[end];
		if (after === undefined || !TERMINATOR.test(after)) continue;
		const person = people.find(
			(p) =>
				p.name.toLowerCase() === name.toLowerCase() ||
				p.fullName.toLowerCase() === name.toLowerCase(),
		);
		if (person) out.push({ start, end, name: person.name });
	}
	return out;
}

/** Mentions inside a plain (non-code) run of the draft. */
function mentions(
	text: string,
	from: number,
	to: number,
	ranges: MentionRange[],
): string {
	let out = "";
	let last = from;
	for (const range of ranges) {
		if (range.start < last || range.end > to) continue;
		out += esc(text.slice(last, range.start));
		out += `<span class="cmp-mention">${esc(text.slice(range.start, range.end))}</span>`;
		last = range.end;
	}
	return out + esc(text.slice(last, to));
}

/** Wrap `inline code` spans within a non-fence segment. A mention inside code
 * stays plain — it is quoted text, not somebody being addressed. */
function inlineCode(
	text: string,
	from: number,
	to: number,
	ranges: MentionRange[],
): string {
	const seg = text.slice(from, to);
	let out = "";
	let last = from;
	const re = /`[^`\n]+`/g;
	let m: RegExpExecArray | null;
	while ((m = re.exec(seg))) {
		const at = from + m.index;
		out += mentions(text, last, at, ranges);
		out += `<span class="cmp-code">${esc(m[0])}</span>`;
		last = at + m[0].length;
	}
	return out + mentions(text, last, to, ranges);
}

/**
 * Render a composer draft to mirror HTML: ``` fences (closed, or open-ended
 * while still being typed) become .cmp-fence, `inline code` becomes .cmp-code,
 * and a finished @-mention becomes .cmp-mention. Inline backticks inside a
 * fence are left alone. A trailing zero-width space keeps the mirror's last
 * line from collapsing when the draft ends in \n.
 */
export function composerHighlightHtml(
	text: string,
	people: Person[] = [],
): string {
	const ranges = composerMentionRanges(text, people);
	let out = "";
	let last = 0;
	const re = /```[\s\S]*?```|```[\s\S]*$/g;
	let m: RegExpExecArray | null;
	while ((m = re.exec(text))) {
		out += inlineCode(text, last, m.index, ranges);
		out += `<span class="cmp-fence">${esc(m[0])}</span>`;
		last = m.index + m[0].length;
	}
	out += inlineCode(text, last, text.length, ranges);
	return out + "​";
}

/** Only mount the mirror when the draft has something to paint — code markup
 * or a finished mention. Plain drafts keep the stock opaque textarea (zero
 * desync risk). */
export function needsComposerHighlight(
	text: string,
	people: Person[] = [],
): boolean {
	return text.includes("`") || composerMentionRanges(text, people).length > 0;
}
