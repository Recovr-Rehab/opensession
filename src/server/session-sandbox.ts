/**
 * Per-session sandbox lifecycle helpers (docker/daytona/e2b): tear-down on
 * delete/archive and "is the sandbox actually live right now" checks used by
 * the preview routes. The run-path launch lives in run-session.ts.
 */

import { getSandboxProvider, type Sandbox } from "./sandbox";
import { isRemoteSandboxProvider, sandboxesEnabled, sandboxProviderConfigured } from "./sandbox/config";
import { dockerContainerStatus } from "./sandbox/docker";
import { touchNativeSession } from "./session-cache";
import type { UnifiedSession } from "./types";

/**
 * Tear down a session's sandbox (container + engine-state volumes; in
 * volume-workspace mode also the workspace volume — documented data loss).
 * Best-effort and detached so a docker hiccup never blocks the caller
 * (session delete, archive sweep). `clearSandboxId` drops the stale id from
 * the session file so later sweeps don't re-destroy — only for sessions that
 * keep existing (the archive sweep); a deleted session has no file to touch.
 */
export function destroySessionSandbox(
	session: UnifiedSession,
	why: string,
	clearSandboxId = false,
): void {
	const sb = session.sandbox;
	if (!sb?.sandboxId) return;
	void (async () => {
		try {
			await getSandboxProvider(sb.provider).destroy(sb.sandboxId!);
			console.log(
				`[sandbox] destroyed ${sb.sandboxId} for ${session.id} (${why})`,
			);
			if (clearSandboxId && session.source === "opensession")
				touchNativeSession(session.id, {
					sandbox: { ...sb, sandboxId: undefined },
				});
		} catch (e) {
			console.warn(
				`[sandbox] destroy ${sb.sandboxId} for ${session.id} (${why}) failed:`,
				e,
			);
		}
	})();
}

/**
 * Resolve a live sandbox. Status inspection is deliberately non-waking: a
 * sleeping session remains readable and its Portals sidebar must not spend
 * compute merely to render. Callers performing an explicit compute action pass
 * `wake: true`.
 */
export async function activeSandboxFor(
	session: UnifiedSession,
	options: { wake?: boolean } = {},
): Promise<Sandbox | null> {
	const sb = session.sandbox;
	if (!sb?.provider || !sb.sandboxId) return null;
	if (!sandboxesEnabled()) return null;
	if (isRemoteSandboxProvider(sb.provider)) {
		if (!sandboxProviderConfigured(sb.provider)) return null;
		try {
			const provider = getSandboxProvider(sb.provider);
			let sandbox = await provider.get(sb.sandboxId);
			if (sandbox && (await sandbox.status()) === "stopped" && options.wake && provider.resume) {
				sandbox = await provider.resume(sb.sandboxId);
			}
			return sandbox && (await sandbox.status()) === "running" ? sandbox : null;
		} catch {
			return null;
		}
	}
	if (sb.provider !== "docker") return null;
	// Provider-configured, not config-default: a session may have picked
	// docker explicitly while the config default is another provider.
	if (!sandboxProviderConfigured("docker")) return null;
	try {
		if ((await dockerContainerStatus(sb.sandboxId)) !== "running") return null;
		return await getSandboxProvider("docker").get(sb.sandboxId);
	} catch {
		return null;
	}
}
