import { request } from "./request";

export type RunnerState = "online" | "busy" | "offline" | "maintenance";

export type RunnerPermissions = {
	commands: boolean;
	fullSessions: boolean;
	terminals: boolean;
	portals: boolean;
};

export type RunnerInfo = {
	id: string;
	name: string;
	platform: "darwin" | "linux" | "win32";
	arch: string;
	label?: string;
	description?: string;
	location?: string;
	lastSeenAt?: string;
	softwareVersion?: string;
	maintenance?: boolean;
	state: RunnerState;
	capabilities: { toolchains: string[]; tags: string[] };
	resources?: {
		cpuCores?: number;
		memoryGb?: number;
		freeDiskGb?: number;
		gpu?: { kind: string; model?: string; vramGb?: number; cuda?: string; metal?: boolean; rocm?: string };
	};
	permissions: RunnerPermissions;
	allowedUsers: string[];
	allowedRepos: string[];
	workspaceRoots: string[];
	workload?: { sessionId?: string; operation?: string; startedAt?: string };
	reservation?: { sessionId?: string; reason: string; reservedBy?: string; expiresAt: string };
};

export async function fetchRunners(): Promise<{ runners: RunnerInfo[]; admin: boolean }> {
	return request("/runners", { label: "Failed to load Runners" });
}

export async function createRunnerPairing(): Promise<{ code: string; expiresAt: number }> {
	return request("/runners/pair", { method: "POST", label: "Could not create pairing" });
}

export type RunnerPatch = Partial<Pick<RunnerInfo, "label" | "description" | "location" | "maintenance" | "allowedUsers" | "allowedRepos" | "workspaceRoots">> & {
	permissions?: Partial<RunnerPermissions>;
	capabilities?: Partial<RunnerInfo["capabilities"]>;
};

export async function updateRunner(id: string, patch: RunnerPatch): Promise<RunnerInfo> {
	const response = await request<{ runner: RunnerInfo }>(`/runners/${encodeURIComponent(id)}`, { method: "PATCH", body: patch, label: "Could not update Runner" });
	return response.runner;
}

export async function revokeRunner(id: string): Promise<void> {
	await request(`/runners/${encodeURIComponent(id)}`, { method: "DELETE", label: "Could not revoke Runner" });
}
