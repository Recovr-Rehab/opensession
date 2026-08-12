import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
	disconnectRunner,
	launchRunnerHost,
	prepareRunnerWorkspace,
	requestRunnerPortal,
	registerRunnerPortalFrameHandler,
	runnerHostStatus,
	runnerWsMessage,
	runnerWsOpen,
} from "./runner-ws";
import { createRunnerPairing, registerRunner, removeRunner, updateRunner, listRunners } from "./runners";

type FakeSocket = { data: Record<string, unknown>; sent: string[]; closed?: number; send(value: string): void; close(code?: number): void };

function socket(runnerId: string): FakeSocket {
	return {
		data: { kind: "runner", runnerId }, sent: [],
		send(value) { this.sent.push(value); },
		close(code) { this.closed = code; },
	};
}

let runnerId = "";

beforeEach(() => {
	for (const runner of listRunners()) removeRunner(runner.id);
	const pairing = createRunnerPairing("admin");
	const added = registerRunner({ code: pairing.code, name: "runner-ws-test", platform: "linux", arch: "x64", address: "127.0.0.1" });
	if (!added.ok) throw new Error(added.error);
	runnerId = added.runner.id;
	updateRunner(runnerId, { permissions: { fullSessions: true }, allowedRepos: ["opensession"], workspaceRoots: ["/srv/opensession"] });
});

afterEach(() => { disconnectRunner(runnerId, "test complete"); });

describe("Runner full-session control", () => {
	test("only accepts the exact server-selected session workspace", async () => {
		const ws = socket(runnerId);
		runnerWsOpen(ws);
		runnerWsMessage(ws, JSON.stringify({ t: "hello", version: 1 }));
		const pending = prepareRunnerWorkspace(runnerId, {
			sessionId: "bks-test", repo: "opensession", branch: "main",
			workspacePath: "/srv/opensession/sessions/bks-test", repositoryUrl: "https://github.com/tellahq/opensession.git",
		});
		const message = JSON.parse(ws.sent.at(-1)!);
		expect(message.t).toBe("workspace_prepare");
		expect(message.workspacePath).toBe("/srv/opensession/sessions/bks-test");
		runnerWsMessage(ws, JSON.stringify({ t: "workspace_ready", id: message.id, operationToken: message.operationToken, cwd: message.workspacePath }));
		await expect(pending).resolves.toEqual({ cwd: message.workspacePath });
		await expect(prepareRunnerWorkspace(runnerId, {
			sessionId: "bks-test", repo: "opensession", branch: "main",
			workspacePath: "/home/runner", repositoryUrl: "https://github.com/tellahq/opensession.git",
		})).rejects.toThrow("outside its managed roots");
	});

	test("launches a run host with a one-use operation token", async () => {
		const ws = socket(runnerId);
		runnerWsOpen(ws);
		runnerWsMessage(ws, JSON.stringify({ t: "hello", version: 1 }));
		const request = {
			sessionId: "bks-test", repo: "opensession", server: "https://session.example.test",
			spec: { hostId: "rh-test", osSessionId: "bks-test", prompt: "hi", cwd: "/srv/opensession/sessions/bks-test", wsToken: "short-lived" },
		};
		const pending = launchRunnerHost(runnerId, request);
		const message = JSON.parse(ws.sent.at(-1)!);
		expect(message.t).toBe("run_host");
		expect(message.spec.cwd).toBe(request.spec.cwd);
		runnerWsMessage(ws, JSON.stringify({ t: "host_started", id: message.id, operationToken: message.operationToken, hostId: "rh-test" }));
		await expect(pending).resolves.toBeUndefined();
	});

	test("checks a detached host through the authenticated Runner channel", async () => {
		const ws = socket(runnerId);
		runnerWsOpen(ws);
		runnerWsMessage(ws, JSON.stringify({ t: "hello", version: 1 }));
		const pending = runnerHostStatus(runnerId, {
			sessionId: "bks-test", repo: "opensession", workspacePath: "/srv/opensession/sessions/bks-test", hostId: "rh-test",
		});
		const message = JSON.parse(ws.sent.at(-1)!);
		expect(message.t).toBe("host_status");
		runnerWsMessage(ws, JSON.stringify({ t: "host_status", id: message.id, operationToken: message.operationToken, hostId: "rh-test", alive: true }));
		await expect(pending).resolves.toBe(true);
	});

	test("keeps Runner Portal control scoped to the session workspace", async () => {
		updateRunner(runnerId, { permissions: { portals: true } });
		const ws = socket(runnerId);
		runnerWsOpen(ws);
		runnerWsMessage(ws, JSON.stringify({ t: "hello", version: 1 }));
		const pending = requestRunnerPortal(runnerId, {
			sessionId: "bks-test", repo: "opensession", workspacePath: "/srv/opensession/sessions/bks-test", operation: "start",
			payload: { name: "web", command: "bun run dev" },
		});
		const message = JSON.parse(ws.sent.at(-1)!);
		expect(message.t).toBe("portal_start");
		runnerWsMessage(ws, JSON.stringify({ t: "portal_result", id: message.id, operationToken: message.operationToken, ok: true, result: { name: "web" } }));
		await expect(pending).resolves.toEqual({ name: "web" });
		await expect(requestRunnerPortal(runnerId, {
			sessionId: "bks-test", repo: "opensession", workspacePath: "/home/runner", operation: "list",
		})).rejects.toThrow("outside its managed roots");
	});

	test("forwards Portal WebSocket frames only from the attached Runner", () => {
		const ws = socket(runnerId);
		runnerWsOpen(ws);
		runnerWsMessage(ws, JSON.stringify({ t: "hello", version: 1 }));
		let received: Record<string, unknown> | undefined;
		const dispose = registerRunnerPortalFrameHandler((id, message) => { if (id === runnerId) received = message; });
		runnerWsMessage(ws, JSON.stringify({ t: "portal_ws_event", connectionId: "abcdefgh", binary: false, data: "updated" }));
		dispose();
		expect(received?.data).toBe("updated");
	});
});
