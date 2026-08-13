import { expect, test } from "bun:test";
import { handleSandboxPortalRelayUpgrade, mintSandboxPortalGrant, revokeSandboxPortalGrants, verifySandboxPortalGrant } from "./sandbox-portal-relay";

test("Sandbox Portal grants bind one session, Sandbox, and port", () => {
	const grant = mintSandboxPortalGrant({ sessionId: "bks-test", sandboxId: "sandbox-test", port: 4300 });
	expect(verifySandboxPortalGrant(grant.token, { sessionId: "bks-test", sandboxId: "sandbox-test", port: 4300 })).toBe(true);
	expect(verifySandboxPortalGrant(grant.token, { sessionId: "bks-other", sandboxId: "sandbox-test", port: 4300 })).toBe(false);
	expect(verifySandboxPortalGrant(grant.token, { sessionId: "bks-test", sandboxId: "sandbox-test", port: 4301 })).toBe(false);
	revokeSandboxPortalGrants("sandbox-test");
	expect(verifySandboxPortalGrant(grant.token, { sessionId: "bks-test", sandboxId: "sandbox-test", port: 4300 })).toBe(false);
});

test("relay upgrade rejects an unbound credential before WebSocket upgrade", () => {
	const grant = mintSandboxPortalGrant({ sessionId: "bks-relay", sandboxId: "sandbox-relay", port: 4400 });
	let upgraded: unknown;
	const server = { upgrade(_req: Request, options?: { data?: unknown }) { upgraded = options?.data; return true; } };
	const accepted = handleSandboxPortalRelayUpgrade(new Request("https://sessions.test/sandbox-portal-ws?session=bks-relay&sandbox=sandbox-relay&port=4400", { headers: { authorization: `Bearer ${grant.token}` } }), server, "/sandbox-portal-ws");
	expect(accepted).toBeUndefined();
	expect(upgraded).toMatchObject({ kind: "sandbox-portal-relay", sessionId: "bks-relay", sandboxId: "sandbox-relay", port: 4400 });
	const denied = handleSandboxPortalRelayUpgrade(new Request("https://sessions.test/sandbox-portal-ws?session=bks-relay&sandbox=sandbox-relay&port=4401", { headers: { authorization: `Bearer ${grant.token}` } }), server, "/sandbox-portal-ws");
	expect(denied?.status).toBe(403);
});
