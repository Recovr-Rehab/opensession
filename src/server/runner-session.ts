/**
 * Runner-backed session turns.
 *
 * A Runner owns only the workspace and detached run-host process. The server
 * remains the transcript, queue, approval, collaboration and RPC authority.
 * This deliberately uses the remote run-ws transport, not the command socket
 * as a second agent-event protocol.
 */

import { mkdirSync } from "fs";
import { configuredServer } from "./config";
import { HostHandle, type HandleCallbacks, type HostLauncher } from "./host-client";
import { runHostsDir, type RunHostSpec } from "../runner-host/protocol";
import { OPENSESSION_SESSIONS_DIR } from "./paths";
import { registerRunToken, unregisterRunToken } from "./run-rpc";
import { launchRunnerHost, runnerHostAlive } from "./runner-ws";
import { getRunner, runnerAvailableForSession, setRunnerWorkload } from "./runners";
import { registerRunWsHost, runWsConnector } from "./run-ws";
import type { UnifiedSession } from "./types";
import { interactiveMcpServers } from "./interactive-mcp";
import { interactiveFallbackModel } from "./models";
import { STRIPE_CONFIRM_TOOLS } from "./runner-shared";
import { gitIdentityFor } from "./shared/user-mappings";
import { makeAskHandler } from "./asks";
import type { McpScope } from "./runner-shared";
import type { StreamEvent } from "./agent-runner";
import type { ImageInput } from "./run-events";

type RunnerLaunchOpts = {
	prompt: string;
	engineSessionId?: string;
	images?: ImageInput[];
	mcpServers?: McpScope;
	user?: string;
	reposNote?: string;
};

type RunnerEvents = AsyncGenerator<StreamEvent> & { runnerId: string };

function serverWsBase(): string {
	return configuredServer().publicBaseUrl.replace(/\/$/, "");
}

/** Start a turn in the session-owned workspace already materialized by this Runner. */
export async function maybeLaunchRunnerRun(
	session: UnifiedSession,
	opts: RunnerLaunchOpts,
): Promise<RunnerEvents | null> {
	const target = session.runner;
	if (!target) return null;
	if (!session.repo || !session.worktreeDir) throw new Error("Runner session is missing its repository workspace");
	const runner = getRunner(target.id);
	if (!runner || !runnerAvailableForSession(runner, { user: opts.user, repo: session.repo, sessionId: session.id }))
		throw new Error("This Runner is no longer available for this session");

	const hostId = `rh-${Bun.randomUUIDv7()}`;
	const rpcToken = crypto.randomUUID();
	const wsToken = crypto.randomUUID();
	const hostDir = `${runHostsDir(OPENSESSION_SESSIONS_DIR)}/${hostId}`;
	mkdirSync(hostDir, { recursive: true });
	const spec: RunHostSpec = {
		hostId,
		osSessionId: session.id,
		prompt: opts.prompt,
		engineSessionId: opts.engineSessionId,
		cwd: session.worktreeDir,
		mode: session.mode,
		model: session.model,
		effort: session.effort,
		fastMode: session.fastMode,
		accountId: session.accountId,
		images: opts.images,
		mcpServers: opts.mcpServers ?? "all",
		proxyMcpServers: Object.keys(interactiveMcpServers(opts.user, session.id)),
		rpcToken,
		wsToken,
		reposNote: opts.reposNote,
		confirmTools: STRIPE_CONFIRM_TOOLS,
		author: gitIdentityFor(opts.user),
		user: opts.user,
		mcpGrantUser: session.startedBy || undefined,
		fallbackModel: interactiveFallbackModel(session.model),
		journalKind: "prompt",
	};
	registerRunToken(rpcToken, { sessionId: session.id, user: opts.user });
	registerRunWsHost(hostId, wsToken);
	setRunnerWorkload(runner.id, { sessionId: session.id, operation: "full session", startedAt: new Date().toISOString() });
	const hostSpecs = new Map<string, RunHostSpec>([[hostId, spec]]);

	const launcher: HostLauncher = {
		alive: (_dir, meta) => runnerHostAlive(meta?.hostId || hostId),
		newRunDir: (nextHostId) => `${runHostsDir(OPENSESSION_SESSIONS_DIR)}/${nextHostId}`,
		connector: (_dir, hostSpec) => runWsConnector(hostSpec.hostId),
		async writeSpec(_dir, nextSpec) {
			hostSpecs.set(nextSpec.hostId, nextSpec);
			registerRunWsHost(nextSpec.hostId, nextSpec.wsToken!);
		},
		async launch(nextHostId, _dir) {
			const nextSpec = hostSpecs.get(nextHostId);
			if (!nextSpec) throw new Error(`Missing Runner host specification for ${nextHostId}`);
			await launchRunnerHost(runner.id, {
				sessionId: session.id, repo: session.repo!, user: opts.user,
				server: serverWsBase(), spec: nextSpec,
			});
		},
	};
	const callbacks: HandleCallbacks = {
		onAskUser: makeAskHandler(session.id),
		onSteerFailed: () => {}, // normal queue handling re-delivers a later prompt
	};
	let handle: HostHandle | undefined;
	try {
		handle = new HostHandle(hostDir, spec, callbacks, launcher);
		await handle.connectWithWait(20_000);
		const events = (async function* (): AsyncGenerator<StreamEvent> {
			try {
				yield* handle!.events();
			} finally {
				setRunnerWorkload(runner.id, undefined);
			}
		})() as RunnerEvents;
		events.runnerId = runner.id;
		return events;
	} catch (error) {
		handle?.abandon();
		unregisterRunToken(rpcToken);
		setRunnerWorkload(runner.id, undefined);
		throw error;
	}
}
