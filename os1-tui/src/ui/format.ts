/**
 * Transcript entries → the one or few lines a terminal should show.
 *
 * Pure string work, kept out of the components so it's testable: the tool-call
 * summary in particular is the difference between a readable transcript and a
 * screenful of JSON.
 */

import type { Session, TranscriptEntry } from "../client/types";

/** Compact relative age: "now", "4m", "3h", "2d". */
export function relativeTime(stamp?: string | null, now = Date.now()): string {
	if (!stamp) return "";
	const then = Date.parse(stamp);
	if (Number.isNaN(then)) return "";
	const seconds = Math.max(0, Math.round((now - then) / 1000));
	if (seconds < 45) return "now";
	const minutes = Math.round(seconds / 60);
	if (minutes < 60) return `${minutes}m`;
	const hours = Math.round(minutes / 60);
	if (hours < 24) return `${hours}h`;
	return `${Math.round(hours / 24)}d`;
}

/** First meaningful path/command-ish value in a tool's input, for the one-liner. */
/**
 * The server's structured `detail` as one line. Kept here rather than shared
 * for the same reason the types above are hand-mirrored: this package
 * compiles standalone. What it must NOT do is decide what the call is — that
 * arrives already decided.
 */
function renderToolDetail(
	detail: NonNullable<TranscriptEntry["presentation"]>["detail"],
): string {
	switch (detail.kind) {
		case "path":
			return shortenPath(detail.path);
		case "paths": {
			const shown = detail.paths
				.map((path, i) =>
					[detail.labels?.[i], shortenPath(path)].filter(Boolean).join(" "),
				)
				.join("  ·  ");
			return detail.more ? `${shown}  ·  +${detail.more}` : shown;
		}
		case "command":
			return detail.command.split("\n")[0] ?? "";
		case "text":
			return [detail.text, detail.path ? shortenPath(detail.path) : ""]
				.filter(Boolean)
				.join(" ");
		case "todo":
			return [detail.current, `${detail.done}/${detail.total} done`]
				.filter(Boolean)
				.join("  ·  ");
		default:
			return "";
	}
}

/** Collapse a home-anchored path so the interesting tail survives narrow panes. */
export function shortenPath(value: string, max = 60): string {
	let text = value.replace(/^\/home\/[^/]+\//, "~/");
	if (text.length <= max) return text;
	const parts = text.split("/");
	while (parts.length > 2 && parts.join("/").length > max) parts.splice(1, 1);
	text = parts.join("/…/").replace("/…//", "/…/");
	return text.length <= max ? text : `…${text.slice(-(max - 1))}`;
}

export type DisplayEntry = {
	id: string;
	kind: "user" | "assistant" | "tool" | "system";
	/** Leading glyph + label, e.g. "▸ read". */
	prefix: string;
	/** The body — may be multi-line for user/assistant text. */
	body: string;
	error?: boolean;
	/** Server clamped the body; the full one is a fetch away. */
	clamped?: boolean;
};

const TOOL_RESULT_PREVIEW = 240;

export function formatEntry(entry: TranscriptEntry): DisplayEntry | null {
	const content = (entry.content ?? "").replace(/\s+$/, "");

	switch (entry.type) {
		case "user":
			return {
				id: entry.id,
				kind: "user",
				prefix: "›",
				body: content,
				clamped: entry.contentClamped,
			};

		case "assistant":
			if (!content) return null;
			return {
				id: entry.id,
				kind: "assistant",
				prefix: "",
				body: content,
				clamped: entry.contentClamped,
			};

		case "tool_use": {
			// What the call IS comes off the entry: the server derives it once
			// (packages/protocol/src/tool-presentation.ts) so this pane, the web
			// viewer and the phone name the same call the same way. Only the
			// rendering is ours. Older servers send none, hence the fallback.
			const shown = entry.presentation;
			return {
				id: entry.id,
				kind: "tool",
				prefix: `▸ ${shown ? shown.name : (entry.toolName ?? "tool")}`,
				body: shown ? renderToolDetail(shown.detail) : "",
			};
		}

		case "tool_result": {
			// Results are noise by default; one truncated line is enough to see
			// that it came back, and errors get the full first lines.
			const firstLines = content.split("\n").slice(0, entry.isError ? 4 : 1).join(" ⏎ ");
			const body =
				firstLines.length > TOOL_RESULT_PREVIEW
					? `${firstLines.slice(0, TOOL_RESULT_PREVIEW)}…`
					: firstLines;
			if (!body) return null;
			return {
				id: entry.id,
				kind: "tool",
				prefix: entry.isError ? "◂ error" : "◂",
				body,
				error: entry.isError,
			};
		}

		default:
			if (!content) return null;
			return { id: entry.id, kind: "system", prefix: "•", body: content };
	}
}

export function formatEntries(entries: TranscriptEntry[]): DisplayEntry[] {
	const out: DisplayEntry[] = [];
	for (const entry of entries) {
		const display = formatEntry(entry);
		if (display) out.push(display);
	}
	return out;
}

/** The session line in the status bar: repo · branch · model. */
export function sessionSubtitle(session: Session | undefined): string {
	if (!session) return "";
	const parts = [session.repo, session.branch, session.model, session.mode].filter(
		(p): p is string => typeof p === "string" && p.length > 0,
	);
	return parts.join(" · ");
}
