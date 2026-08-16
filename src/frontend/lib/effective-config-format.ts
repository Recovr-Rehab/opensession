import type { EffectiveMcpServer } from "./api/effective-config";

/**
 * Reading helpers for the effective-config dump (components/SessionConfigPanel).
 *
 * The endpoint's rows are `{ value, source }` with `value` deliberately
 * untyped — a model id, a boolean, a list of scopes, a small labelled record.
 * These turn one into a line a person reads, and say nothing the dump did not
 * say: no row is re-decided here, only re-worded.
 */

/** An empty value in a list of settings — the table dash, not "null". */
const EMPTY = "–";

export function formatConfigValue(value: unknown): string {
	if (value === null || value === undefined) return EMPTY;
	if (typeof value === "boolean") return value ? "Yes" : "No";
	if (typeof value === "number") return String(value);
	if (typeof value === "string") return value.trim() ? value : EMPTY;
	if (Array.isArray(value))
		return value.length ? value.map(formatConfigValue).join(", ") : "None";
	if (typeof value === "object") {
		const record = value as Record<string, unknown>;
		// The dump's small records are labelled things: an account, a preset, a
		// commit author, a memory scope. Lead with the label, and keep the
		// `reason` the account rows carry — it is why that account was picked.
		const label =
			typeof record.name === "string" && record.name
				? record.name
				: typeof record.label === "string" && record.label
					? record.label
					: null;
		if (label)
			return typeof record.reason === "string" && record.reason
				? `${label} · ${record.reason}`
				: label;
		const parts = Object.entries(record)
			.filter(([, v]) => v !== null && v !== undefined && v !== "")
			.map(([key, v]) => `${key}: ${formatConfigValue(v)}`);
		return parts.length ? parts.join(" · ") : EMPTY;
	}
	return String(value);
}

/**
 * The MCP allowlist in one sentence. The three cases read very differently to
 * the person asking why a server is missing: no allowlist at all, a named set,
 * and the empty allowlist an automation recipe leaves behind.
 */
export function mcpScopeSummary(scope: string[] | "all" | undefined): string {
	if (scope === "all" || scope === undefined)
		return "No allowlist — every configured server this run's user may see";
	if (!scope.length)
		return "Empty allowlist — no external MCP server is offered to this run";
	return `Allowlist of ${scope.length}: ${scope.join(", ")}`;
}

export interface McpExclusionGroup {
	/** The gate, once. */
	reason: string;
	/** Every file or code path that reported this gate, de-duplicated. */
	sources: string[];
	/** Every server it hid, in the order the endpoint listed them. */
	names: string[];
	/** Transport per name, for the chip's tooltip. */
	transports: Record<string, string>;
}

/**
 * The servers a run cannot see, grouped by the gate that hid them.
 *
 * An automation's empty allowlist hides every configured server for one
 * reason, and seventeen copies of that sentence are not seventeen facts — they
 * bury the one exclusion that IS particular (an allowedUsers gate naming the
 * people who would clear it) under a wall of identical rows.
 */
export function groupMcpExclusions(
	servers: EffectiveMcpServer[],
): McpExclusionGroup[] {
	const groups = new Map<string, McpExclusionGroup>();
	for (const server of servers) {
		if (server.included) continue;
		// Keyed on the reason alone: the same gate can be reported from two
		// paths (a server carrying an allowedUsers list names that check in its
		// source even when the allowlist is what actually hid it), and splitting
		// on that prints the same sentence twice.
		const group = groups.get(server.reason) ?? {
			reason: server.reason,
			sources: [],
			names: [],
			transports: {},
		};
		group.names.push(server.name);
		group.transports[server.name] = server.transport;
		if (!group.sources.includes(server.source)) group.sources.push(server.source);
		groups.set(server.reason, group);
	}
	// Smallest first: a one-server gate is the particular answer, the bulk
	// exclusion is the standing rule.
	return [...groups.values()].sort((a, b) => a.names.length - b.names.length);
}

/** included / total, for the section's count. */
export function mcpCounts(servers: EffectiveMcpServer[]): {
	included: number;
	excluded: number;
	total: number;
} {
	const included = servers.filter((server) => server.included).length;
	return {
		included,
		excluded: servers.length - included,
		total: servers.length,
	};
}
