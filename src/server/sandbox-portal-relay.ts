/**
 * Session-scoped credentials for the outbound Sandbox Portal relay.
 *
 * This deliberately records no provider URL. A Sandbox agent may authenticate
 * only with the token minted for its exact {session, sandbox, port} tuple.
 */
import { randomBytes, timingSafeEqual } from "crypto";
import { sandboxHttpsPortFor } from "./sandbox/preview-ports";

export type SandboxPortalGrant = { sessionId: string; sandboxId: string; port: number; token: string; expiresAt: number };
type StoredGrant = Omit<SandboxPortalGrant, "token">;
const g = globalThis as Record<string, unknown>;
const grants: Map<string, StoredGrant> = (g.__opensessionSandboxPortalGrants ??= new Map()) as Map<string, StoredGrant>;
type Connection = { ws: any; sessionId: string; sandboxId: string; port: number; pending: Map<string, { resolve: (value: RelayResponse) => void; timer: ReturnType<typeof setTimeout> }> };
type RelayResponse = { status: number; headers: Record<string, string>; body?: string };
const connections: Map<string, Connection> = (g.__opensessionSandboxPortalConnections ??= new Map()) as Map<string, Connection>;
type Relay = { server: ReturnType<typeof Bun.serve>; sessionId: string; sandboxId: string; port: number };
const relays: Map<string, Relay> = (g.__opensessionSandboxPortalRelays ??= new Map()) as Map<string, Relay>;
const HOP_HEADERS = new Set(["connection", "host", "content-length", "transfer-encoding", "upgrade", "keep-alive", "proxy-authenticate", "proxy-authorization", "te", "trailer"]);

function key(sessionId: string, sandboxId: string, port: number): string { return `${sessionId}:${sandboxId}:${port}`; }
function safeHeaders(headers: Headers): Record<string, string> {
	const result: Record<string, string> = {};
	for (const [name, value] of headers) if (!HOP_HEADERS.has(name.toLowerCase()) && value.length <= 8192) result[name] = value;
	return result;
}

export function mintSandboxPortalGrant(input: { sessionId: string; sandboxId: string; port: number; ttlMs?: number }): SandboxPortalGrant {
	if (!/^[A-Za-z0-9_.-]{3,160}$/.test(input.sessionId) || !/^[A-Za-z0-9_.-]{3,240}$/.test(input.sandboxId) || !Number.isInteger(input.port) || input.port < 1024 || input.port > 19000) throw new Error("Invalid Sandbox Portal registration");
	const token = randomBytes(24).toString("base64url");
	const expiresAt = Date.now() + Math.min(Math.max(input.ttlMs ?? 10 * 60_000, 10_000), 60 * 60_000);
	grants.set(token, { sessionId: input.sessionId, sandboxId: input.sandboxId, port: input.port, expiresAt });
	return { ...grants.get(token)!, token };
}

export function verifySandboxPortalGrant(token: string, expected: Omit<StoredGrant, "expiresAt">): boolean {
	const grant = grants.get(token);
	if (!grant || grant.expiresAt <= Date.now()) { grants.delete(token); return false; }
	const a = Buffer.from(`${grant.sessionId}\0${grant.sandboxId}\0${grant.port}`);
	const b = Buffer.from(`${expected.sessionId}\0${expected.sandboxId}\0${expected.port}`);
	return a.length === b.length && timingSafeEqual(a, b);
}

export function revokeSandboxPortalGrants(sandboxId: string): void {
	for (const [token, grant] of grants) if (grant.sandboxId === sandboxId) grants.delete(token);
	for (const [id, connection] of connections) if (connection.sandboxId === sandboxId) { try { connection.ws.close(1008, "portal revoked"); } catch {} connections.delete(id); }
	for (const [id, relay] of relays) if (relay.sandboxId === sandboxId) { try { relay.server.stop(true); } catch {} void import("./preview").then(({ dropAuthenticatedPortalRoute }) => dropAuthenticatedPortalRoute(sandboxHttpsPortFor(`sandbox-${sandboxId}`, relay.port))); relays.delete(id); }
}

/** Upgrade only an outbound Sandbox relay whose expiring grant exactly matches
 * the declared session, sandbox, and loopback service port. */
export function handleSandboxPortalRelayUpgrade(req: Request, server: { upgrade(req: Request, opts?: { data?: unknown }): boolean }, path: string): Response | undefined {
	if (path !== "/sandbox-portal-ws") return undefined;
	const url = new URL(req.url);
	const sessionId = url.searchParams.get("session") || "";
	const sandboxId = url.searchParams.get("sandbox") || "";
	const port = Number(url.searchParams.get("port"));
	const auth = req.headers.get("authorization") || "";
	const token = auth.match(/^Bearer\s+(.+)$/i)?.[1] || url.searchParams.get("token") || "";
	if (!verifySandboxPortalGrant(token, { sessionId, sandboxId, port })) return new Response("unauthorized", { status: 403 });
	return server.upgrade(req, { data: { kind: "sandbox-portal-relay", sessionId, sandboxId, port } }) ? undefined : new Response("WebSocket upgrade failed", { status: 400 });
}

export function sandboxPortalRelayOpen(ws: any): boolean {
	if (ws.data?.kind !== "sandbox-portal-relay") return false;
	const { sessionId, sandboxId, port } = ws.data;
	const id = key(sessionId, sandboxId, port);
	connections.get(id)?.ws?.close?.(1000, "replaced");
	connections.set(id, { ws, sessionId, sandboxId, port, pending: new Map() });
	return true;
}
export function sandboxPortalRelayMessage(ws: any, raw: string | Buffer): boolean {
	if (ws.data?.kind !== "sandbox-portal-relay") return false;
	let message: any; try { message = JSON.parse(typeof raw === "string" ? raw : raw.toString()); } catch { return true; }
	if (message.t !== "http_result" || typeof message.id !== "string") return true;
	const connection = connections.get(key(ws.data.sessionId, ws.data.sandboxId, ws.data.port));
	if (!connection) return true;
	const pending = connection.pending.get(message.id);
	if (!pending) return true;
	clearTimeout(pending.timer); connection.pending.delete(message.id);
	pending.resolve({ status: Number.isInteger(message.status) ? message.status : 502, headers: message.headers && typeof message.headers === "object" ? message.headers : {}, body: typeof message.body === "string" ? message.body : undefined });
	return true;
}
export function sandboxPortalRelayClose(ws: any): boolean {
	if (ws.data?.kind !== "sandbox-portal-relay") return false;
	const connection = connections.get(key(ws.data.sessionId, ws.data.sandboxId, ws.data.port));
	if (connection && connection.ws === ws) { for (const pending of connection.pending.values()) { clearTimeout(pending.timer); pending.resolve({ status: 502, headers: {} }); } connections.delete(key(ws.data.sessionId, ws.data.sandboxId, ws.data.port)); }
	return true;
}

async function relayFetch(input: { sessionId: string; sandboxId: string; port: number }, request: Request): Promise<Response> {
	const connection = connections.get(key(input.sessionId, input.sandboxId, input.port));
	if (!connection) return new Response("Sandbox Portal is not connected", { status: 503 });
	const bytes = request.method === "GET" || request.method === "HEAD" ? undefined : new Uint8Array(await request.arrayBuffer());
	if (bytes && bytes.byteLength > 5 * 1024 * 1024) return new Response("Portal request is too large", { status: 413 });
	const id = crypto.randomUUID();
	const result = await new Promise<RelayResponse>((resolve) => {
		const timer = setTimeout(() => { connection.pending.delete(id); resolve({ status: 504, headers: {} }); }, 30_000);
		connection.pending.set(id, { resolve, timer });
		try { connection.ws.send(JSON.stringify({ t: "http", id, method: request.method, path: new URL(request.url).pathname + new URL(request.url).search, headers: safeHeaders(request.headers), ...(bytes ? { body: Buffer.from(bytes).toString("base64") } : {}) })); }
		catch { clearTimeout(timer); connection.pending.delete(id); resolve({ status: 502, headers: {} }); }
	});
	const headers = new Headers();
	for (const [name, value] of Object.entries(result.headers)) if (!HOP_HEADERS.has(name.toLowerCase()) && typeof value === "string") headers.set(name, value);
	const body = result.body ? Buffer.from(result.body, "base64") : undefined;
	return new Response(body, { status: result.status, headers });
}

/** Bind the browser-facing Portal route to a local-only server. The Sandbox
 * can reach it only through its one registered outbound control connection. */
export async function ensureSandboxPortalRelay(input: { sessionId: string; sandboxId: string; port: number }): Promise<string | null> {
	const id = key(input.sessionId, input.sandboxId, input.port);
	let relay = relays.get(id);
	if (!relay) {
		const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: (request) => relayFetch(input, request) });
		relay = { ...input, server }; relays.set(id, relay);
	}
	const { ensureAuthenticatedPortalRoute } = await import("./preview");
	return ensureAuthenticatedPortalRoute(sandboxHttpsPortFor(`sandbox-${input.sandboxId}`, input.port), `127.0.0.1:${relay.server.port}`);
}
