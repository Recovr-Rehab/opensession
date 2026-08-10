import { createHash, randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "../..");

export function boundedCdpSystemdArgs(): string[] {
	return [
		"--property=MemoryHigh=2G", "--property=MemoryMax=4G",
		"--property=MemorySwapMax=512M", "--property=TasksMax=256",
		"--property=CPUQuota=300%", "--property=RuntimeMaxSec=2h",
		"--property=OOMPolicy=stop", "--property=KillMode=control-group",
	];
}

export type CdpBrowserLease = {
	port: number;
	unit?: string;
	owned: boolean;
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function ownerName(): string {
	const raw = process.env.OPENSESSION_SESSION_ID || process.env.OPENSESSION_RUN_KEY || process.cwd();
	return createHash("sha256").update(raw).digest("hex").slice(0, 10);
}

/**
 * Use an explicitly supplied browser unchanged. Otherwise start a private,
 * resource-bounded headful browser and return a lease that must be released.
 */
export async function acquireCdpBrowser(): Promise<CdpBrowserLease> {
	if (process.env.CDP_PORT) {
		const port = Number(process.env.CDP_PORT);
		if (!Number.isInteger(port) || port < 1 || port > 65535)
			throw new Error(`invalid CDP_PORT: ${process.env.CDP_PORT}`);
		return { port, owned: false };
	}

	const nonce = `${process.pid}-${randomBytes(3).toString("hex")}`;
	const state = `/tmp/opensession-cdp-${nonce}.json`;
	const proc = Bun.spawn([
		"bun",
		join(ROOT, "scripts/cdp-browser.ts"),
		"start",
		"--owner",
		ownerName(),
		"--state",
		state,
	], { stdout: "pipe", stderr: "pipe" });
	const [code, stdout, stderr] = await Promise.all([
		proc.exited,
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
	]);
	if (code !== 0) throw new Error(`CDP browser failed to start: ${stderr.trim() || stdout.trim()}`);
	const result = JSON.parse(stdout.trim()) as { port: number; unit: string };
	return { ...result, owned: true };
}

export async function releaseCdpBrowser(lease: CdpBrowserLease): Promise<void> {
	if (!lease.owned || !lease.unit) return;
	const proc = Bun.spawn(["systemctl", "--user", "stop", lease.unit], {
		stdin: "ignore", stdout: "ignore", stderr: "ignore",
	});
	await proc.exited;
}

export async function closeCdpTarget(port: number, targetId?: string): Promise<void> {
	if (!targetId) return;
	await fetch(`http://127.0.0.1:${port}/json/close/${encodeURIComponent(targetId)}`).catch(() => {});
}

export async function waitForFile(path: string, timeoutMs: number): Promise<string> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (existsSync(path)) return readFileSync(path, "utf8");
		await sleep(100);
	}
	throw new Error(`timed out waiting for ${path}`);
}
