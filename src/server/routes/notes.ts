/**
 * Notes (collaborative Yjs docs) + the read-only wiki.
 *
 * Extracted verbatim from the opensession.ts fetch chain. Every handler
 * returns a Response for a matched route or undefined to fall through to the
 * next handler (see routes/index.ts for the dispatch order).
 */

import type { RouteContext } from "./context";
import { editNote } from "../note-edit";
import { createNote, deleteNote, getNoteText, isValidNoteId, listNotes, noteTextHash, seedIfEmpty, setNoteText } from "../notes";
import { getWikiFile, getWikiTree, searchWiki } from "../wiki";
import { b64encode, broadcastToNote } from "../ws-hub";

export async function handleNotesRoutes(
	ctx: RouteContext,
): Promise<Response | undefined> {
	const { req, url, path, publicPrefix } = ctx;

	// ── Notes (shared, collaborative; content syncs over WS) ──
	if (path === "/api/notes" && req.method === "GET") {
		seedIfEmpty();
		return Response.json({ notes: listNotes() });
	}

	if (path === "/api/notes" && req.method === "POST") {
		const body = await req.json().catch(() => null);
		const note = createNote(
			typeof body?.title === "string" ? body.title : undefined,
		);
		return Response.json({ note });
	}

	// Full-text search across notes (merged with docs hits client-side).
	// Must precede the generic /notes/:id matcher ("search" is not an id).
	if (path === "/api/notes/search" && req.method === "GET") {
		const { searchNotes } = await import("../../server/notes");
		return Response.json({
			hits: searchNotes(url.searchParams.get("q") || ""),
		});
	}

	const noteBacklinksMatch = path.match(
		/^\/api\/notes\/([^/]+)\/backlinks$/,
	);
	if (noteBacklinksMatch && req.method === "GET") {
		const id = decodeURIComponent(noteBacklinksMatch[1]);
		if (!isValidNoteId(id))
			return Response.json({ error: "Invalid id" }, { status: 400 });
		const { noteBacklinks } = await import("../../server/notes");
		return Response.json({ notes: noteBacklinks(id) });
	}

	const noteMatch = path.match(/^\/api\/notes\/([^/]+)$/);
	if (noteMatch && req.method === "GET") {
		const id = decodeURIComponent(noteMatch[1]);
		if (!isValidNoteId(id))
			return Response.json({ error: "Invalid id" }, { status: 400 });
		const notes = listNotes();
		const meta = notes.find((n) => n.id === id);
		if (!meta) return Response.json({ error: "Not found" }, { status: 404 });
		const text = getNoteText(id);
		// `hash` is what a REST writer sends back as `ifMatch`; the web editor
		// syncs over Yjs and ignores it.
		return Response.json({ ...meta, text, hash: noteTextHash(text) });
	}

	// Whole-text write, for clients that can't speak Yjs (the native app).
	// It lands through the same `setNoteText` diff the Haiku rewrite uses, so
	// web editors see it live as an ordinary update rather than a reload.
	// `ifMatch` (sha256 of the text the client read) is what keeps a stale
	// phone buffer from reverting someone's concurrent typing: the diff is
	// only minimal with respect to what the client SENT, so an edit based on
	// old text carries the undo of every newer edit between the two changes.
	if (noteMatch && req.method === "PUT") {
		const id = decodeURIComponent(noteMatch[1]);
		if (!isValidNoteId(id))
			return Response.json({ error: "Invalid id" }, { status: 400 });
		// getNoteDoc() mints a doc for any id, so a PUT racing a DELETE would
		// otherwise resurrect the note. Existence is the list's answer.
		if (!listNotes().some((n) => n.id === id))
			return Response.json({ error: "Not found" }, { status: 404 });
		const body = await req.json().catch(() => null);
		const text = body?.text;
		if (typeof text !== "string")
			return Response.json({ error: "text required" }, { status: 400 });
		if (text.length > 1_000_000)
			return Response.json({ error: "Note too large" }, { status: 413 });
		const current = getNoteText(id);
		const ifMatch = typeof body?.ifMatch === "string" ? body.ifMatch : null;
		if (ifMatch && ifMatch !== noteTextHash(current))
			return Response.json(
				{
					error: "conflict",
					text: current,
					hash: noteTextHash(current),
				},
				{ status: 409 },
			);
		const update = setNoteText(id, text);
		if (update.length)
			broadcastToNote(id, {
				type: "note_update",
				noteId: id,
				update: b64encode(update),
			});
		return Response.json({ ok: true, hash: noteTextHash(text) });
	}

	if (noteMatch && req.method === "DELETE") {
		const id = decodeURIComponent(noteMatch[1]);
		if (!isValidNoteId(id))
			return Response.json({ error: "Invalid id" }, { status: 400 });
		return deleteNote(id)
			? Response.json({ ok: true })
			: Response.json({ error: "Not found" }, { status: 404 });
	}

	const notePromptMatch = path.match(
		/^\/api\/notes\/([^/]+)\/prompt$/,
	);
	if (notePromptMatch && req.method === "POST") {
		const id = decodeURIComponent(notePromptMatch[1]);
		if (!isValidNoteId(id))
			return Response.json({ error: "Invalid id" }, { status: 400 });
		const body = await req.json().catch(() => null);
		const instruction = typeof body?.prompt === "string" ? body.prompt : "";
		if (!instruction.trim())
			return Response.json({ error: "prompt required" }, { status: 400 });
		const next = await editNote(getNoteText(id), instruction);
		if (next == null)
			return Response.json(
				{ error: "Could not update the note" },
				{ status: 422 },
			);
		// Apply as a minimal diff to the shared doc and broadcast to editors.
		const update = setNoteText(id, next);
		if (update.length)
			broadcastToNote(id, {
				type: "note_update",
				noteId: id,
				update: b64encode(update),
			});
		return Response.json({ ok: true });
	}

	// ── Wiki ──
	if (path === "/api/wiki/tree" && req.method === "GET") {
		return Response.json(getWikiTree());
	}

	if (path === "/api/wiki/file" && req.method === "GET") {
		const rel = url.searchParams.get("path") || "";
		const file = getWikiFile(rel);
		if (!file)
			return Response.json({ error: "Not found" }, { status: 404 });
		return Response.json(file);
	}

	if (path === "/api/wiki/search" && req.method === "GET") {
		const q = url.searchParams.get("q") || "";
		return Response.json(searchWiki(q));
	}

	return undefined;
}
