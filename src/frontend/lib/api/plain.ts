import { request } from "./request";
import type {
	PlainThread,
	PlainWorkspaceUser,
	PlainLabelType,
	SupportThread,
} from "../types";

export async function fetchPlainThreadApi(
	sessionId: string,
): Promise<PlainThread | null> {
	const body = await request<{ thread?: PlainThread }>(
		`/sessions/${encodeURIComponent(sessionId)}/plain/thread`,
	);
	return body?.thread || null;
}

/** The Support sidebar's queue: TODO Plain threads, newest status change first. */
export async function fetchSupportThreads(): Promise<SupportThread[]> {
	const body = await request<{ threads?: SupportThread[] }>("/plain/threads", {
		label: "Failed to fetch support threads",
	});
	return body?.threads || [];
}

/** A Plain thread's conversation by thread id (the session-less Support preview). */
export async function fetchPlainThreadById(
	threadId: string,
): Promise<PlainThread | null> {
	const body = await request<{ thread?: PlainThread }>(
		`/plain/threads/${encodeURIComponent(threadId)}`,
	);
	return body?.thread || null;
}

/**
 * Send a human-written message into a Plain thread: a customer-facing reply
 * (email/session via Plain) or an internal note for the team.
 */
export async function sendPlainReplyApi(
	threadId: string,
	text: string,
	kind: "reply" | "note",
	user: string,
): Promise<void> {
	await request<{ ok: boolean }>(
		`/plain/threads/${encodeURIComponent(threadId)}/reply`,
		{ method: "POST", body: { text, kind, user }, label: "Failed to send" },
	);
}

/** Quick status change on a Plain thread: Todo / Snoozed / Done. */
export async function setPlainThreadStatusApi(
	threadId: string,
	status: "todo" | "done" | "snoozed",
	opts: { durationSeconds?: number; user?: string } = {},
): Promise<void> {
	await request<{ ok: boolean }>(
		`/plain/threads/${encodeURIComponent(threadId)}/status`,
		{
			method: "POST",
			body: { status, ...opts },
			label: "Failed to update status",
		},
	);
}

/** Change a Plain thread's priority (0 = Urgent … 3 = Low). */
export async function setPlainThreadPriorityApi(
	threadId: string,
	priority: number,
	user?: string,
): Promise<void> {
	await request<{ ok: boolean }>(
		`/plain/threads/${encodeURIComponent(threadId)}/priority`,
		{
			method: "POST",
			body: { priority, user },
			label: "Failed to update priority",
		},
	);
}

/**
 * Mark the customer behind a Plain thread as spam (also closes the thread),
 * or undo the spam mark.
 */
export async function setPlainThreadSpamApi(
	threadId: string,
	spam: boolean,
	user?: string,
): Promise<void> {
	await request<{ ok: boolean }>(
		`/plain/threads/${encodeURIComponent(threadId)}/spam`,
		{
			method: "POST",
			body: { spam, user },
			label: "Failed to update spam status",
		},
	);
}

/** Assign a Plain thread to a workspace user, or unassign (userId = null). */
export async function setPlainThreadAssigneeApi(
	threadId: string,
	userId: string | null,
	user?: string,
): Promise<void> {
	await request<{ ok: boolean }>(
		`/plain/threads/${encodeURIComponent(threadId)}/assign`,
		{
			method: "POST",
			body: { userId, user },
			label: "Failed to assign",
		},
	);
}

/** Add/remove labels on a Plain thread (adds = label-type ids, removes = label ids). */
export async function changePlainThreadLabelsApi(
	threadId: string,
	changes: { addLabelTypeIds?: string[]; removeLabelIds?: string[] },
	user?: string,
): Promise<void> {
	await request<{ ok: boolean }>(
		`/plain/threads/${encodeURIComponent(threadId)}/labels`,
		{
			method: "POST",
			body: { ...changes, user },
			label: "Failed to update labels",
		},
	);
}

/** Rename a Plain thread. */
export async function setPlainThreadTitleApi(
	threadId: string,
	title: string,
	user?: string,
): Promise<void> {
	await request<{ ok: boolean }>(
		`/plain/threads/${encodeURIComponent(threadId)}/title`,
		{
			method: "POST",
			body: { title, user },
			label: "Failed to rename",
		},
	);
}

/** Plain workspace users (Assign menu). Server-cached; alias accounts filtered. */
export async function fetchPlainUsersApi(): Promise<PlainWorkspaceUser[]> {
	const body = await request<{ users?: PlainWorkspaceUser[] }>(
		"/plain/users",
		{ label: "Failed to fetch Plain users" },
	);
	return body?.users || [];
}

/** Plain's active label types (Labels menu). Server-cached. */
export async function fetchPlainLabelTypesApi(): Promise<PlainLabelType[]> {
	const body = await request<{ labelTypes?: PlainLabelType[] }>(
		"/plain/label-types",
		{ label: "Failed to fetch label types" },
	);
	return body?.labelTypes || [];
}

export async function startPlainTriageApi(threadId: string): Promise<string> {
	const body = await request<{ sessionId: string }>(
		`/plain/triage/${encodeURIComponent(threadId)}`,
		{ method: "POST", label: "Failed to start triage" },
	);
	return body.sessionId;
}
