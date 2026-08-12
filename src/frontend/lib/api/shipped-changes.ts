import { request } from "./request";

export function shareShippedChange(
	sessionId: string,
	target: { repo?: string; branch?: string; channel?: string; message?: string; screenshots?: string[] },
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
	canUploadImages?: boolean;
}> {
	return request(`/sessions/${encodeURIComponent(sessionId)}/share-shipped-change`, {
		label: "Couldn't load Slack channels",
	});
}

export async function reconnectSlack(): Promise<void> {
	const popup = window.open("about:blank", "_blank");
	const result = await request<{ url: string }>("/connections/mcp/slack/oauth/start", {
		method: "POST",
		body: { scope: "me" },
		label: "Couldn't reconnect Slack",
	});
	if (popup) popup.location.href = result.url;
	else window.location.href = result.url;
}
