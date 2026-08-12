/**
 * Team notes on a session — human-to-human messages that ride the session's
 * transcript but never reach the agent. Plain's "internal note", for our own
 * sessions: you leave one for a teammate reading the run, not for the model.
 *
 * This is a narrow re-implementation of a feature that shipped in July on the
 * native team-chat backend (`session:<id>` channels in the since-deleted
 * src/server/chat.ts) and was removed with it in 5c90eddc. What came back is
 * only the part that was in use: per-session, text-only, append-only. No
 * watercooler, threads, reactions or image attachments — if any of those are
 * wanted again, they are new features rather than a restore.
 *
 * Notes persist per session in `~/.opensession-session-notes/<id>.json` (the
 * flat-file pattern of pins.ts/push.ts). Realtime delivery rides the app
 * WebSocket from the route; an `@Name` mention web-pushes that teammate's
 * devices via src/server/push.ts.
 *
 * Not to be confused with src/server/notes.ts, the shared Yjs note DOCUMENTS
 * behind /api/notes. Different feature, unrelated store.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync } from "fs";
import { writeJsonAtomic } from "./shared/atomic-write";
import { stateDir } from "./paths";
import { teamFirstNames } from "./people";

const NOTES_DIR = stateDir("session-notes");

// Keep each session's store bounded — the UI only ever loads the recent tail.
const MAX_STORED = 2000;
const MAX_TEXT_LEN = 8000;

export interface SessionNote {
	id: string;
	/** Sender's display name, as resolved from the verified identity. */
	user: string;
	text: string;
	/** ms epoch */
	ts: number;
}

/** Session ids are minted by us (`os-<uuidv7>`), but keep the filename mapping
 *  defensive: anything outside this charset can't become a path. */
export function isValidNoteSession(id: unknown): id is string {
	return typeof id === "string" && /^[A-Za-z0-9._-]{1,80}$/.test(id);
}

function fileFor(sessionId: string): string {
	return `${NOTES_DIR}/${sessionId}.json`;
}

function readAll(sessionId: string): SessionNote[] {
	try {
		const f = fileFor(sessionId);
		if (!existsSync(f)) return [];
		const raw = JSON.parse(readFileSync(f, "utf8"));
		if (!Array.isArray(raw?.notes)) return [];
		return raw.notes.filter(
			(n: unknown): n is SessionNote =>
				!!n &&
				typeof (n as any).id === "string" &&
				typeof (n as any).user === "string" &&
				typeof (n as any).text === "string" &&
				typeof (n as any).ts === "number",
		);
	} catch {
		return [];
	}
}

/** The session's most recent `limit` notes, oldest first. */
export function listSessionNotes(sessionId: string, limit = 200): SessionNote[] {
	const capped = Math.max(1, Math.min(limit, MAX_STORED));
	return readAll(sessionId).slice(-capped);
}

/** Append a note and return the stored record, or null when it is empty. */
export function addSessionNote(
	sessionId: string,
	user: string,
	text: string,
): SessionNote | null {
	const trimmed = text.trim().slice(0, MAX_TEXT_LEN);
	if (!trimmed) return null;
	const note: SessionNote = {
		id: crypto.randomUUID(),
		user: user.trim().slice(0, 64),
		text: trimmed,
		ts: Date.now(),
	};
	const all = readAll(sessionId);
	all.push(note);
	if (!existsSync(NOTES_DIR)) mkdirSync(NOTES_DIR, { recursive: true });
	writeJsonAtomic(fileFor(sessionId), { notes: all.slice(-MAX_STORED) });
	return note;
}

/**
 * Latest note per session — what an unread indicator would key off. One scan
 * over the notes dir; the files are small and team-scale, so no cache.
 */
export function sessionNoteActivity(): Array<{
	sessionId: string;
	lastTs: number;
	lastUser: string;
}> {
	const out: Array<{ sessionId: string; lastTs: number; lastUser: string }> = [];
	try {
		for (const f of readdirSync(NOTES_DIR)) {
			if (!f.endsWith(".json")) continue;
			const sessionId = f.slice(0, -".json".length);
			const notes = readAll(sessionId);
			const last = notes[notes.length - 1];
			if (!last) continue;
			out.push({ sessionId, lastTs: last.ts, lastUser: last.user });
		}
	} catch {}
	return out;
}

/** Distinct teammates `@`-mentioned in `text` — never the sender themself. */
export function mentionedTeammates(text: string, sender: string): string[] {
	const team = teamFirstNames();
	const found = new Set<string>();
	for (const m of text.matchAll(/@([A-Za-z][\w.-]*)/g)) {
		const name = team.find((n) => n.toLowerCase() === m[1]!.toLowerCase());
		if (name && name.toLowerCase() !== sender.trim().toLowerCase())
			found.add(name);
	}
	return [...found];
}
