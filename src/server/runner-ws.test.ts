import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
	disconnectRunner,
	launchRunnerHost,
	prepareRunnerWorkspace,
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
});
