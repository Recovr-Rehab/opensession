import { request } from "./request";

export interface SessionSandboxStatus {
	enabled: boolean;
	provider?: string;
	sandboxId?: string;
	workspace?: "bind" | "volume";
	status: "none" | "running" | "stopped" | "gone";
	materialized?: boolean;
	busy?: boolean;
	cwd?: string | null;
	canPause?: boolean;
	canResume?: boolean;
	logs?: { setup?: string; resume?: string };
}

export function fetchSessionSandbox(
	sessionId: string,
): Promise<SessionSandboxStatus> {
	return request(`/sessions/${encodeURIComponent(sessionId)}/sandbox`, {
		label: "Failed to load sandbox status",
	});
}

export function sandboxAction(
	sessionId: string,
	action: "pause" | "resume" | "recreate",
): Promise<SessionSandboxStatus> {
	return request(
		`/sessions/${encodeURIComponent(sessionId)}/sandbox/${action}`,
		{
			method: "POST",
			...(action === "recreate" ? { body: { confirm: true } } : {}),
			label: `Failed to ${action} sandbox`,
		},
	);
}
