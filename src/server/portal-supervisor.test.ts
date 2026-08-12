import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { listPortalServices, readPortalRegistry, setPortalPath, startPortalService, stopPortalService } from "./portal-supervisor";

let worktree = "";

beforeEach(() => { worktree = mkdtempSync(join(tmpdir(), "os-portals-test-")); });
afterAll(() => { if (worktree) rmSync(worktree, { recursive: true, force: true }); });

describe("session Portal supervisor", () => {
	test("keeps generated portal metadata and ports together in .ports.conf", () => {
		writeFileSync(join(worktree, ".ports.conf"), "WEBAPP_PORT=3300\n");
		const record = { name: "api", key: "PORTAL_API_PORT", command: "bun run api", port: 4200, state: "stopped" as const };
		writeFileSync(join(worktree, ".ports.conf"), `${PREFIX(record)}\nPORTAL_API_PORT=4200\nWEBAPP_PORT=3300\n`);
		setPortalPath(worktree, "/health", "api");
		const [portal] = readPortalRegistry(worktree);
		expect(portal).toMatchObject({ name: "api", key: "PORTAL_API_PORT", port: 4200, defaultPath: "/health" });
		expect(Bun.file(join(worktree, ".ports.conf")).text()).resolves.toContain("WEBAPP_PORT=3300");
	});

	test("starts, verifies, and stops only its own process group", async () => {
		const port = 18_701;
		const portal = await startPortalService({
			sessionId: "os-portal-test", worktreeDir: worktree, name: "test-app", port,
			command: "bun -e 'Bun.serve({port:Number(process.env.PORT),fetch(){return new Response(\"ok\")}})'",
		});
		expect(portal.state).toBe("awake");
		expect(portal.url).toContain(`:${port + 6000}`);
		expect((await listPortalServices(worktree))[0]?.state).toBe("awake");
		await stopPortalService({ sessionId: "os-portal-test", worktreeDir: worktree, name: "test-app" });
		expect((await listPortalServices(worktree))[0]?.state).toBe("stopped");
	});
});

function PREFIX(record: unknown): string { return `# opensession-portal ${JSON.stringify(record)}`; }
