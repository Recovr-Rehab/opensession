/** Rebuild a remote Sandbox Portal's process-local relay after restart.
 *
 * Caddy and the durable HTTPS-port allocation outlive Open Session, while the
 * loopback relay and its authorization map deliberately do not. The first
 * authenticated request after restart uses durable presentation metadata only
 * to find a candidate, then verifies the live session and running sandbox
 * before restoring authority. A sleeping or replaced sandbox stays denied.
 */
import { ensureRemoteSandboxPortalAgent } from "./portal-supervisor";
import { portalRouteAuthorized } from "./preview";
import { sandboxAllocationForHttpsPort } from "./sandbox/preview-ports";
import { cachedSandboxPortalOwner } from "./sandbox-portals";
import { findSessionAsync } from "./session-cache";
import { activeSandboxFor } from "./session-sandbox";

const recovering = new Map<number, Promise<boolean>>();

export function recoverSandboxPortalRoute(httpsPort: number): Promise<boolean> {
	const current = recovering.get(httpsPort);
	if (current) return current;
	const recovery = recoverSandboxPortalRouteInner(httpsPort).finally(() =>
		recovering.delete(httpsPort),
	);
	recovering.set(httpsPort, recovery);
	return recovery;
}

async function recoverSandboxPortalRouteInner(httpsPort: number): Promise<boolean> {
	if (portalRouteAuthorized(httpsPort)) return true;
	const allocation = sandboxAllocationForHttpsPort(httpsPort);
	if (!allocation) return false;
	const sessionId = cachedSandboxPortalOwner(
		allocation.sandboxId,
		allocation.containerPort,
	);
	if (!sessionId) return false;
	const session = await findSessionAsync(sessionId);
	if (
		!session?.sandbox ||
		session.sandbox.sandboxId !== allocation.sandboxId
	) return false;
	const sandbox = await activeSandboxFor(session);
	if (!sandbox) return false;
	await ensureRemoteSandboxPortalAgent({
		sessionId,
		sandbox,
		port: allocation.containerPort,
	});
	return portalRouteAuthorized(httpsPort);
}
