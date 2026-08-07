import { request } from "./request";

// ── Actions (run a registered repo script behind a form) ──

export type ActionInputType = "text" | "number" | "select" | "boolean";

export interface ActionInput {
	name: string;
	label?: string;
	type: ActionInputType;
	required?: boolean;
	default?: string;
	options?: string[];
	hint?: string;
}

export interface Action {
	id: string;
	name: string;
	description?: string;
	kind?: "repo" | "mcp";
	repo?: string;
	scriptPath?: string;
	argMode?: "positional" | "env";
	mcpServer?: string;
	toolName?: string;
	inputs: ActionInput[];
	confirm?: boolean;
	model?: string;
	seeded?: boolean;
	createdBy: string;
	createdAt: string;
	lastRunAt?: string;
	lastRunSessionId?: string;
}

export async function fetchActions(): Promise<Action[]> {
	return request<Action[]>("/actions", { label: "Failed to fetch actions" });
}

export async function createActionApi(input: {
	name: string;
	description?: string;
	kind: "repo" | "mcp";
	repo?: string;
	scriptPath?: string;
	argMode?: "positional" | "env";
	mcpServer?: string;
	toolName?: string;
	inputs: ActionInput[];
	confirm?: boolean;
	createdBy: string;
}): Promise<Action> {
	return request<Action>("/actions", { method: "POST", body: input });
}

export async function deleteActionApi(id: string): Promise<void> {
	await request<void>(`/actions/${encodeURIComponent(id)}`, {
		method: "DELETE",
		label: "Failed to delete",
	});
}

export async function runActionApi(
	id: string,
	values: Record<string, unknown>,
	user: string,
): Promise<{ sessionId: string }> {
	return request<{ sessionId: string }>(
		`/actions/${encodeURIComponent(id)}/run`,
		{ method: "POST", body: { values, user } },
	);
}

export async function introspectActionApi(
	repo: string,
	scriptPath: string,
): Promise<{ inputs: ActionInput[]; argMode: "positional" | "env" }> {
	return request<{ inputs: ActionInput[]; argMode: "positional" | "env" }>(
		"/actions/introspect",
		{ method: "POST", body: { repo, scriptPath } },
	);
}
