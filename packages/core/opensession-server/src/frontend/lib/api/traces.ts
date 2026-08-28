import { request } from "./request";

export interface TracesConnectedAccount {
	githubLogin: string;
	tracesUserId: string;
	displayName: string;
	namespaceSlug: string;
	namespaceType: string;
	connectedAt: string;
	needsReconnect?: boolean;
}

export async function fetchTracesStatus(): Promise<{
	cliPresent: boolean;
	namespaceSlug: string | null;
	me: TracesConnectedAccount | null;
	accounts: TracesConnectedAccount[];
}> {
	return request("/traces/status", { label: "Traces status" });
}

export async function startTracesConnect(): Promise<{
	state: string;
	verificationUrl: string;
	expiresIn: number;
	pollInterval: number;
}> {
	return request("/traces/connect", { method: "POST", label: "Traces connect" });
}

export async function pollTracesConnect(state: string): Promise<
	| { status: "pending" }
	| { status: "ok"; account: TracesConnectedAccount }
	| { status: "error"; error: string }
> {
	return request("/traces/connect/poll", {
		method: "POST",
		body: { state },
		label: "Traces connect poll",
	});
}

export async function disconnectTraces(): Promise<{ ok: boolean }> {
	return request("/traces/connect", { method: "DELETE", label: "Traces disconnect" });
}
