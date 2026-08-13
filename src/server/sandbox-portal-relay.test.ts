import { expect, test } from "bun:test";
import { mintSandboxPortalGrant, revokeSandboxPortalGrants, verifySandboxPortalGrant } from "./sandbox-portal-relay";

test("Sandbox Portal grants bind one session, Sandbox, and port", () => {
	const grant = mintSandboxPortalGrant({ sessionId: "bks-test", sandboxId: "sandbox-test", port: 4300 });
	expect(verifySandboxPortalGrant(grant.token, { sessionId: "bks-test", sandboxId: "sandbox-test", port: 4300 })).toBe(true);
	expect(verifySandboxPortalGrant(grant.token, { sessionId: "bks-other", sandboxId: "sandbox-test", port: 4300 })).toBe(false);
	expect(verifySandboxPortalGrant(grant.token, { sessionId: "bks-test", sandboxId: "sandbox-test", port: 4301 })).toBe(false);
	revokeSandboxPortalGrants("sandbox-test");
	expect(verifySandboxPortalGrant(grant.token, { sessionId: "bks-test", sandboxId: "sandbox-test", port: 4300 })).toBe(false);
});
