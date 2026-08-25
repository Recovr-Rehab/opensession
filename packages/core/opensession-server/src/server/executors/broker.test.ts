import { describe, expect, test } from "bun:test";
import type {
  ExecutorFence,
  ExecutorOperation,
} from "@tellahq/opensession-protocol/executor";
import { ExecutorBroker } from "./broker";
import { ExecutorFailure, type Executor } from "./contract";
import { ExecutorGrantAuthority } from "./grants";

const now = 1_000;
const baseFence: ExecutorFence = {
  rootId: "root-1",
  sessionId: "session-1",
  runId: "run-1",
  generation: 2,
  deadlineMs: 2_000,
};

function setup(executor: Executor) {
  const grants = new ExecutorGrantAuthority({ now: () => now });
  const grant = grants.issue({ ...baseFence, expiresAtMs: 3_000 });
  const broker = new ExecutorBroker(grants, { now: () => now });
  broker.registerImplementation("local", executor);
  broker.bindRoot("root-1", "local");
  return { broker, grant };
}

function request(
  grant: ReturnType<ExecutorGrantAuthority["issue"]>,
  operation: ExecutorOperation,
  overrides: Partial<ExecutorFence> = {},
) {
  return {
    requestId: crypto.randomUUID(),
    grant,
    fence: { ...baseFence, ...overrides },
    operation,
  };
}

describe("ExecutorBroker", () => {
  test("validates authority, binding, and deadline before dispatch", async () => {
    let calls = 0;
    const { broker, grant } = setup({
      execute: async () => {
        calls++;
        return { outcome: { kind: "fs.list", entries: [] } };
      },
    });
    for (const overrides of [
      { rootId: "root-2" },
      { sessionId: "session-2" },
      { runId: "run-2" },
      { generation: 3 },
      { deadlineMs: now },
    ]) {
      const result = await broker.dispatch(
        request(grant, { kind: "fs.list", path: "." }, overrides),
      );
      expect(result.ok).toBe(false);
    }
    expect(calls).toBe(0);
  });

  test("retries retryable reads but never mutations", async () => {
    let calls = 0;
    const { broker, grant } = setup({
      execute: async () => {
        calls++;
        if (calls === 1) throw new ExecutorFailure("executor_busy", "busy");
        return { outcome: { kind: "fs.list", entries: [] } };
      },
    });
    expect(
      (await broker.dispatch(request(grant, { kind: "fs.list", path: "." })))
        .ok,
    ).toBe(true);
    expect(calls).toBe(2);
  });

  test("replays a successful mutation receipt without executing twice", async () => {
    let calls = 0;
    const { broker, grant } = setup({
      execute: async () => {
        calls++;
        return { outcome: { kind: "fs.changed", path: "a" } };
      },
    });
    const operation = {
      kind: "fs.mkdir",
      path: "a",
      idempotencyKey: "same",
    } as const;
    const first = await broker.dispatch(request(grant, operation));
    const replay = await broker.dispatch(request(grant, operation));
    expect(first.ok).toBe(true);
    expect(replay).toEqual(first);
    expect(calls).toBe(1);
  });

  test("fails ambiguous mutations closed and replays the failed receipt", async () => {
    let calls = 0;
    const { broker, grant } = setup({
      execute: async () => {
        calls++;
        throw new Error("transport disappeared after dispatch");
      },
    });
    const operation = {
      kind: "fs.remove",
      path: "a",
      idempotencyKey: "ambiguous",
    } as const;
    const first = await broker.dispatch(request(grant, operation));
    const replay = await broker.dispatch(request(grant, operation));
    expect(first.ok).toBe(false);
    if (!first.ok) {
      expect(first.error.ambiguous).toBe(true);
      expect(first.receipt?.state).toBe("failed");
    }
    expect(replay).toEqual(first);
    expect(calls).toBe(1);
  });

  test("rejects reuse of an idempotency key for a different mutation", async () => {
    const { broker, grant } = setup({
      execute: async (_context, operation) => ({
        outcome: {
          kind: "fs.changed",
          path: "path" in operation ? operation.path : ".",
        },
      }),
    });
    await broker.dispatch(
      request(grant, { kind: "fs.mkdir", path: "a", idempotencyKey: "key" }),
    );
    const conflict = await broker.dispatch(
      request(grant, { kind: "fs.mkdir", path: "b", idempotencyKey: "key" }),
    );
    expect(conflict.ok).toBe(false);
    if (!conflict.ok) expect(conflict.error.code).toBe("conflict");
  });
});
