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

export function readPortalRegistry(worktreeDir: string): PortalRecord[] {
	const path = registryPath(worktreeDir);
	if (!existsSync(path)) return [];
	const records: PortalRecord[] = [];
	for (const line of readFileSync(path, "utf8").split("\n")) {
		if (!line.startsWith(PREFIX)) continue;
		try {
			const value = JSON.parse(line.slice(PREFIX.length)) as PortalRecord;
			if (!value || typeof value !== "object" || !NAME.test(value.name) || !Number.isInteger(value.port) || typeof value.command !== "string") continue;
			records.push({ ...value, key: portalKey(value.name), port: validatePort(value.port) });
		} catch {}
	}
	return records;
}

function writePortalRegistry(worktreeDir: string, records: PortalRecord[]): void {
	const path = registryPath(worktreeDir);
	const previous = existsSync(path) ? readFileSync(path, "utf8").split("\n") : [];
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
	writeFileSync(path, [...kept, ...generated, ""].join("\n"));
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

async function allocatePort(worktreeDir: string): Promise<number> {
	const reserved = new Set(readPortalRegistry(worktreeDir).map((record) => record.port));
	for (let port = 4_000; port < 9_000; port++) {
		if (!reserved.has(port) && !(await portListening(port))) return port;
	}
	throw new Error("No Portal ports are available.");
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
			env: { ...process.env, PORT: String(port), PORTAL_URL: url, OPENSESSION_PORTAL: name },
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
