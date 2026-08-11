import type { PreviewService } from "./api";

/** A running preview service opened in the center-panel browser. */
export interface PortalTarget {
	sessionId: string;
	name: string;
	key: string;
	port: number;
	url: string;
}

export function portalTargetFor(
	sessionId: string,
	service: PreviewService,
): PortalTarget | null {
	if (!service.running || !service.previewUrl) return null;
	return {
		sessionId,
		name: service.name,
		key: service.key,
		port: service.port,
		url: service.previewUrl,
	};
}

