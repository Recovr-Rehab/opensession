/**
 * Who the session header's facepile is about.
 *
 * The `presence` frame carries one name per SOCKET, including every socket of
 * your own — so the raw list is not a list of people, and it is not a list of
 * OTHER people either. Both corrections happen here:
 *
 * - Your own faces come out. You know you're here; a face that is always
 *   present on every session you open is the one thing a presence pile must
 *   never show, because it reads as somebody standing behind you rather than
 *   as multiplayer. (The native app has always filtered its own name out.)
 * - Everyone else is counted per person, so a teammate with a laptop and a
 *   phone on the same session is one face, not two.
 *
 * Names arrive as the picker's first-name form ("Kent"), but a client can hold
 * the full display name ("Kent de Bruin") — compare on the person key, or you
 * filter nobody and every session shows your own face again.
 */

import { personKey } from "./review-queue";

/** Presence viewers minus your own devices. */
export function otherViewers(viewers: string[], me?: string | null): string[] {
	const mine = personKey(me || "");
	if (!mine) return [...viewers];
	return viewers.filter((v) => personKey(v) !== mine);
}

/**
 * Who a SIDEBAR row's face is about — a different question from the one above.
 *
 * The header pile inside a session answers "who else is in this room", which
 * is worth knowing once you're in it. A row in the list is glanced at all day,
 * and a face there for merely having the session open reads as being watched:
 * teammates appear and vanish as their attention times out, on rows where
 * nothing is happening. So a row's face is earned by WORK, not by attention —
 * a run in flight that this person prompted (`runBy`, stamped server-side from
 * the run journal). It arrives when they start something, holds steady for as
 * long as it runs, and leaves when the run does, which is a moment the row
 * shows anyway. Reading someone's session leaves no trace on their list.
 */
export function workingViewers(
	sessions: Array<{ isRunning?: boolean; runBy?: string | null }>,
	me?: string | null,
): string[] {
	const mine = personKey(me || "");
	const seen = new Set<string>();
	const out: string[] = [];
	for (const s of sessions) {
		const by = s.isRunning ? s.runBy?.trim() : undefined;
		if (!by) continue;
		const key = personKey(by);
		// Your own runs never earn a face: you know what you started, and a
		// face that follows you around is the thing this is meant to remove.
		if (!key || key === mine || seen.has(key)) continue;
		seen.add(key);
		out.push(by);
	}
	return out;
}

/** One entry per person, in first-seen order, with how many devices they have. */
export function dedupeViewers(
	viewers: string[],
): Array<{ name: string; count: number }> {
	const counts = new Map<string, number>();
	for (const v of viewers) counts.set(v, (counts.get(v) || 0) + 1);
	return Array.from(counts, ([name, count]) => ({ name, count }));
}
