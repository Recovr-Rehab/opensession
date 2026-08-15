import { classifyEntry } from "@tellahq/opensession-protocol/notices";
import type { TranscriptEntry } from "./types";

/**
 * The messages a person typed into a session, in order: the index behind the
 * transcript's message rail.
 *
 * "A message" is whatever the transcript renders as one, so the three tests
 * here mirror MessageBubble's: a `user` entry, not classified as an
 * operational notice, carrying a body or an attachment. An entry it draws
 * nothing for (delivery plumbing whose body was fenced context) has no bubble
 * to scroll to, and a rail tick pointing at nothing is worse than no tick.
 */

/** One sent message, as the rail indexes it. */
export interface SentMessage {
	/** The rendered bubble's `data-eid`, which is what the rail scrolls to. */
	id: string;
	/** One flat line of the message, for the list. */
	preview: string;
	/** Set when a teammate sent this turn rather than the session's driver. */
	sender?: string;
	timestamp: string;
}

/** Enough for a wide row; the rest is the list's own truncation. Clamped here
 *  as well so a pasted 80KB message doesn't ride into the popup as one. */
const MAX_PREVIEW = 120;

/** Collapse markdown into one readable run of prose. */
function flatten(text: string): string {
	return text
		.replace(/```[\s\S]*?```/g, " ")
		.replace(/`([^`]*)`/g, "$1")
		.replace(/^\s{0,3}#{1,6}\s+/gm, "")
		.replace(/^\s*[-*+]\s+/gm, "")
		.replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
		.replace(/[*_~]{1,3}/g, "")
		.replace(/<[^>]+>/g, " ")
		.replace(/\s+/g, " ")
		.trim();
}

function clamp(text: string): string {
	if (text.length <= MAX_PREVIEW) return text;
	// Break on a word so the ellipsis doesn't cut mid-token.
	const cut = text.slice(0, MAX_PREVIEW);
	const space = cut.lastIndexOf(" ");
	return `${(space > MAX_PREVIEW * 0.6 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

/**
 * A staged transcript selection leads the message as blockquote lines
 * (lib/quotes.ts). That is what you were talking ABOUT, not what you said, so
 * the preview starts after it, unless quoting was the whole message.
 */
function dropLeadingQuote(text: string): string {
	const lines = text.split("\n");
	let at = 0;
	while (at < lines.length && (lines[at].startsWith(">") || !lines[at].trim()))
		at++;
	return lines.slice(at).join("\n").trim() || text;
}

/** What a message with no words of its own is: its attachments. */
function attachmentLabel(entry: TranscriptEntry): string {
	const files = entry.files ?? [];
	if (files.length === 1) return files[0].name;
	if (files.length > 1) return `${files.length} files`;
	const videos = entry.videos?.length ?? 0;
	if (videos) return videos === 1 ? "Video" : `${videos} videos`;
	const images = entry.images?.length ?? 0;
	if (images) return images === 1 ? "Image" : `${images} images`;
	return "";
}

export function collectSentMessages(entries: TranscriptEntry[]): SentMessage[] {
	const sent: SentMessage[] = [];
	for (const raw of entries) {
		if (raw.type !== "user") continue;
		// Classification strips the "[Name] " delivery prefix and names the
		// sender, so both the preview and the attribution come from it rather
		// than from a second reading of the raw content.
		const entry = classifyEntry(raw);
		if (entry.notice) continue;
		const text = entry.content ? flatten(dropLeadingQuote(entry.content)) : "";
		const preview = text ? clamp(text) : attachmentLabel(entry);
		if (!preview) continue;
		sent.push({
			id: entry.id,
			preview,
			timestamp: entry.timestamp,
			...(entry.sender ? { sender: entry.sender } : {}),
		});
	}
	return sent;
}
