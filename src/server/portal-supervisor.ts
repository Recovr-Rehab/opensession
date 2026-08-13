/**
 * Session-local Portal service supervisor.
 *
 * `.ports.conf` remains the interoperable registry read by lifecycle scripts.
 * Open Session owns the `# opensession-portal` records inside that file so an
 * agent can inspect services without becoming their process manager.
 */

import { existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { audit } from "./audit";
import { configuredServer } from "./config";
import { ensureSandboxPortalRelay, mintSandboxPortalGrant, revokeSandboxPortalRelay } from "./sandbox-portal-relay";
import { remoteSandboxCallbackBaseUrl } from "./sandbox/config";
import { shellQuoteWord } from "./sandbox/adapters/bootstrap";
import { sandboxHttpsPortFor } from "./sandbox/preview-ports";
import type { Sandbox } from "./sandbox/provider";

export type PortalState = "starting" | "awake" | "sleeping" | "waking" | "failed" | "stopped";
export type PortalRecord = {
	name: string;
	key: string;
	command: string;
	port: number;
	description?: string;
	defaultPath?: string;
	state: PortalState;
	pid?: number;
	startedAt?: string;
	lastError?: string;
};

const PREFIX = "# opensession-portal ";
const NAME = /^[a-z][a-z0-9-]{0,62}$/;
const MIN_PORT = 1024;
const MAX_PORT = 19_000;

function portalKey(name: string): string {
	return `PORTAL_${name.toUpperCase().replace(/-/g, "_")}_PORT`;
}

function validateName(name: string): string {
	const value = name.trim().toLowerCase();
	if (!NAME.test(value)) throw new Error("Portal names use lowercase letters, numbers, and hyphens.");
	return value;
}

function validatePort(port: number): number {
	if (!Number.isInteger(port) || port < MIN_PORT || port > MAX_PORT) throw new Error(`Portal port must be between ${MIN_PORT} and ${MAX_PORT}.`);
	return port;
}

function registryPath(worktreeDir: string): string { return join(worktreeDir, ".ports.conf"); }

function parsePortalRegistry(contents: string): PortalRecord[] {
	const records: PortalRecord[] = [];
	for (const line of contents.split("\n")) {
		if (!line.startsWith(PREFIX)) continue;
		try {
			const value = JSON.parse(line.slice(PREFIX.length)) as PortalRecord;
			if (!value || typeof value !== "object" || !NAME.test(value.name) || !Number.isInteger(value.port) || typeof value.command !== "string") continue;
			records.push({ ...value, key: portalKey(value.name), port: validatePort(value.port) });
		} catch {}
	}
	return records;
}

export function readPortalRegistry(worktreeDir: string): PortalRecord[] {
	const path = registryPath(worktreeDir);
	return existsSync(path) ? parsePortalRegistry(readFileSync(path, "utf8")) : [];
}

function serializedPortalRegistry(previousText: string, records: PortalRecord[]): string {
	const previous = previousText.split("\n");
	const generatedKeys = new Set(records.map((record) => record.key));
	const kept = previous.filter((line) => {
		if (line.startsWith(PREFIX)) return false;
		const key = line.match(/^\s*([A-Z0-9_]+_PORT)\s*=/)?.[1];
		return !key || !generatedKeys.has(key);
	});
	while (kept.at(-1) === "") kept.pop();
	const generated = records.flatMap((record) => [
		`${PREFIX}${JSON.stringify(record)}`,
		`${record.key}=${record.port}`,
	]);
	return [...kept, ...generated, ""].join("\n");
}

function writePortalRegistry(worktreeDir: string, records: PortalRecord[]): void {
	const path = registryPath(worktreeDir);
	const previous = existsSync(path) ? readFileSync(path, "utf8") : "";
	writeFileSync(path, serializedPortalRegistry(previous, records));
}

async function portListening(port: number): Promise<boolean> {
	const proc = Bun.spawn(["bash", "-lc", `exec 3<>/dev/tcp/127.0.0.1/${port}`], { stdout: "ignore", stderr: "ignore" });
	return (await proc.exited) === 0;
}

async function pidAlive(pid?: number): Promise<boolean> {
	if (!pid || pid < 2) return false;
	const proc = Bun.spawn(["kill", "-0", String(pid)], { stdout: "ignore", stderr: "ignore" });
	return (await proc.exited) === 0;
}

async function waitForPort(port: number, timeoutMs = 15_000): Promise<boolean> {
	const until = Date.now() + timeoutMs;
	while (Date.now() < until) {
		if (await portListening(port)) return true;
		await Bun.sleep(200);
	}
	return false;
}

async function sandboxPortListening(sandbox: Sandbox, port: number): Promise<boolean> {
	const result = await sandbox.exec(["timeout", "2", "bash", "-c", `exec 3<>/dev/tcp/127.0.0.1/${port}`]);
	return result.exitCode === 0;
}

async function sandboxPidAlive(sandbox: Sandbox, pid?: number): Promise<boolean> {
	if (!pid || pid < 2) return false;
	return (await sandbox.exec(["kill", "-0", String(pid)])).exitCode === 0;
}

async function waitForSandboxPort(sandbox: Sandbox, port: number, timeoutMs = 15_000): Promise<boolean> {
	const until = Date.now() + timeoutMs;
	while (Date.now() < until) {
		if (await sandboxPortListening(sandbox, port)) return true;
		await Bun.sleep(200);
	}
	return false;
}

async function allocatePort(worktreeDir: string): Promise<number> {
	const reserved = new Set(readPortalRegistry(worktreeDir).map((record) => record.port));
	for (let port = 4_000; port < 9_000; port++) {
		if (!reserved.has(port) && !(await portListening(port))) return port;
	}
	throw new Error("No Portal ports are available.");
}

async function allocateSandboxPort(sandbox: Sandbox, records: PortalRecord[]): Promise<number> {
	const reserved = new Set(records.map((record) => record.port));
	// Docker and local microVM Sandboxes have a fixed published range. Remote
	// providers provision a Portal URL on demand and return an empty map here.
	const published = Object.keys(await sandbox.ports()).map(Number)
		.filter((port) => Number.isInteger(port) && port >= MIN_PORT && port <= MAX_PORT)
		.sort((a, b) => a - b);
	if (published.length) {
		const port = published.find((candidate) => !reserved.has(candidate));
		if (port != null) return port;
		throw new Error("No published Sandbox Portal ports are available.");
	}
	for (let port = 4_000; port < 9_000; port++) if (!reserved.has(port)) return port;
	throw new Error("No Sandbox Portal ports are available.");
}

function normalizedPath(path?: string): string | undefined {
	if (!path?.trim()) return undefined;
	const value = path.trim();
	if (!value.startsWith("/") || value.startsWith("//") || value.includes("\n")) throw new Error("Portal path must be root-relative.");
	return value;
}

function upsert(records: PortalRecord[], next: PortalRecord): PortalRecord[] {
	const index = records.findIndex((record) => record.name === next.name);
	if (index < 0) return [...records, next];
	const copy = [...records]; copy[index] = next; return copy;
}

export async function listPortalServices(worktreeDir: string): Promise<PortalRecord[]> {
	const records = readPortalRegistry(worktreeDir);
	let changed = false;
	const checked = await Promise.all(records.map(async (record) => {
		if (record.state === "stopped" || record.state === "failed") return record;
		const listening = await portListening(record.port);
		const alive = await pidAlive(record.pid);
		const state: PortalState = listening ? "awake" : alive ? "starting" : "failed";
		if (state === record.state) return record;
		changed = true;
		return { ...record, state, ...(state === "failed" ? { lastError: "The service is no longer listening." } : {}) };
	}));
	if (changed) writePortalRegistry(worktreeDir, checked);
	return checked;
}

export async function startPortalService(input: {
	sessionId: string;
	worktreeDir: string;
	name: string;
	command: string;
	port?: number;
	description?: string;
}): Promise<PortalRecord & { url: string }> {
	const name = validateName(input.name);
	const command = input.command.trim();
	if (!command || command.length > 8_000) throw new Error("Portal command is required.");
	const records = await listPortalServices(input.worktreeDir);
	const current = records.find((record) => record.name === name);
	if (current && current.state !== "stopped" && current.state !== "failed") throw new Error(`Portal '${name}' already exists. Restart it instead.`);
	const port = input.port == null ? await allocatePort(input.worktreeDir) : validatePort(input.port);
	if (records.some((record) => record.name !== name && record.port === port) || await portListening(port)) throw new Error(`Port ${port} is already in use.`);
	const url = `https://${configuredServer().previewHost}:${port + 6_000}`;
	const base: PortalRecord = {
		name, key: portalKey(name), command, port,
		...(input.description?.trim() ? { description: input.description.trim().slice(0, 240) } : {}),
		state: "starting", startedAt: new Date().toISOString(),
	};
	writePortalRegistry(input.worktreeDir, upsert(records, base));
	let proc: ReturnType<typeof Bun.spawn>;
	try {
		proc = Bun.spawn(["setsid", "bash", "-lc", `exec ${command}`], {
		cwd: input.worktreeDir,
		// Portal commands are user-authored code. Do not hand them the Open
		// Session service environment, which can include operator credentials.
		env: {
			PATH: process.env.PATH || "/usr/local/bin:/usr/bin:/bin",
			HOME: process.env.HOME || "/tmp",
			PORT: String(port), PORTAL_URL: url, OPENSESSION_PORTAL: name,
		},
			stdin: "ignore", stdout: "ignore", stderr: "ignore",
		});
		proc.unref();
	} catch (error) {
		const failed = { ...base, state: "failed" as const, lastError: (error as Error).message };
		writePortalRegistry(input.worktreeDir, upsert(records, failed));
		throw error;
	}
	const record = { ...base, pid: proc.pid };
	writePortalRegistry(input.worktreeDir, upsert(records, record));
	if (!(await waitForPort(port))) {
		const failed = { ...record, state: "failed" as const, lastError: `Nothing listened on port ${port} within 15 seconds.` };
		writePortalRegistry(input.worktreeDir, upsert(records, failed));
		throw new Error(failed.lastError);
	}
	const awake = { ...record, state: "awake" as const };
	writePortalRegistry(input.worktreeDir, upsert(records, awake));
	audit({ msg: "portal_started", session_id: input.sessionId, portal: name, port });
	return { ...awake, url };
}

export async function stopPortalService(input: { sessionId: string; worktreeDir: string; name: string }): Promise<PortalRecord> {
	const name = validateName(input.name);
	const records = readPortalRegistry(input.worktreeDir);
	const current = records.find((record) => record.name === name);
	if (!current) throw new Error(`Portal '${name}' does not exist.`);
	if (current.pid && await pidAlive(current.pid)) {
		try { process.kill(-current.pid, "SIGTERM"); } catch { try { process.kill(current.pid, "SIGTERM"); } catch {} }
	}
	const stopped = { ...current, state: "stopped" as const, pid: undefined };
	writePortalRegistry(input.worktreeDir, upsert(records, stopped));
	audit({ msg: "portal_stopped", session_id: input.sessionId, portal: name, port: current.port });
	return stopped;
}

/** Stop every host-managed Portal before its session workspace is removed. */
export async function stopAllPortalServices(input: { sessionId: string; worktreeDir: string }): Promise<void> {
	const records = readPortalRegistry(input.worktreeDir);
	for (const record of records) {
		if (record.state === "stopped") continue;
		try { await stopPortalService({ ...input, name: record.name }); }
		catch (error) { console.warn(`[portals] could not stop ${record.name} for ${input.sessionId}:`, error); }
	}
}

export async function restartPortalService(input: { sessionId: string; worktreeDir: string; name: string }): Promise<PortalRecord & { url: string }> {
	const name = validateName(input.name);
	const current = readPortalRegistry(input.worktreeDir).find((record) => record.name === name);
	if (!current) throw new Error(`Portal '${name}' does not exist.`);
	await stopPortalService(input);
	return startPortalService({ sessionId: input.sessionId, worktreeDir: input.worktreeDir, name, command: current.command, port: current.port, description: current.description });
}

export function setPortalPath(worktreeDir: string, path: string, name?: string): PortalRecord[] {
	const value = normalizedPath(path);
	const records = readPortalRegistry(worktreeDir);
	const next = records.map((record) => !name || record.name === validateName(name) ? { ...record, defaultPath: value } : record);
	if (name && !records.some((record) => record.name === validateName(name))) throw new Error(`Portal '${name}' does not exist.`);
	writePortalRegistry(worktreeDir, next);
	return next;
}

/**
 * The sandbox counterpart intentionally uses only the Sandbox command seam.
 * The host never obtains a provider preview URL, shell, or arbitrary port:
 * commands run in the current Sandbox workspace and published ports are
 * qualified by `getSandboxPreviewStatus` before Caddy exposes them.
 */
async function readSandboxPortalRegistry(sandbox: Sandbox): Promise<{ text: string; records: PortalRecord[] }> {
	const response = await sandbox.exec(["bash", "-lc", "cat .ports.conf 2>/dev/null || true"]);
	return { text: response.stdout, records: parsePortalRegistry(response.stdout) };
}

async function writeSandboxPortalRegistry(sandbox: Sandbox, previousText: string, records: PortalRecord[]): Promise<void> {
	const data = Buffer.from(serializedPortalRegistry(previousText, records)).toString("base64");
	const response = await sandbox.exec(["bash", "-lc", `printf %s ${shellQuoteWord(data)} | base64 -d > .ports.conf`]);
	if (response.exitCode !== 0) throw new Error(response.stderr.trim() || "Could not update the Sandbox Portal registry.");
}

export async function listSandboxPortalServices(sandbox: Sandbox): Promise<PortalRecord[]> {
	const { text, records } = await readSandboxPortalRegistry(sandbox);
	let changed = false;
	const checked = await Promise.all(records.map(async (record) => {
		if (record.state === "stopped" || record.state === "failed") return record;
		const listening = await sandboxPortListening(sandbox, record.port);
		const alive = await sandboxPidAlive(sandbox, record.pid);
		const state: PortalState = listening ? "awake" : alive ? "starting" : "failed";
		if (state === record.state) return record;
		changed = true;
		return { ...record, state, ...(state === "failed" ? { lastError: "The service is no longer listening." } : {}) };
	}));
	if (changed) await writeSandboxPortalRegistry(sandbox, text, checked);
	return checked;
}

export async function startSandboxPortalService(input: {
	sessionId: string;
	sandbox: Sandbox;
	name: string;
	command: string;
	port?: number;
	description?: string;
}): Promise<PortalRecord> {
	const name = validateName(input.name);
	const command = input.command.trim();
	if (!command || command.length > 8_000) throw new Error("Portal command is required.");
	const snapshot = await readSandboxPortalRegistry(input.sandbox);
	const records = await listSandboxPortalServices(input.sandbox);
	const current = records.find((record) => record.name === name);
	if (current && current.state !== "stopped" && current.state !== "failed") throw new Error(`Portal '${name}' already exists. Restart it instead.`);
	const published = await input.sandbox.ports();
	const port = input.port == null ? await allocateSandboxPort(input.sandbox, records) : validatePort(input.port);
	if (records.some((record) => record.name !== name && record.port === port)) throw new Error(`Port ${port} is already registered.`);
	if (Object.keys(published).length && !(port in published)) throw new Error(`Port ${port} is not published for this Sandbox.`);
	const base: PortalRecord = {
		name, key: portalKey(name), command, port,
		...(input.description?.trim() ? { description: input.description.trim().slice(0, 240) } : {}),
		state: "starting", startedAt: new Date().toISOString(),
	};
	await writeSandboxPortalRegistry(input.sandbox, snapshot.text, upsert(records, base));
	const logPath = `.opensession-portal-${name}.log`;
	const url = `https://${configuredServer().previewHost}:${sandboxHttpsPortFor(input.sandbox.id, port)}`;
	const launch = `PORT=${shellQuoteWord(String(port))} PORTAL_URL=${shellQuoteWord(url)} OPENSESSION_PORTAL=${shellQuoteWord(name)} setsid bash -lc ${shellQuoteWord(`exec ${command}`)} >${shellQuoteWord(logPath)} 2>&1 & echo $!`;
	const launched = await input.sandbox.exec(["bash", "-lc", launch]);
	const pid = Number(launched.stdout.trim().split(/\s+/).at(-1));
	if (launched.exitCode !== 0 || !Number.isInteger(pid) || pid < 2) {
		const failed = { ...base, state: "failed" as const, lastError: launched.stderr.trim() || "Could not start the Portal process." };
		await writeSandboxPortalRegistry(input.sandbox, snapshot.text, upsert(records, failed));
		throw new Error(failed.lastError);
	}
	const launchedRecord = { ...base, pid };
	await writeSandboxPortalRegistry(input.sandbox, snapshot.text, upsert(records, launchedRecord));
	if (!(await waitForSandboxPort(input.sandbox, port))) {
		const failed = { ...launchedRecord, state: "failed" as const, lastError: `Nothing listened on port ${port} within 15 seconds.` };
		await writeSandboxPortalRegistry(input.sandbox, snapshot.text, upsert(records, failed));
		throw new Error(failed.lastError);
	}
	const awake = { ...launchedRecord, state: "awake" as const };
	await writeSandboxPortalRegistry(input.sandbox, snapshot.text, upsert(records, awake));
	// A remote Sandbox always dials Open Session. It never hands the browser a
	// provider preview URL or makes the server dial into its private network.
	const grant = mintSandboxPortalGrant({ sessionId: input.sessionId, sandboxId: input.sandbox.id, port });
	const callbackBase = remoteSandboxCallbackBaseUrl().replace(/\/$/, "").replace(/^http/, "ws");
	const endpoint = `${callbackBase}/sandbox-portal-ws?session=${encodeURIComponent(input.sessionId)}&sandbox=${encodeURIComponent(input.sandbox.id)}&port=${port}`;
	const agent = "/home/ubuntu/projects/opensession/src/runner-host/sandbox-portal-agent.ts";
	const relayLaunch = `OPENSESSION_SANDBOX_PORTAL_WS_URL=${shellQuoteWord(endpoint)} OPENSESSION_SANDBOX_PORTAL_TOKEN=${shellQuoteWord(grant.token)} OPENSESSION_SANDBOX_PORTAL_PORT=${shellQuoteWord(String(port))} setsid bun run ${shellQuoteWord(agent)} >/dev/null 2>&1 &`;
	const relayStarted = await input.sandbox.exec(["bash", "-lc", relayLaunch]);
	if (relayStarted.exitCode !== 0) {
		const failed = { ...awake, state: "failed" as const, lastError: relayStarted.stderr.trim() || "Could not start the Sandbox Portal relay." };
		await writeSandboxPortalRegistry(input.sandbox, snapshot.text, upsert(records, failed));
		throw new Error(failed.lastError);
	}
	await ensureSandboxPortalRelay({ sessionId: input.sessionId, sandboxId: input.sandbox.id, port });
	audit({ msg: "sandbox_portal_started", session_id: input.sessionId, sandbox_id: input.sandbox.id, portal: name, port });
	return awake;
}

export async function stopSandboxPortalService(input: { sessionId: string; sandbox: Sandbox; name: string }): Promise<PortalRecord> {
	const name = validateName(input.name);
	const snapshot = await readSandboxPortalRegistry(input.sandbox);
	const current = snapshot.records.find((record) => record.name === name);
	if (!current) throw new Error(`Portal '${name}' does not exist.`);
	if (current.pid && await sandboxPidAlive(input.sandbox, current.pid)) {
		await input.sandbox.exec(["bash", "-lc", `kill -TERM -- -${current.pid} 2>/dev/null || kill -TERM ${current.pid} 2>/dev/null || true`]);
	}
	const stopped = { ...current, state: "stopped" as const, pid: undefined };
	await writeSandboxPortalRegistry(input.sandbox, snapshot.text, upsert(snapshot.records, stopped));
	revokeSandboxPortalRelay(input.sandbox.id, current.port);
	audit({ msg: "sandbox_portal_stopped", session_id: input.sessionId, sandbox_id: input.sandbox.id, portal: name, port: current.port });
	return stopped;
}

export async function restartSandboxPortalService(input: { sessionId: string; sandbox: Sandbox; name: string }): Promise<PortalRecord> {
	const name = validateName(input.name);
	const current = (await readSandboxPortalRegistry(input.sandbox)).records.find((record) => record.name === name);
	if (!current) throw new Error(`Portal '${name}' does not exist.`);
	await stopSandboxPortalService(input);
	return startSandboxPortalService({ sessionId: input.sessionId, sandbox: input.sandbox, name, command: current.command, port: current.port, description: current.description });
}

export async function setSandboxPortalPath(sandbox: Sandbox, path: string, name?: string): Promise<PortalRecord[]> {
	const value = normalizedPath(path);
	const snapshot = await readSandboxPortalRegistry(sandbox);
	const next = snapshot.records.map((record) => !name || record.name === validateName(name) ? { ...record, defaultPath: value } : record);
	if (name && !snapshot.records.some((record) => record.name === validateName(name))) throw new Error(`Portal '${name}' does not exist.`);
	await writeSandboxPortalRegistry(sandbox, snapshot.text, next);
	return next;
}
