/**
 * Session team notes HTTP surface (see src/server/session-notes.ts for the
 * store): list a session's notes, and post one.
 *
 * Registered BEFORE handleSessionsRoutes in routes/index.ts, like the assets
 * and git surfaces: the /notes suffix lives inside the /api/sessions/:id path
 * family, and the generic session routes must never swallow it.
 */

import { requestUser, type RouteContext } from "./context";
import {
	addSessionNote,
	isValidNoteSession,
	listSessionNotes,
	mentionedTeammates,
	sessionNoteActivity,
} from "../session-notes";
import { broadcastToAll } from "../ws-hub";

export async function handleSessionNotesRoutes(
	ctx: RouteContext,
): Promise<Response | undefined> {
	const { req, url, path } = ctx;

	// Latest note per session — what an unread indicator keys off.
	if (path === "/api/session-notes/activity" && req.method === "GET")
		return Response.json({ sessions: sessionNoteActivity() });

	const match = path.match(/^\/api\/sessions\/([^/]+)\/notes$/);
	if (!match) return undefined;
	const sessionId = decodeURIComponent(match[1]!);
	if (!isValidNoteSession(sessionId))
		return Response.json({ error: "invalid session" }, { status: 400 });

	if (req.method === "GET") {
		const limit = Number(url.searchParams.get("limit")) || 200;
		return Response.json({ notes: listSessionNotes(sessionId, limit) });
	}

	if (req.method === "POST") {
		const body = await req.json().catch(() => null);
		const user = requestUser(ctx, body?.user);
		const text = typeof body?.text === "string" ? body.text : "";
		if (!user || !text.trim())
			return Response.json({ error: "user and text required" }, { status: 400 });
		const note = addSessionNote(sessionId, user, text);
		if (!note)
			return Response.json({ error: "user and text required" }, { status: 400 });
		// Everyone gets it live: clients watching this session render it, and
		// the rest can use the same event for an unread indicator.
		broadcastToAll({ type: "session_note", sessionId, note });
		// @-mentions ping the tagged teammate's devices (works app-closed).
		const mentioned = mentionedTeammates(note.text, user);
		if (mentioned.length) {
			const { sendPushToUser } = await import("../push");
			const preview =
				note.text.length > 140 ? `${note.text.slice(0, 139)}…` : note.text;
			for (const name of mentioned)
				void sendPushToUser(name, {
					title: `${user} mentioned you in a session note`,
					body: preview,
					url: `/session/${encodeURIComponent(sessionId)}`,
					tag: `opensession-note-${sessionId}`,
				});
		}
		return Response.json({ note });
	}

	return undefined;
}
