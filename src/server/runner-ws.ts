/**
 * Versioned outbound Runner control channel.
 *
 * The server never dials a Runner.  Every command carries a one-use operation
 * token and is bounded in time/output; the channel is deliberately HTTP/agent
 * control only and is not a generic network tunnel.
 */

import { randomBytes } from "crypto";
import { audit } from "./audit";
import { authenticateRunner, getRunner, isTailnetAddress, runnerAllowed, runnerOwnsWorkspace, touchRunner, type Runner } from "./runners";
import type { RunHostSpec } from "../runner-host/protocol";

const g = globalThis as Record<string, unknown>;
const PROTOCOL_VERSION = 1;
const MAX_OUTPUT = 200_000;
const DEFAULT_TIMEOUT_MS = 10 * 60_000;

type Pending = {
	stdout: string[];
	stderr: string[];
	resolve: (result: RunnerExecResult) => void;
	timer: ReturnType<typeof setTimeout>;
	operationToken: string;
};

type Connection = {
	ws: any;
	runner: Runner;
	connectedAt: number;
	protocolVersion: number;
	capabilities: Runner["capabilities"];
	resources?: Runner["resources"];
	pending: Map<string, Pending>;
};

const connections: Map<string, Connection> = (g.__opensessionRunnerConnections ??= new Map()) as Map<string, Connection>;
/** A Runner reports this after its detached run host exits. Absence means the
 * host may reconnect, so the server does not kill a live turn during a brief
 * Runner-channel reconnect. */
const exitedHosts: Set<string> = (g.__opensessionRunnerExitedHosts ??= new Set()) as Set<string>;
let executionCounter = 0;

export type RunnerExecResult = { code: number; stdout: string; stderr: string; timedOut?: boolean };
export type RunnerExecOptions = { cwd?: string; timeoutMs?: number; user?: string; repo?: string; sessionId?: string };

/**
 * The server chooses this whole path. A Runner never receives a caller's home
 * checkout or an arbitrary `cwd` for a full session.
 */
export type RunnerWorkspaceRequest = {
	sessionId: string;
	repo: string;
	branch: string;
	workspacePath: string;
	repositoryUrl: string;
	/** Short-lived, repository-scoped clone credential. Never persisted. */
	cloneToken?: string;
	user?: string;
};

export type RunnerWorkspaceResult = { cwd: string };

export type RunnerHostRequest = {
	sessionId: string;
	repo: string;
	user?: string;
	server: string;
	spec: RunHostSpec;
};

/** Internal workspace operations (diff, files, session terminal) use the
 * Runner channel too. The cwd is pinned to the session-owned root before the
 * command crosses the machine boundary. */
export async function execRunnerWorkspace(
	runnerId: string,
	input: { sessionId: string; repo: string; workspacePath: string; command: string; user?: string; timeoutMs?: number },
): Promise<RunnerExecResult> {
	const connection = connections.get(runnerId);
	if (!connection || connection.protocolVersion !== PROTOCOL_VERSION) throw new Error(`Runner ${runnerId} is not connected`);
	if (!runnerAllowed(connection.runner, { user: input.user, repo: input.repo, permission: "fullSessions" }))
		throw new Error(`Runner ${connection.runner.name} is not permitted for this session workspace`);
	if (!runnerOwnsWorkspace(connection.runner, input.workspacePath, input.sessionId))
		throw new Error("Runner workspace path is outside its managed roots");
	return execRunnerCommand(connection, runnerId, input.command, {
		cwd: input.workspacePath, timeoutMs: input.timeoutMs, user: input.user, repo: input.repo, sessionId: input.sessionId,
		permission: "fullSessions", operation: "workspace",
	});
}

export function connectedRunnerIds(): string[] {
	return [...connections.keys()];
}

export function isRunnerConnected(id: string): boolean {
	return connections.has(id);
}

export function runnerHostAlive(hostId: string): boolean {
	return !exitedHosts.has(hostId);
}

/** Ask the Runner whether its detached host is still alive. This remains
 * accurate after the Runner service reconnects, unlike an in-memory map. */
export async function runnerHostStatus(
	runnerId: string,
	input: { sessionId: string; repo: string; workspacePath: string; hostId: string; user?: string },
): Promise<boolean> {
	const connection = connections.get(runnerId);
	if (!connection || connection.protocolVersion !== PROTOCOL_VERSION) return false;
	if (!runnerAllowed(connection.runner, { user: input.user, repo: input.repo, permission: "fullSessions" })) return false;
	if (!runnerOwnsWorkspace(connection.runner, input.workspacePath, input.sessionId)) return false;
	const id = `rs${++executionCounter}-${Date.now().toString(36)}`;
	const operationToken = randomBytes(18).toString("base64url");
	const result = await new Promise<RunnerExecResult>((resolve) => {
		const timer = setTimeout(() => {
			const pending = connection.pending.get(id); if (!pending) return;
			connection.pending.delete(id);
			resolve({ code: -1, stdout: "", stderr: "Runner host status timed out", timedOut: true });
		}, 15_000);
		connection.pending.set(id, { stdout: [], stderr: [], resolve, timer, operationToken });
		try {
			connection.ws.send(JSON.stringify({
				t: "host_status", version: PROTOCOL_VERSION, id, operationToken,
				sessionId: input.sessionId, repo: input.repo, workspacePath: input.workspacePath, hostId: input.hostId,
			}));
		} catch (error) {
			clearTimeout(timer); connection.pending.delete(id);
			resolve({ code: -1, stdout: "", stderr: `Could not reach Runner: ${(error as Error).message}` });
		}
	});
	return result.code === 0 && result.stdout === "alive";
}

export function disconnectRunner(id: string, reason = "revoked"): boolean {
	const connection = connections.get(id);
	if (!connection) return false;
	try { connection.ws.close(1008, reason); } catch {}
	return true;
}

export function handleRunnerWsUpgrade(
	req: Request,
	server: { upgrade(req: Request, opts: any): boolean; requestIP?(req: Request): { address: string } | null },
	path: string,
): Response | undefined {
	if (path !== "/runner-ws") return undefined;
	if (!isTailnetAddress(server.requestIP?.(req)?.address ?? "")) return new Response("forbidden", { status: 403 });
	const url = new URL(req.url);
	const id = url.searchParams.get("id") ?? "";
	const authorization = req.headers.get("authorization") ?? "";
	const token = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
	const runner = id && token ? authenticateRunner(id, token) : undefined;
	if (!runner) return new Response("unauthorized", { status: 401 });
	return server.upgrade(req, { data: { kind: "runner", runnerId: runner.id } }) ? undefined : new Response("upgrade failed", { status: 400 });
}

export function runnerWsOpen(ws: any): boolean {
	const runnerId = ws.data?.kind === "runner" ? ws.data.runnerId : undefined;
	if (!runnerId) return false;
	connections.get(runnerId)?.ws?.close?.(1000, "replaced by reconnect");
	const runner = getRunner(runnerId);
	if (!runner) { ws.close(1008, "revoked"); return true; }
	connections.set(runnerId, { ws, runner, connectedAt: Date.now(), protocolVersion: 0, capabilities: runner.capabilities, resources: runner.resources, pending: new Map() });
	touchRunner(runnerId);
	console.log(`[runners] ${runner.name} attached (${runnerId})`);
	return true;
}

export function runnerWsMessage(ws: any, raw: string | Buffer): boolean {
	const runnerId = ws.data?.kind === "runner" ? ws.data.runnerId : undefined;
	if (!runnerId) return false;
	const connection = connections.get(runnerId);
	if (!connection) return true;
	let message: any;
	try { message = JSON.parse(typeof raw === "string" ? raw : raw.toString()); } catch { return true; }

	switch (message?.t) {
		case "hello": {
			const version = Number(message.version ?? 0);
			if (version !== PROTOCOL_VERSION) { ws.close(1008, "unsupported protocol"); return true; }
			connection.protocolVersion = version;
			const capabilities = message.capabilities && typeof message.capabilities === "object" ? message.capabilities : connection.runner.capabilities;
			const resources = message.resources && typeof message.resources === "object" ? message.resources : connection.runner.resources;
			connection.capabilities = capabilities;
			connection.resources = resources;
			touchRunner(runnerId, { capabilities, resources, softwareVersion: typeof message.softwareVersion === "string" ? message.softwareVersion : undefined });
			return true;
		}
		case "heartbeat":
			touchRunner(runnerId, { capabilities: message.capabilities, resources: message.resources, softwareVersion: typeof message.softwareVersion === "string" ? message.softwareVersion : undefined });
			return true;
		case "out": {
			const pending = connection.pending.get(String(message.id));
			if (!pending || message.operationToken !== pending.operationToken) return true;
			const bucket = message.stream === "stderr" ? pending.stderr : pending.stdout;
			if (bucket.join("").length < MAX_OUTPUT) bucket.push(String(message.data ?? "").slice(0, MAX_OUTPUT));
			return true;
		}
		case "exit": {
			const id = String(message.id);
			const pending = connection.pending.get(id);
			if (!pending || message.operationToken !== pending.operationToken) return true;
			clearTimeout(pending.timer);
			connection.pending.delete(id);
			pending.resolve({ code: Number(message.code ?? 0), stdout: pending.stdout.join(""), stderr: pending.stderr.join("") });
			return true;
		}
		case "workspace_ready": {
			const id = String(message.id);
			const pending = connection.pending.get(id);
			if (!pending || message.operationToken !== pending.operationToken) return true;
			clearTimeout(pending.timer);
			connection.pending.delete(id);
			pending.resolve({ code: 0, stdout: String(message.cwd || ""), stderr: "" });
			return true;
		}
		case "workspace_error": {
			const id = String(message.id);
			const pending = connection.pending.get(id);
			if (!pending || message.operationToken !== pending.operationToken) return true;
			clearTimeout(pending.timer);
			connection.pending.delete(id);
			pending.resolve({ code: -1, stdout: "", stderr: String(message.error || "Workspace preparation failed") });
			return true;
		}
		case "host_started": {
			const id = String(message.id);
			const pending = connection.pending.get(id);
			if (!pending || message.operationToken !== pending.operationToken) return true;
			clearTimeout(pending.timer);
			connection.pending.delete(id);
			pending.resolve({ code: 0, stdout: String(message.hostId || ""), stderr: "" });
			return true;
		}
		case "host_error": {
			const id = String(message.id);
			const pending = connection.pending.get(id);
			if (!pending || message.operationToken !== pending.operationToken) return true;
			clearTimeout(pending.timer);
			connection.pending.delete(id);
			pending.resolve({ code: -1, stdout: "", stderr: String(message.error || "Runner host launch failed") });
			return true;
		}
		case "host_exited":
			exitedHosts.add(String(message.hostId));
			return true;
		case "host_status": {
			const id = String(message.id);
			const pending = connection.pending.get(id);
			if (!pending || message.operationToken !== pending.operationToken) return true;
			clearTimeout(pending.timer);
			connection.pending.delete(id);
			pending.resolve({ code: message.alive === true ? 0 : 1, stdout: message.alive === true ? "alive" : "dead", stderr: "" });
			return true;
		}
	}
	return true;
}

/** Materialize only a session-owned workspace under an admin-approved root. */
export async function prepareRunnerWorkspace(
	runnerId: string,
	request: RunnerWorkspaceRequest,
): Promise<RunnerWorkspaceResult> {
	const connection = connections.get(runnerId);
	if (!connection || connection.protocolVersion !== PROTOCOL_VERSION)
		throw new Error(`Runner ${runnerId} is not connected`);
	if (!runnerAllowed(connection.runner, { user: request.user, repo: request.repo, permission: "fullSessions" }))
		throw new Error(`Runner ${connection.runner.name} is not permitted for full sessions`);
	if (!connection.runner.workspaceRoots.length)
		throw new Error(`Runner ${connection.runner.name} has no managed workspace root`);
	if (!runnerOwnsWorkspace(connection.runner, request.workspacePath, request.sessionId))
		throw new Error("Runner workspace path is outside its managed roots");
	const id = `rw${++executionCounter}-${Date.now().toString(36)}`;
	const operationToken = randomBytes(18).toString("base64url");
	audit({ msg: "runner_workspace_prepare_start", runner_id: runnerId, session_id: request.sessionId, repo: request.repo, operation_id: id });
	const result = await new Promise<RunnerExecResult>((resolve) => {
		const timer = setTimeout(() => {
			const pending = connection.pending.get(id); if (!pending) return;
			connection.pending.delete(id);
			try { connection.ws.send(JSON.stringify({ t: "cancel", id, operationToken })); } catch {}
			resolve({ code: -1, stdout: "", stderr: "Runner workspace preparation timed out", timedOut: true });
		}, 5 * 60_000);
		connection.pending.set(id, { stdout: [], stderr: [], resolve, timer, operationToken });
		try {
			connection.ws.send(JSON.stringify({
				t: "workspace_prepare", version: PROTOCOL_VERSION, id, operationToken,
				sessionId: request.sessionId, repo: request.repo, branch: request.branch,
				workspacePath: request.workspacePath, repositoryUrl: request.repositoryUrl,
				...(request.cloneToken ? { cloneToken: request.cloneToken } : {}),
			}));
		} catch (error) {
			clearTimeout(timer); connection.pending.delete(id);
			resolve({ code: -1, stdout: "", stderr: `Could not reach Runner: ${(error as Error).message}` });
		}
	});
	if (result.code !== 0 || result.stdout !== request.workspacePath) {
		audit({ msg: "runner_workspace_prepare_finish", runner_id: runnerId, session_id: request.sessionId, repo: request.repo, operation_id: id, outcome: "failed" });
		throw new Error(result.stderr || "Runner returned an unexpected workspace path");
	}
	audit({ msg: "runner_workspace_prepare_finish", runner_id: runnerId, session_id: request.sessionId, repo: request.repo, operation_id: id, outcome: "ok" });
	return { cwd: result.stdout };
}

/** Start one run-host in a server-selected Runner workspace. */
export async function launchRunnerHost(
	runnerId: string,
	request: RunnerHostRequest,
): Promise<void> {
	const connection = connections.get(runnerId);
	if (!connection || connection.protocolVersion !== PROTOCOL_VERSION)
		throw new Error(`Runner ${runnerId} is not connected`);
	if (!runnerAllowed(connection.runner, { user: request.user, repo: request.repo, permission: "fullSessions" }))
		throw new Error(`Runner ${connection.runner.name} is not permitted for full sessions`);
	if (!runnerOwnsWorkspace(connection.runner, request.spec.cwd, request.sessionId))
		throw new Error("Runner host path is outside its managed workspace roots");
	const id = `rh${++executionCounter}-${Date.now().toString(36)}`;
	const operationToken = randomBytes(18).toString("base64url");
	exitedHosts.delete(request.spec.hostId);
	audit({ msg: "runner_host_launch_start", runner_id: runnerId, session_id: request.sessionId, repo: request.repo, operation_id: id, host_id: request.spec.hostId });
	const result = await new Promise<RunnerExecResult>((resolve) => {
		const timer = setTimeout(() => {
			const pending = connection.pending.get(id); if (!pending) return;
			connection.pending.delete(id);
			try { connection.ws.send(JSON.stringify({ t: "cancel", id, operationToken })); } catch {}
			resolve({ code: -1, stdout: "", stderr: "Runner host launch timed out", timedOut: true });
		}, 60_000);
		connection.pending.set(id, { stdout: [], stderr: [], resolve, timer, operationToken });
		try {
			connection.ws.send(JSON.stringify({
				t: "run_host", version: PROTOCOL_VERSION, id, operationToken,
				sessionId: request.sessionId, repo: request.repo, server: request.server, spec: request.spec,
			}));
		} catch (error) {
			clearTimeout(timer); connection.pending.delete(id);
			resolve({ code: -1, stdout: "", stderr: `Could not reach Runner: ${(error as Error).message}` });
		}
	});
	if (result.code !== 0 || result.stdout !== request.spec.hostId) {
		audit({ msg: "runner_host_launch_finish", runner_id: runnerId, session_id: request.sessionId, repo: request.repo, operation_id: id, host_id: request.spec.hostId, outcome: "failed" });
		throw new Error(result.stderr || "Runner returned an unexpected run host identity");
	}
	audit({ msg: "runner_host_launch_finish", runner_id: runnerId, session_id: request.sessionId, repo: request.repo, operation_id: id, host_id: request.spec.hostId, outcome: "ok" });
}

export function runnerWsClose(ws: any): boolean {
	const runnerId = ws.data?.kind === "runner" ? ws.data.runnerId : undefined;
	if (!runnerId) return false;
	const connection = connections.get(runnerId);
	if (!connection || connection.ws !== ws) return true;
	for (const pending of connection.pending.values()) {
		clearTimeout(pending.timer);
		pending.resolve({ code: -1, stdout: pending.stdout.join(""), stderr: `${pending.stderr.join("")}\n[Runner disconnected]` });
	}
	connections.delete(runnerId);
	console.log(`[runners] ${connection.runner.name} detached (${runnerId})`);
	return true;
}

export async function execOnRunner(runnerId: string, command: string, options: RunnerExecOptions = {}): Promise<RunnerExecResult> {
	const connection = connections.get(runnerId);
	if (!connection || connection.protocolVersion !== PROTOCOL_VERSION) throw new Error(`Runner ${runnerId} is not connected`);
	if (!runnerAllowed(connection.runner, { user: options.user, repo: options.repo, permission: "commands" })) throw new Error(`Runner ${connection.runner.name} is not permitted for this command`);
	return execRunnerCommand(connection, runnerId, command, { ...options, permission: "commands", operation: "command" });
}

async function execRunnerCommand(
	connection: Connection,
	runnerId: string,
	command: string,
	options: RunnerExecOptions & { permission: "commands" | "fullSessions"; operation: string },
): Promise<RunnerExecResult> {
	const id = `r${++executionCounter}-${Date.now().toString(36)}`;
	const operationToken = randomBytes(18).toString("base64url");
	const timeoutMs = Math.min(Math.max(options.timeoutMs ?? DEFAULT_TIMEOUT_MS, 1_000), 60 * 60_000);
	audit({ msg: `runner_${options.operation}_start`, runner_id: runnerId, session_id: options.sessionId, user: options.user, repo: options.repo, command: command.slice(0, 500), operation_id: id });
	const result = await new Promise<RunnerExecResult>((resolve) => {
		const timer = setTimeout(() => {
			const pending = connection.pending.get(id);
			if (!pending) return;
			connection.pending.delete(id);
			try { connection.ws.send(JSON.stringify({ t: "cancel", id, operationToken })); } catch {}
			resolve({ code: -1, stdout: pending.stdout.join(""), stderr: pending.stderr.join(""), timedOut: true });
		}, timeoutMs);
		connection.pending.set(id, { stdout: [], stderr: [], resolve, timer, operationToken });
		try { connection.ws.send(JSON.stringify({ t: "exec", version: PROTOCOL_VERSION, id, operationToken, sessionId: options.sessionId, command, cwd: options.cwd, timeoutMs })); }
		catch (error) { clearTimeout(timer); connection.pending.delete(id); resolve({ code: -1, stdout: "", stderr: `Could not reach Runner: ${(error as Error).message}` }); }
	});
	audit({ msg: `runner_${options.operation}_finish`, runner_id: runnerId, session_id: options.sessionId, user: options.user, repo: options.repo, operation_id: id, exit_code: result.code, timed_out: !!result.timedOut });
	return { ...result, stdout: truncate(result.stdout), stderr: truncate(result.stderr) };
}

function truncate(value: string): string {
	if (value.length <= MAX_OUTPUT) return value;
	const half = Math.floor(MAX_OUTPUT / 2);
	return `${value.slice(0, half)}\n\n[… ${value.length - MAX_OUTPUT} characters trimmed …]\n\n${value.slice(-half)}`;
}
