import { request } from "./request";

/**
 * GET /api/sessions/:id/effective-config — the composed configuration a
 * session's next turn would run with (docs/effective-config.md).
 *
 * The shapes below mirror `EffectiveConfig` in src/server/effective-config.ts.
 * They are hand-copied the way the rest of this app's server types are: a row
 * is `{ value, source }` plus the two optional fields, so a new section on the
 * server arrives here as an unread key rather than a type error.
 *
 * The endpoint runs the real resolvers (it peeks the account pool, filters the
 * MCP catalog, evaluates the run gate), so callers fetch it on demand — never
 * on a render or a poll.
 */
export interface EffectiveConfigRow<T = unknown> {
	value: T;
	/** File, config key or code path that decided this. */
	source: string;
	/** "load-dependent" rows are re-resolved when the turn actually starts. */
	stability?: "static" | "load-dependent";
	note?: string;
}

export interface EffectiveMcpServer {
	name: string;
	/** The run's model will see this server's tools. */
	included: boolean;
	reason: string;
	source: string;
	transport: "local" | "remote" | "unknown";
	allowedUsers?: string[];
	oauthGrant?: boolean;
}

export interface EffectiveStrippedTool {
	tool: string;
	ids: string[];
	source: string;
	reason: string;
}

/** One section: a record of named rows. */
export type EffectiveConfigSection = Record<string, EffectiveConfigRow>;

export interface SessionEffectiveConfig {
	session: {
		id: string;
		title?: string;
		source?: string;
		workspaceId?: string | null;
		repo?: string | null;
		automation?: string | null;
		goalId?: string | null;
		archived?: boolean;
	};
	resolvedAt: string;
	caveat: string;
	execution: EffectiveConfigSection;
	gate: EffectiveConfigSection;
	model: EffectiveConfigSection;
	account: EffectiveConfigSection;
	mcp: {
		scope: EffectiveConfigRow<string[] | "all">;
		servers: EffectiveMcpServer[];
		inProcess: EffectiveConfigSection;
	};
	tools: EffectiveConfigSection;
	agents: EffectiveConfigSection;
	memory: EffectiveConfigSection;
	placement: EffectiveConfigSection;
	identity: EffectiveConfigSection;
	instructions: EffectiveConfigSection;
}

export async function fetchSessionEffectiveConfig(
	sessionId: string,
	/** Who the next turn would be attributed to. Ignored by the server while
	 *  web sign-in is active — the verified identity wins there. */
	user?: string,
	signal?: AbortSignal,
): Promise<SessionEffectiveConfig> {
	const query = user ? `?user=${encodeURIComponent(user)}` : "";
	return request<SessionEffectiveConfig>(
		`/sessions/${encodeURIComponent(sessionId)}/effective-config${query}`,
		{ label: "Failed to load effective config", signal },
	);
}
