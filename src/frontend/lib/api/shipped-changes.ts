import { request } from "./request";

export function shareShippedChange(
	sessionId: string,
	target: { repo?: string; branch?: string; channel?: string; message?: string },
): Promise<{ status: "shared" | "already_shared" }> {
	return request(`/sessions/${encodeURIComponent(sessionId)}/share-shipped-change`, {
		method: "POST",
		body: target,
		label: "Couldn't share the shipped update",
	});
}

export function fetchShippedChangeChannels(sessionId: string): Promise<{
	channels: Array<{ id: string; name: string }>;
	defaultChannel?: string;
}> {
	return request(`/sessions/${encodeURIComponent(sessionId)}/share-shipped-change`, {
		label: "Couldn't load Slack channels",
	});
}

export function requestShippedChangeScreenshot(
	sessionId: string,
): Promise<{ status: "capturing"; workerSessionId: string }> {
	return request(`/sessions/${encodeURIComponent(sessionId)}/request-shipped-screenshot`, {
		method: "POST",
		body: {},
		label: "Couldn't request a screenshot",
	});
}
