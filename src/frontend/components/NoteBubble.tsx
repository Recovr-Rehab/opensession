import React from "react";
import type { SessionNote } from "../lib/types";
import { UserAvatar } from "./UserAvatar";

/**
 * A team note interleaved into the session transcript — a human-to-human
 * message the agent never sees (Plain's "internal note" concept, for our own
 * sessions). Backed by src/server/session-notes.ts; rendered with a
 * deliberate yellow tint so it can't be mistaken for a prompt or an answer.
 */

function noteTime(ts: number): string {
	const d = new Date(ts);
	const time = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
	if (d.toDateString() === new Date().toDateString()) return time;
	return `${d.toLocaleDateString([], { month: "short", day: "numeric" })} ${time}`;
}

const NOTE_TOKEN_RE = /(@[A-Za-z][\w.-]*|https?:\/\/[^\s<>"')\]]+)/g;

/** Note text with @Name emphasized and bare URLs clickable. */
function NoteText({ text }: { text: string }) {
	const parts = text.split(NOTE_TOKEN_RE);
	if (parts.length === 1) return <>{text}</>;
	return (
		<>
			{parts.map((p, i) => {
				if (/^https?:\/\//.test(p))
					return (
						<a
							key={i}
							href={p}
							target="_blank"
							rel="noreferrer"
							className="text-accent underline decoration-accent/40 underline-offset-2 hover:decoration-accent"
						>
							{p}
						</a>
					);
				if (p.startsWith("@"))
					return (
						<span key={i} className="font-semibold text-fg">
							{p}
						</span>
					);
				return <React.Fragment key={i}>{p}</React.Fragment>;
			})}
		</>
	);
}

export function NoteBubble({ note }: { note: SessionNote }) {
	return (
		<div
			// A note is a transcript block like any other, so it takes the same
			// centered reading column the turns, footers and walkthrough cards use
			// (mx-auto + --session-col) instead of spanning the whole pane, and the
			// same mt-2/mb-6 rhythm as the column's other card blocks (AskCard,
			// WalkthroughCard) so it doesn't crowd whatever follows it.
			className="mx-auto mb-6 mt-2 w-full max-w-[var(--session-col)] rounded-lg px-4 py-3.5"
			style={{
				background: "color-mix(in srgb, var(--yellow) 7%, transparent)",
			}}
		>
			<div className="mb-1 flex items-center gap-2">
				<UserAvatar name={note.user} size={18} />
				<span className="text-supporting font-semibold text-fg">{note.user}</span>
				<span
					className="text-meta font-semibold"
					style={{ color: "var(--yellow)" }}
					title="Team note — the agent doesn't see this"
				>
					Note
				</span>
				<span className="text-[11px] text-faint">{noteTime(note.ts)}</span>
			</div>
			<div className="whitespace-pre-wrap text-body leading-relaxed text-fg">
				<NoteText text={note.text} />
			</div>
		</div>
	);
}
