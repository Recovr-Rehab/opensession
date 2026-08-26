import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EXECUTOR_PROTOCOL_VERSION } from "@tellahq/opensession-protocol/executor";
import {
  EXECUTOR_GENERATION_HEADER,
  EXECUTOR_ID_HEADER,
  EXECUTOR_SOURCE_HEADER,
  type ExecutorUpgradeData,
} from "./ingress";
import { createExecutorRuntime } from "./runtime";

const roots: string[] = [];
function setup(overrides: { paired?: boolean; trusted?: boolean } = {}) {
  const root = mkdtempSync(join(tmpdir(), "executor-runtime-"));
  roots.push(root);
  const calls: unknown[] = [];
  const runtime = createExecutorRuntime({
    paths: {
      runnerLedgerDb: join(root, "runner-ledger.sqlite"),
      managedStateDb: join(root, "managed-state.sqlite"),
      instanceClaimsDb: join(root, "claims.sqlite"),
    },
    providers: [],
    runner: {
      authenticatePairedToken: (input) => {
        calls.push(["paired", input]);
        return overrides.paired ?? true;
      },
      isTrustedPeer: (address) => {
        calls.push(["peer", address]);
        return overrides.trusted ?? true;
      },
      authorize: (input) => {
        calls.push(["authorize", input]);
        return { connectable: true, capabilities: ["fs"] };
      },
    },
    managed: {
      capabilities: () => ["fs"],
      checkpointWorkspace: async () => {
        throw new Error("not configured in this test");
      },
      revokeExecutionAuthority: async () => {},
    },
    ingress: {
      createId: () => crypto.randomUUID(),
      now: Date.now,
      rateLimit: () => true,
      timers: {
        setTimeout: (callback, milliseconds) =>
          setTimeout(callback, milliseconds),
        clearTimeout: (timer) =>
          clearTimeout(timer as ReturnType<typeof setTimeout>),
      },
    },
  });
  return { root, runtime, calls };
}

afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

function request(): Request {
  return new Request("http://localhost/executor/connect", {
    headers: {
      authorization: "Bearer paired-token",
      connection: "Upgrade",
      upgrade: "websocket",
      [EXECUTOR_SOURCE_HEADER]: "runner",
      [EXECUTOR_ID_HEADER]: "runner-1",
      [EXECUTOR_GENERATION_HEADER]: "7",
    },
  });
}

class Socket {
  bufferedAmount = 0;
  sent: string[] = [];
  closes: Array<[number | undefined, string | undefined]> = [];
  constructor(readonly data: ExecutorUpgradeData) {}
  send(value: string): void {
    this.sent.push(value);
  }
  close(code?: number, reason?: string): void {
    this.closes.push([code, reason]);
  }
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("ExecutorRuntime", () => {
  test("is inert until start and closes idempotently", async () => {
    const { root, runtime } = setup();
    expect(existsSync(join(root, "runner-ledger.sqlite"))).toBe(false);
    expect(() => runtime.ingress).toThrow("not started");
    const [firstStart, secondStart] = await Promise.all([
      runtime.start(),
      runtime.start(),
    ]);
    expect(firstStart).toBe(runtime);
    expect(secondStart).toBe(runtime);
    expect(existsSync(join(root, "runner-ledger.sqlite"))).toBe(true);
    expect(await runtime.start()).toBe(runtime);
    runtime.close();
    runtime.close();
    expect(() => runtime.ingress).toThrow("not started");
  });

  test("unwinds partial initialization and can retry cleanly", async () => {
    const { root, runtime } = setup();
    const blocked = join(root, "managed-state.sqlite");
    mkdirSync(blocked);
    await expect(runtime.start()).rejects.toThrow();
    rmSync(blocked, { recursive: true });
    await expect(runtime.start()).resolves.toBe(runtime);
    runtime.close();
  });

  test("requires both the paired token and the real socket peer", async () => {
    for (const [overrides, status] of [
      [{ paired: false }, 401],
      [{ trusted: false }, 403],
    ] as const) {
      const { runtime } = setup(overrides);
      await runtime.start();
      const response = await runtime.ingress.handleUpgrade(
        request(),
        { upgrade: () => false },
        "100.64.0.9",
      );
      expect(response?.status).toBe(status);
      runtime.close();
    }

    const { runtime } = setup();
    await runtime.start();
    expect(
      (
        await runtime.ingress.handleUpgrade(request(), {
          upgrade: () => false,
        })
      )?.status,
    ).toBe(403);
    runtime.close();
  });

  test("passes the exact generation to authorization and issues fresh operation grants", async () => {
    const { runtime, calls } = setup();
    await runtime.start();
    let data: ExecutorUpgradeData | undefined;
    expect(
      await runtime.ingress.handleUpgrade(
        request(),
        {
          upgrade: (_request, options) => {
            data = options.data;
            return true;
          },
        },
        "100.64.0.9",
      ),
    ).toBeUndefined();
    expect(calls).toContainEqual([
      "authorize",
      { runnerId: "runner-1", generation: 7 },
    ]);
    const socket = new Socket(data!);
    runtime.ingress.websocket.open(socket);
    runtime.ingress.websocket.message(
      socket,
      JSON.stringify({
        t: "hello",
        version: EXECUTOR_PROTOCOL_VERSION,
        requestId: "hello-1",
        executorId: "runner-1",
        instanceId: "instance-1",
        generation: 7,
        capabilities: ["fs"],
      }),
    );
    await tick();
    await tick();
    const remote = runtime.registry.get("runner-1")!;
    const context = {
      rootId: "root-1",
      sessionId: "session-1",
      runId: "run-1",
      generation: 7,
    };
    const first = remote.execute(
      { ...context, requestId: "request-1" },
      { kind: "fs.stat", path: "one" },
    );
    const second = remote.execute(
      { ...context, requestId: "request-2" },
      { kind: "fs.stat", path: "two" },
    );
    await tick();
    const executes = socket.sent
      .map((value) => JSON.parse(value))
      .filter((value) => value.t === "execute");
    expect(executes).toHaveLength(2);
    expect(executes[0].grant).not.toBe(executes[1].grant);
    expect(
      runtime.validateExecutionGrant(executes[0].grant, executes[0].fence),
    ).toBe(true);
    for (const [index, requestId] of ["request-1", "request-2"].entries()) {
      runtime.ingress.websocket.message(
        socket,
        JSON.stringify({
          t: "receipt_status",
          version: EXECUTOR_PROTOCOL_VERSION,
          requestId,
          receipt: {
            receiptId: `receipt-${index + 1}`,
            requestId,
            state: "succeeded",
            acceptedAt: "2026-08-22T12:00:00.000Z",
            completedAt: "2026-08-22T12:00:01.000Z",
          },
          outcome: {
            kind: "fs.stat",
            entry: { path: index === 0 ? "one" : "two", type: "file", size: 1 },
          },
        }),
      );
    }
    await expect(first).resolves.toMatchObject({
      outcome: { kind: "fs.stat" },
    });
    await expect(second).resolves.toMatchObject({
      outcome: { kind: "fs.stat" },
    });
    runtime.close();
    expect(
      runtime.validateExecutionGrant(executes[0].grant, executes[0].fence),
    ).toBe(false);
  });
});
