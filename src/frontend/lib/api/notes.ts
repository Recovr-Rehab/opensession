import { request } from "./request";

// ── Wiki ──

export async function fetchWikiTree() {
	return request<any>("/wiki/tree", { label: "Failed to fetch wiki tree" });
}

export async function fetchWikiFile(path: string) {
	return request<any>(`/wiki/file?path=${encodeURIComponent(path)}`, {
		label: "Failed to fetch doc",
	});
}

export async function searchWikiApi(q: string) {
	return request<any>(`/wiki/search?q=${encodeURIComponent(q)}`, {
		label: "Search failed",
	});
}

// ── Notes (shared, collaborative) ──

export interface NoteMeta {
	id: string;
	title: string;
	updatedAt: number;
}

export async function fetchNotes(): Promise<NoteMeta[]> {
	const body = await request<{ notes?: NoteMeta[] }>("/notes", {
		label: "Failed to fetch notes",
	});
	return Array.isArray(body?.notes) ? body.notes : [];
}

export async function createNoteApi(title?: string): Promise<NoteMeta> {
	const body = await request<{ note: NoteMeta }>("/notes", {
		method: "POST",
		body: { title },
		label: "Failed to create note",
	});
	return body.note;
}

export async function deleteNoteApi(id: string): Promise<void> {
	await request<void>(`/notes/${encodeURIComponent(id)}`, {
		method: "DELETE",
		label: "Failed to delete note",
	});
}

export interface NoteSearchHit {
	id: string;
	title: string;
	line: number;
	snippet: string;
}

/** Full-text search across the shared notes (merged with docs hits in the UI). */
export async function searchNotesApi(q: string): Promise<NoteSearchHit[]> {
	const body = await request<{ hits?: NoteSearchHit[] }>(
		`/notes/search?q=${encodeURIComponent(q)}`,
		{ label: "Note search failed" },
	);
	return body?.hits ?? [];
}

/** One note's meta + current markdown text (preview / discuss). */
export async function fetchNote(
	id: string,
): Promise<NoteMeta & { text: string }> {
	return request(`/notes/${encodeURIComponent(id)}`, {
		label: "Failed to fetch note",
	});
}

/** Notes that link to this one via [label](note:id) chips. */
export async function fetchNoteBacklinks(
	id: string,
): Promise<Array<{ id: string; title: string }>> {
	const body = await request<{ notes?: Array<{ id: string; title: string }> }>(
		`/notes/${encodeURIComponent(id)}/backlinks`,
		{ label: "Failed to fetch backlinks" },
	);
	return body?.notes ?? [];
}

/** Run a Haiku rewrite of the note; the new content arrives live over the WS. */
export async function promptNoteApi(id: string, prompt: string): Promise<void> {
	await request<void>(`/notes/${encodeURIComponent(id)}/prompt`, {
		method: "POST",
		body: { prompt },
		label: "Update failed",
	});
}
