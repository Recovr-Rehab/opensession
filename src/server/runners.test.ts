import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
	authenticateRunner,
	createRunnerPairing,
	isTailnetAddress,
	listRunners,
	normalizeAddress,
	registerRunner,
	releaseRunnerReservation,
	removeRunner,
	reserveRunner,
	runnerAllowed,
	updateRunner,
} from "./runners";

const HOME = mkdtempSync(join(tmpdir(), "os-runners-test-"));
const realHome = process.env.HOME;
process.env.HOME = HOME;

afterAll(() => { process.env.HOME = realHome; rmSync(HOME, { recursive: true, force: true }); });
beforeEach(() => { for (const runner of listRunners()) removeRunner(runner.id); });

function register(overrides: Partial<Parameters<typeof registerRunner>[0]> = {}) {
	const { code } = createRunnerPairing("tester");
	return registerRunner({ code, name: "mac-mini", platform: "darwin", arch: "arm64", capabilities: { toolchains: ["xcode", "swift"], tags: ["ios"] }, resources: { memoryGb: 64, gpu: { kind: "apple", model: "M4 Max", metal: true } }, address: "100.101.102.103", ...overrides });
}

describe("Runner registry security", () => {
	test("accepts only tailnet and loopback addresses", () => {
		for (const address of ["100.64.0.1", "100.127.255.254", "127.0.0.1", "::1"]) expect(isTailnetAddress(address)).toBe(true);
		for (const address of ["100.63.255.255", "100.128.0.1", "10.0.0.1", "192.168.1.1", ""]) expect(isTailnetAddress(address)).toBe(false);
		expect(normalizeAddress("::ffff:100.64.0.1")).toBe("100.64.0.1");
	});

	test("pairing is one-time and stored credentials are hashed", () => {
		const first = register();
		if (!first.ok) throw new Error(first.error);
		expect(first.token).toMatch(/^[0-9a-f]{64}$/);
		expect(JSON.stringify(listRunners()[0])).not.toContain(first.token);
		expect(authenticateRunner(first.runner.id, first.token)?.id).toBe(first.runner.id);
		expect(authenticateRunner(first.runner.id, "wrong")).toBeUndefined();
		const reused = registerRunner({ code: "ZZZZ-ZZZZ", name: "other", platform: "linux", arch: "x64", address: "100.101.102.103" });
		expect(reused.ok).toBe(false);
	});

	test("re-pairing retains policy but rotates the credential", () => {
		const first = register();
		if (!first.ok) throw new Error(first.error);
		updateRunner(first.runner.id, { permissions: { fullSessions: true, portals: true }, allowedRepos: ["opensession"] });
		const second = register();
		if (!second.ok) throw new Error(second.error);
		expect(second.runner.id).toBe(first.runner.id);
		expect(second.runner.permissions.fullSessions).toBe(true);
		expect(second.runner.allowedRepos).toEqual(["opensession"]);
		expect(authenticateRunner(first.runner.id, first.token)).toBeUndefined();
	});
});

describe("Runner policy and reservations", () => {
	test("enforces explicit user, repository, and execution permission policy", () => {
		const result = register();
		if (!result.ok) throw new Error(result.error);
		const runner = updateRunner(result.runner.id, { allowedUsers: ["alex"], allowedRepos: ["ios-app"], permissions: { commands: true, fullSessions: true, terminals: false, portals: false } })!;
		expect(runnerAllowed(runner, { user: "alex", repo: "ios-app", permission: "commands" })).toBe(true);
		expect(runnerAllowed(runner, { user: "sam", repo: "ios-app", permission: "commands" })).toBe(false);
		expect(runnerAllowed(runner, { user: "alex", repo: "web", permission: "commands" })).toBe(false);
		expect(runnerAllowed(runner, { user: "alex", repo: "ios-app", permission: "portals" })).toBe(false);
	});

	test("prevents competing reservations and lets the owner release one", () => {
		const result = register();
		if (!result.ok) throw new Error(result.error);
		expect(reserveRunner(result.runner.id, { reason: "iOS release", reservedBy: "alex", durationMinutes: 30 })?.reservation?.reservedBy).toBe("alex");
		expect(reserveRunner(result.runner.id, { reason: "other", reservedBy: "sam" })).toBeUndefined();
		expect(releaseRunnerReservation(result.runner.id, "sam")).toBeUndefined();
		expect(releaseRunnerReservation(result.runner.id, "alex")?.reservation).toBeUndefined();
	});
});
