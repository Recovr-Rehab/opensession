import React from "react";
import { cn } from "../ui/cn";
import { parseMentions, mentionsMe } from "../lib/mention-text";
import { personFilterFor, setFilter } from "../lib/sidebar-filter";
import { usePeople } from "../lib/people";
import { UserAvatar } from "./UserAvatar";
import { getCurrentUser } from "./UserPicker";

/**
 * Human-written text with @-mentions rendered as the person they name: their
 * face, their name, and a click that puts the sidebar on their sessions. A
 * mention of you is filled with the accent, so you can find yourself in a long
 * note without reading it.
 *
 * Used by the team-note bubble and by prompt bubbles, which are the two places
 * one teammate writes to another. Only names on the roster become chips
 * (lib/mention-text.ts) — an unmatched `@word` stays prose.
 */
export function MentionText({ text }: { text: string }) {
	const people = usePeople();
	const me = getCurrentUser();
	const tokens = parseMentions(text, people);
	if (!tokens.length) return null;

	return (
		<>
			{tokens.map((token, i) => {
				if (token.kind === "url")
					return (
						<a
							key={i}
							href={token.text}
							target="_blank"
							rel="noreferrer"
							className="text-accent underline decoration-accent/40 underline-offset-2 hover:decoration-accent"
						>
							{token.text}
						</a>
					);
				if (token.kind === "mention") {
					const mine = mentionsMe(token.name, me);
					return (
						<button
							key={i}
							type="button"
							// The chip sits in running text, so it takes the line's own
							// metrics: inline-flex with the face as the first item, aligned
							// to the text baseline rather than the box (see the chip
							// baseline rule in base.css that .session-link follows).
							className={cn(
								"mx-px inline-flex translate-y-[3px] items-center gap-1 rounded-full px-1.5 py-px align-baseline text-[0.95em] font-semibold transition-colors",
								mine
									? "bg-accent text-on-accent hover:bg-accent-hover"
									: "bg-[color-mix(in_srgb,var(--accent)_12%,transparent)] text-accent hover:bg-[color-mix(in_srgb,var(--accent)_20%,transparent)]",
							)}
							title={`Show ${token.name}'s sidebar`}
							onClick={(e) => {
								e.stopPropagation();
								setFilter({ person: personFilterFor(token.name.toLowerCase(), me) });
							}}
						>
							<UserAvatar name={token.name} size={14} className="shrink-0" />
							{token.name}
						</button>
					);
				}
				return <React.Fragment key={i}>{token.text}</React.Fragment>;
			})}
		</>
	);
}
