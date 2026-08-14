import { request } from "./request";
import type {
	ExternalRef,
	Workspace,
} from "../types";

/** One media item in the workspace-overview panel. Image srcs are lazy-load
 * refs served by /sessions/:id/transcript-image; videos stream from
 * <base>/media. */
export interface WorkspaceMediaItem {
	kind: "image" | "video";
	src: string;
	sessionId: string;
	sessionTitle?: string;
	at: string;
}

export interface WorkspaceOverview {
	prompt: { content: string; sessionId: string; at: string } | null;
	/** Latest assistant text across the workspace's sessions. Optional because a
	 *  server that hasn't restarted onto the new overview code omits the key. */
	lastMessage?: { content: string; sessionId: string; at: string } | null;
	media: WorkspaceMediaItem[];
}

/** Opening prompt + all media across a workspace's sessions (the floating
 * preview panel in the session viewer). */
export async function fetchWorkspaceOverview(
	wsId: string,
): Promise<WorkspaceOverview> {
	return request<WorkspaceOverview>(
		`/workspaces/${encodeURIComponent(wsId)}/overview`,
		{ label: "Failed to fetch workspace overview" },
	);
}

// ── Workspaces (containers that group sessions) ──

export async function fetchWorkspaces(): Promise<Workspace[]> {
	try {
		const data = await request<{ workspaces?: Workspace[] }>("/workspaces");
		return data?.workspaces ?? [];
	} catch (e) {
		console.warn("fetchWorkspaces failed:", e);
		return [];
	}
}

export async function updateWorkspaceApi(
	id: string,
	patch: {
		name?: string;
		repo?: string;
		/** null clears the swatch color. */
		color?: string | null;
		order?: number;
		modelSettings?: Workspace["modelSettings"];
	},
): Promise<Workspace> {
	const body = await request<{ workspace: Workspace }>(
		`/workspaces/${encodeURIComponent(id)}`,
		{ method: "PATCH", body: patch },
	);
	return body.workspace;
}

export async function deleteWorkspaceApi(id: string): Promise<void> {
	await request<void>(`/workspaces/${encodeURIComponent(id)}`, {
		method: "DELETE",
		label: "Failed to delete workspace",
	});
}

/**
 * Start (or reuse) a triage session for a Plain thread — runs the "Plain
 * ticket triage" automation. Slow (~15-60s) when it has to boot a fresh run.
 */
/**
 * Resolve-or-create the ONE workspace for a PR or a Plain support ticket
 * (adopt-don't-duplicate — server-side workspace-resolve.ts). Sidebar PR and
 * Support rows call this on click, then navigate into the workspace.
 */
export async function resolveWorkspaceApi(
	target:
		| { pr: { repo: string; number?: number; branch?: string; title?: string } }
		| { plainThreadId: string; name?: string }
		| { externalRef: ExternalRef; name?: string },
	user?: string,
): Promise<{ workspaceId: string; created: boolean }> {
	return request<{ workspaceId: string; created: boolean }>(
		"/workspaces/resolve",
		{
			method: "POST",
			body: { ...target, ...(user ? { user } : {}) },
			label: "Failed to resolve the workspace",
		},
	);
}
