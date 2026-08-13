/**
 * Session-scoped credentials for the outbound Sandbox Portal relay.
 *
 * This deliberately records no provider URL. A Sandbox agent may authenticate
 * only with the token minted for its exact {session, sandbox, port} tuple.
 */
import { randomBytes, timingSafeEqual } from "crypto";

export type SandboxPortalGrant = { sessionId: string; sandboxId: string; port: number; token: string; expiresAt: number };
type StoredGrant = Omit<SandboxPortalGrant, "token">;
const g = globalThis as Record<string, unknown>;
const grants: Map<string, StoredGrant> = (g.__opensessionSandboxPortalGrants ??= new Map()) as Map<string, StoredGrant>;

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
}
