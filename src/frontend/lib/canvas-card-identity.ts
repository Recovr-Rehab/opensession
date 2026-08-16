import type { UnifiedSession } from "./types";

const IDENTITY_COLORS = [
	"#2563eb",
	"#7c3aed",
	"#db2777",
	"#dc2626",
	"#d97706",
	"#059669",
	"#0891b2",
];

function personKey(value?: string | null): string {
	return value?.trim().split(/\s+/)[0]?.toLowerCase() || "";
}

export function canvasIdentityColor(identity: string): string {
	let hash = 0;
	for (const char of identity.toLowerCase()) {
		hash = (hash * 31 + char.charCodeAt(0)) | 0;
	}
	return IDENTITY_COLORS[Math.abs(hash) % IDENTITY_COLORS.length]!;
}

export type CanvasCardCreator =
	| { kind: "automation"; name: string; color: string }
	| { kind: "person"; name: string; login?: string; color: string }
	| { kind: "unknown"; color: null };

export function canvasCardCreator(session: UnifiedSession): CanvasCardCreator {
	if (session.automation) {
		return {
			kind: "automation",
			name: session.automation,
			color: canvasIdentityColor(`automation:${session.automationId || session.automation}`),
		};
	}
	const name = session.createdBy || session.startedBy;
	if (!name) return { kind: "unknown", color: null };
	return {
		kind: "person",
		name,
		login: session.createdByLogin,
		color: canvasIdentityColor(session.createdByLogin || personKey(name)),
	};
}

export function canvasCardCollaborators(
	session: UnifiedSession,
	teamViewing: Array<{ user: string; sessionId: string }>,
	currentUser?: string | null,
): string[] {
	const creator = canvasCardCreator(session);
	const creatorKey = creator.kind === "person" ? personKey(creator.name) : "";
	const currentUserKey = personKey(currentUser);
	const seen = new Set<string>();
	const collaborators: string[] = [];
	for (const viewer of teamViewing) {
		if (viewer.sessionId !== session.id) continue;
		const key = personKey(viewer.user);
		if (!key || key === creatorKey || key === currentUserKey || seen.has(key)) continue;
		seen.add(key);
		collaborators.push(viewer.user);
	}
	return collaborators;
}

export function canvasCardSurface(session: UnifiedSession): string {
	const color = canvasCardCreator(session).color;
	return color
		? `color-mix(in oklab, ${color} 7%, var(--bg-panel))`
		: "var(--bg-panel)";
}
