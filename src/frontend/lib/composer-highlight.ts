// Live styling for the composer draft: code markup, and @-mentions of
// teammates. The draft stays a plain <textarea> (native caret, selection,
// undo, IME); a metrics-identical mirror div behind it paints this HTML.
// Because the mirror must line up glyph-for-glyph with the textarea, styling
// is COLOR/BACKGROUND ONLY, plus the mention pill's outline, which paints
// outside the box. The markup here never adds padding, font, or size changes.

import type { Person } from "./people";
import { UUIDV7 } from "./session-url";

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
	/** GitHub login, when they have one — the pill's face comes from it. */
	github?: string;
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
		if (person)
			out.push({ start, end, name: person.name, github: person.github });
	}
	return out;
}

/** One session id in the draft, as offsets into it. */
export interface SessionRange {
	start: number;
	/** Exclusive. */
	end: number;
	id: string;
	/** Visible title when the textarea is projecting this id as a named token. */
	label?: string;
}

/**
 * A minted session id standing on its own. The leading guard is what keeps the
 * pill off the tail of a session URL still sitting in the draft: the renderer
 * chips that URL whole, so painting a pill over its last forty characters
 * would promise a chip in a place no chip appears.
 */
const SESSION_RE = new RegExp(`(^|[^\\w/-])((?:os|bks)-${UUIDV7})`, "gi");

/**
 * The session ids in a draft. Only the minted shape, matching what the
 * renderer chips as a bare word (the `sessionId` extension in markdown.ts) —
 * a pill the sent message does not draw would be a promise the composer
 * cannot keep.
 *
 * This is where a pasted link ends up: `pastedSessionId` shortens the URL to
 * the id it carries, and the pill is what says so.
 */
export function composerSessionRanges(text: string): SessionRange[] {
	if (!text.includes("-")) return [];
	const out: SessionRange[] = [];
	SESSION_RE.lastIndex = 0;
	for (let m = SESSION_RE.exec(text); m; m = SESSION_RE.exec(text)) {
		const start = m.index + m[1]!.length;
		out.push({ start, end: start + m[2]!.length, id: m[2]! });
	}
	return out;
}

/** Both kinds of pill, in the order they appear in the draft. */
type DraftRange = MentionRange | SessionRange;

function draftRanges(
	text: string,
	people: Person[],
	sessions: SessionRange[],
): DraftRange[] {
	const ranges: DraftRange[] = [
		...composerMentionRanges(text, people),
		...sessions,
	];
	// A mention starts at an `@` and an id never does, so the two kinds cannot
	// overlap and sorting by start is enough to walk them as one list.
	return ranges.sort((a, b) => a.start - b.start);
}

/** Hide title backticks from the code scanner without changing offsets. */
function syntaxText(text: string, sessions: SessionRange[]): string {
	let out = text;
	for (const session of sessions) {
		if (!session.label) continue;
		const title = out
			.slice(session.start, session.end)
			.replaceAll("`", " ");
		out = out.slice(0, session.start) + title + out.slice(session.end);
	}
	return out;
}

/**
 * One mention pill. The face is the tricky part: the mirror may not take a
 * pixel of width, so there is nowhere to PUT a picture — the pill is exactly
 * as wide as `@Michiel` is in the field behind it. So the face is painted, not
 * laid out: it replaces the `@`, which goes transparent and hands over its
 * slot, and it leans left into the space before the name (base.css). An
 * `<img>` would be wrong here for a second reason: this HTML is rewritten on
 * every keystroke, so the element would be destroyed and re-decoded sixty
 * times a minute; a background image is fetched once and stays painted.
 *
 * Nobody's face is a fallback: a teammate with no GitHub login keeps a plain
 * `@` and just gets the pill.
 */
function mentionHtml(text: string, range: MentionRange): string {
	const at = esc(text.slice(range.start, range.start + 1));
	const name = esc(text.slice(range.start + 1, range.end));
	if (!range.github) return `<span class="cmp-mention">${at}${name}</span>`;
	const face = `https://github.com/${encodeURIComponent(range.github)}.png?size=48`;
	return (
		`<span class="cmp-mention cmp-faced" style="--cmp-face:url(&quot;${face}&quot;)">` +
		`<span class="cmp-at">${at}</span>${name}</span>`
	);
}

/**
 * One session pill. A known session already arrives as its projected title,
 * so the mirror only paints the pill around those same characters. An unknown
 * session keeps its id. The chat glyph then has nowhere to go except a slot the
 * text already owns, so the `os-` / `bks-` prefix lends it one.
 *
 * Hiding the whole prefix rather than part of it is the point. A uuid is not
 * read as a word, so losing `os-` reads as a labelled chip; losing only the
 * `o` would leave `s-01a0…`, which reads as damage.
 */
function sessionHtml(text: string, range: SessionRange): string {
	if (range.label)
		return `<span class="cmp-session cmp-session-named">${esc(text.slice(range.start, range.end))}</span>`;
	const prefixEnd = text.indexOf("-", range.start) + 1;
	const prefix = esc(text.slice(range.start, prefixEnd));
	const rest = esc(text.slice(prefixEnd, range.end));
	return (
		`<span class="cmp-session"><span class="cmp-sid">${prefix}</span>` +
		`${rest}</span>`
	);
}

/** Pills inside a plain (non-code) run of the draft. */
function chips(
	text: string,
	from: number,
	to: number,
	ranges: DraftRange[],
): string {
	let out = "";
	let last = from;
	for (const range of ranges) {
		if (range.start < last || range.end > to) continue;
		out += esc(text.slice(last, range.start));
		out += "id" in range ? sessionHtml(text, range) : mentionHtml(text, range);
		last = range.end;
	}
	return out + esc(text.slice(last, to));
}

/** Wrap `inline code` spans within a non-fence segment. A pill inside code
 * stays plain — it is quoted text, not somebody being addressed or a place
 * being pointed at. */
function inlineCode(
	text: string,
	syntax: string,
	from: number,
	to: number,
	ranges: DraftRange[],
): string {
	const seg = syntax.slice(from, to);
	let out = "";
	let last = from;
	const re = /`[^`\n]+`/g;
	let m: RegExpExecArray | null;
	while ((m = re.exec(seg))) {
		const at = from + m.index;
		out += chips(text, last, at, ranges);
		out += `<span class="cmp-code">${esc(text.slice(at, at + m[0].length))}</span>`;
		last = at + m[0].length;
	}
	return out + chips(text, last, to, ranges);
}

/**
 * Render a composer draft to mirror HTML: ``` fences (closed, or open-ended
 * while still being typed) become .cmp-fence, `inline code` becomes .cmp-code,
 * a finished @-mention becomes .cmp-mention, and a session id becomes
 * .cmp-session. Inline backticks inside a fence are left alone. A trailing
 * zero-width space keeps the mirror's last line from collapsing when the draft
 * ends in \n.
 */
export function composerHighlightHtml(
	text: string,
	people: Person[] = [],
	sessions: SessionRange[] = composerSessionRanges(text),
): string {
	const ranges = draftRanges(text, people, sessions);
	const syntax = syntaxText(text, sessions);
	let out = "";
	let last = 0;
	const re = /```[\s\S]*?```|```[\s\S]*$/g;
	let m: RegExpExecArray | null;
	while ((m = re.exec(syntax))) {
		out += inlineCode(text, syntax, last, m.index, ranges);
		out += `<span class="cmp-fence">${esc(text.slice(m.index, m.index + m[0].length))}</span>`;
		last = m.index + m[0].length;
	}
	out += inlineCode(text, syntax, last, text.length, ranges);
	return out + "​";
}

/**
 * A pill that can be pressed has to look it, and the field on top owns the
 * cursor, so hover is hit-tested against the mirror's own spans and painted
 * by a data attribute on the one under the pointer. Both composers paint it
 * the same way, so the hit test lives here beside the markup it reads.
 *
 * `hovered` carries the span between calls; it belongs to the caller because
 * the mirror's innerHTML is rewritten on every keystroke, which leaves the
 * previous span dangling.
 */
export function paintPillHover(
	mirror: HTMLElement | null,
	field: HTMLTextAreaElement | null,
	x: number,
	y: number,
	hovered: { current: HTMLElement | null },
): void {
	if (!mirror || !field) return;
	let hit: HTMLElement | null = null;
	for (const span of mirror.querySelectorAll<HTMLElement>(
		".cmp-mention, .cmp-session",
	)) {
		// Per fragment, not per span: a name that wraps has two boxes.
		for (const rect of span.getClientRects())
			if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom)
				hit = span;
		if (hit) break;
	}
	if (hovered.current === hit) return;
	hovered.current?.removeAttribute("data-hover");
	hit?.setAttribute("data-hover", "");
	hovered.current = hit;
	field.style.cursor = hit ? "pointer" : "";
}

/** Only mount the mirror when the draft has something to paint — code markup,
 * a finished mention, or a session id. Plain drafts keep the stock opaque
 * textarea (zero desync risk). */
export function needsComposerHighlight(
	text: string,
	people: Person[] = [],
	sessions: SessionRange[] = composerSessionRanges(text),
): boolean {
	return (
		text.includes("`") ||
		composerMentionRanges(text, people).length > 0 ||
		sessions.length > 0
	);
}
