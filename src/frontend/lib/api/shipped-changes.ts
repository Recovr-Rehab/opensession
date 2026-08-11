import { request } from "./request";

export function shareShippedChange(
	sessionId: string,
	target: { repo?: string; branch?: string },
): Promise<{ status: "shared" | "already_shared" }> {
	return request(`/sessions/${encodeURIComponent(sessionId)}/share-shipped-change`, {
		method: "POST",
		body: target,
		label: "Couldn't share the visual change",
	});
}
