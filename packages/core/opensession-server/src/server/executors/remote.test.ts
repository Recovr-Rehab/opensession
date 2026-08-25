import { describe, expect, test } from "bun:test";
import {
  EXECUTOR_PROTOCOL_VERSION,
  decodeExecutorGrant,
  type ExecutorGrant,
} from "@tellahq/opensession-protocol/executor";
import type { DuplexJsonTransport } from "../../runner-executor/agent";
import { RemoteExecutorConnection } from "./remote";
import {
  RemoteExecutorRegistrationError,
  RemoteExecutorRegistry,
} from "./remote-registry";

class ManualTransport implements DuplexJsonTransport {
  sent: any[] = [];
  message?: (message: unknown) => void | Promise<void>;
  closed?: (reason?: unknown) => void;
  send(message: unknown): void {
    this.sent.push(message);
  }
  onMessage(handler: (message: unknown) => void | Promise<void>): () => void {
    this.message = handler;
    return () => {
      this.message = undefined;
    };
  }
  onClose(handler: (reason?: unknown) => void): () => void {
    this.closed = handler;
    return () => {
      this.closed = undefined;
    };
  }
  receive(message: unknown): void {
    void this.message?.(message);
  }
  drop(reason?: unknown): void {
    this.closed?.(reason);
  }
}
const identity = {
  executorId: "executor-1",
  instanceId: "instance-1",
  generation: 3,
  capabilities: ["fs"] as const,
};
const grant = decodeExecutorGrant("opaque") as ExecutorGrant;
const context = {
  rootId: "root-1",
  sessionId: "session-1",
  runId: "run-1",
  generation: 3,
  requestId: "request-1",
};
const hello = {
  ...identity,
  capabilities: [...identity.capabilities],
  t: "hello",
  version: EXECUTOR_PROTOCOL_VERSION,
  requestId: "hello-1",
};
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("remote Executor connection", () => {
  test("fences exact incarnation and bounds pending requests", async () => {
    const transport = new ManualTransport();
    const remote = new RemoteExecutorConnection({
      ...identity,
      capabilities: [...identity.capabilities],
      transport,
      grant,
      maxPending: 1,
    });
    transport.receive(hello);
    await remote.ready();
    expect(transport.sent[0]).toMatchObject({
      t: "hello",
      accepted: true,
      generation: 3,
    });
    const first = remote.execute(context, { kind: "fs.stat", path: "x" });
    await expect(
      remote.execute(
        { ...context, requestId: "request-2" },
        { kind: "fs.read", path: "y" },
      ),
    ).rejects.toMatchObject({ code: "executor_busy" });
    transport.receive({
      t: "receipt_status",
      version: EXECUTOR_PROTOCOL_VERSION,
      requestId: "request-1",
      receipt: {
        receiptId: "r",
        requestId: "request-1",
        state: "succeeded",
        acceptedAt: "2026-08-22T12:00:00.000Z",
        completedAt: "2026-08-22T12:00:01.000Z",
      },
      outcome: { kind: "fs.stat", entry: { path: "x", type: "file", size: 1 } },
    });
    await expect(first).resolves.toMatchObject({
      outcome: { kind: "fs.stat" },
    });
    await expect(
      remote.execute(
        { ...context, generation: 2 },
        { kind: "fs.read", path: "x" },
      ),
    ).rejects.toMatchObject({ code: "stale_generation" });
  });

  test("distinguishes disconnect before and after mutation acceptance", async () => {
    const beforeTransport = new ManualTransport();
    const before = new RemoteExecutorConnection({
      ...identity,
      capabilities: [...identity.capabilities],
      transport: beforeTransport,
      grant,
    });
    beforeTransport.receive(hello);
    await before.ready();
    const beforeResult = before.execute(context, {
      kind: "fs.write",
      path: "x",
      data: "a",
      encoding: "utf8",
      idempotencyKey: "k1",
    });
    beforeTransport.drop();
    await expect(beforeResult).rejects.toMatchObject({ ambiguous: false });

    const afterTransport = new ManualTransport();
    const after = new RemoteExecutorConnection({
      ...identity,
      capabilities: [...identity.capabilities],
      transport: afterTransport,
      grant,
    });
    afterTransport.receive(hello);
    await after.ready();
    const afterResult = after.execute(context, {
      kind: "fs.write",
      path: "x",
      data: "a",
      encoding: "utf8",
      idempotencyKey: "k2",
    });
    await tick();
    afterTransport.receive({
      t: "receipt",
      version: EXECUTOR_PROTOCOL_VERSION,
      requestId: "request-1",
      receipt: {
        receiptId: "r",
        requestId: "request-1",
        state: "queued",
        acceptedAt: "2026-08-22T12:00:00.000Z",
        idempotencyKey: "k2",
      },
    });
    afterTransport.drop();
    await expect(afterResult).rejects.toMatchObject({ ambiguous: true });
  });

  test("times out stalled accepted mutations as ambiguous and clears pending", async () => {
    const transport = new ManualTransport();
    const remote = new RemoteExecutorConnection({
      ...identity,
      capabilities: [...identity.capabilities],
      transport,
      grant,
      deadlineMs: () => Date.now() + 10,
    });
    transport.receive(hello);
    await remote.ready();
    const result = remote.execute(context, {
      kind: "fs.write",
      path: "x",
      data: "a",
      encoding: "utf8",
      idempotencyKey: "timeout-key",
    });
    await tick();
    transport.receive({
      t: "receipt",
      version: EXECUTOR_PROTOCOL_VERSION,
      requestId: context.requestId,
      receipt: {
        receiptId: "timeout-receipt",
        requestId: context.requestId,
        state: "queued",
        acceptedAt: "2026-08-22T12:00:00.000Z",
        idempotencyKey: "timeout-key",
      },
    });
    await expect(result).rejects.toMatchObject({
      code: "deadline_exceeded",
      ambiguous: true,
    });
    expect(remote.pendingCount).toBe(0);
  });

  test("rejects terminal failed receipt status instead of hanging", async () => {
    const transport = new ManualTransport();
    const remote = new RemoteExecutorConnection({
      ...identity,
      capabilities: [...identity.capabilities],
      transport,
      grant,
    });
    transport.receive(hello);
    await remote.ready();
    const result = remote.execute(context, { kind: "fs.read", path: "x" });
    await tick();
    transport.receive({
      t: "receipt_status",
      version: EXECUTOR_PROTOCOL_VERSION,
      requestId: context.requestId,
      receipt: {
        receiptId: "failed-receipt",
        requestId: context.requestId,
        state: "failed",
        acceptedAt: "2026-08-22T12:00:00.000Z",
        completedAt: "2026-08-22T12:00:01.000Z",
      },
      error: { code: "operation_failed", message: "recovered uncertainty" },
      eventsComplete: true,
    });
    await expect(result).rejects.toMatchObject({
      code: "operation_failed",
      ambiguous: false,
    });
    expect(remote.pendingCount).toBe(0);
  });

  test("disconnects on hostile malformed receipt payloads", async () => {
    const transport = new ManualTransport();
    const remote = new RemoteExecutorConnection({
      ...identity,
      capabilities: [...identity.capabilities],
      transport,
      grant,
    });
    transport.receive(hello);
    await remote.ready();
    const result = remote.execute(context, { kind: "fs.read", path: "x" });
    await tick();
    transport.receive({
      t: "receipt_status",
      version: EXECUTOR_PROTOCOL_VERSION,
      requestId: context.requestId,
      receipt: {
        receiptId: "bad-receipt",
        requestId: context.requestId,
        state: "succeeded",
        acceptedAt: "not-a-date",
      },
      outcome: { kind: "fs.read", streamId: {}, size: -1, binary: false },
    });
    await expect(result).rejects.toMatchObject({ code: "operation_failed" });
    expect(remote.connected).toBe(false);
  });

  test("times out physical readiness when hello never arrives", async () => {
    const transport = new ManualTransport();
    const remote = new RemoteExecutorConnection({
      ...identity,
      capabilities: [...identity.capabilities],
      transport,
      grant,
      helloTimeoutMs: 5,
    });
    await expect(remote.ready()).rejects.toThrow("hello timed out");
    expect(remote.connected).toBe(false);
  });

  test("treats a matching top-level error receipt as accepted mutation ambiguity", async () => {
    const transport = new ManualTransport();
    const remote = new RemoteExecutorConnection({
      ...identity,
      capabilities: [...identity.capabilities],
      transport,
      grant,
    });
    transport.receive(hello);
    await remote.ready();
    const result = remote.execute(context, {
      kind: "fs.write",
      path: "x",
      data: "a",
      encoding: "utf8",
      idempotencyKey: "error-key",
    });
    await tick();
    transport.receive({
      t: "error",
      version: EXECUTOR_PROTOCOL_VERSION,
      requestId: context.requestId,
      code: "deadline_exceeded",
      message: "expired after claim",
      receipt: {
        receiptId: "error-receipt",
        requestId: context.requestId,
        state: "failed",
        acceptedAt: "2026-08-22T12:00:00.000Z",
        completedAt: "2026-08-22T12:00:01.000Z",
        idempotencyKey: "error-key",
      },
    });
    await expect(result).rejects.toMatchObject({
      code: "deadline_exceeded",
      ambiguous: true,
    });
  });

  test("disconnects when an error receipt changes accepted identity", async () => {
    const transport = new ManualTransport();
    const remote = new RemoteExecutorConnection({
      ...identity,
      capabilities: [...identity.capabilities],
      transport,
      grant,
    });
    transport.receive(hello);
    await remote.ready();
    const result = remote.execute(context, {
      kind: "fs.write",
      path: "x",
      data: "a",
      encoding: "utf8",
      idempotencyKey: "identity-key",
    });
    await tick();
    transport.receive({
      t: "receipt",
      version: EXECUTOR_PROTOCOL_VERSION,
      requestId: context.requestId,
      receipt: {
        receiptId: "original-receipt",
        requestId: context.requestId,
        state: "queued",
        acceptedAt: "2026-08-22T12:00:00.000Z",
        idempotencyKey: "identity-key",
      },
    });
    transport.receive({
      t: "error",
      version: EXECUTOR_PROTOCOL_VERSION,
      requestId: context.requestId,
      code: "operation_failed",
      message: "mismatched",
      receipt: {
        receiptId: "different-receipt",
        requestId: context.requestId,
        state: "failed",
        acceptedAt: "2026-08-22T12:00:00.000Z",
        completedAt: "2026-08-22T12:00:01.000Z",
        idempotencyKey: "identity-key",
      },
    });
    await expect(result).rejects.toMatchObject({
      code: "operation_failed",
      ambiguous: true,
    });
    expect(remote.connected).toBe(false);
  });

  test("disconnects on a wrong-target same-family outcome", async () => {
    const transport = new ManualTransport();
    const remote = new RemoteExecutorConnection({
      ...identity,
      capabilities: [...identity.capabilities],
      transport,
      grant,
    });
    transport.receive(hello);
    await remote.ready();
    const result = remote.execute(context, {
      kind: "fs.move",
      from: "from",
      to: "to",
      idempotencyKey: "move-key",
    });
    await tick();
    transport.receive({
      t: "receipt_status",
      version: EXECUTOR_PROTOCOL_VERSION,
      requestId: context.requestId,
      receipt: {
        receiptId: "incompatible-receipt",
        requestId: context.requestId,
        state: "succeeded",
        acceptedAt: "2026-08-22T12:00:00.000Z",
        completedAt: "2026-08-22T12:00:01.000Z",
        idempotencyKey: "move-key",
      },
      outcome: { kind: "fs.changed", path: "from" },
    });
    await expect(result).rejects.toMatchObject({ code: "operation_failed" });
    expect(remote.connected).toBe(false);
  });

  test("sends scoped stream cleanup with fresh grants on repeated timeouts", async () => {
    const transport = new ManualTransport();
    let cleanupGrants = 0;
    const remote = new RemoteExecutorConnection({
      ...identity,
      capabilities: [...identity.capabilities],
      transport,
      grant,
      deadlineMs: () => Date.now() + 8,
      cleanupGrant: () => {
        cleanupGrants++;
        return decodeExecutorGrant(`cleanup-${cleanupGrants}`) as ExecutorGrant;
      },
    });
    transport.receive(hello);
    await remote.ready();
    for (let index = 0; index < 2; index++) {
      const requestId = `cleanup-request-${index}`;
      const result = remote.execute(
        { ...context, requestId },
        { kind: "fs.read", path: "x" },
      );
      await tick();
      transport.receive({
        t: "receipt_status",
        version: EXECUTOR_PROTOCOL_VERSION,
        requestId,
        receipt: {
          receiptId: `cleanup-receipt-${index}`,
          requestId,
          state: "succeeded",
          acceptedAt: "2026-08-22T12:00:00.000Z",
          completedAt: "2026-08-22T12:00:01.000Z",
        },
        outcome: {
          kind: "fs.read",
          streamId: "shared-stream",
          size: 10,
          binary: false,
        },
      });
      await expect(result).rejects.toMatchObject({ code: "deadline_exceeded" });
    }
    const cleanups = transport.sent.filter((message) => message.t === "cancel");
    expect(cleanups).toHaveLength(2);
    expect(cleanups.map((message) => message.grant as string)).toEqual([
      "cleanup-1",
      "cleanup-2",
    ]);
    expect(cleanups.map((message) => message.target.requestId)).toEqual([
      "cleanup-request-0",
      "cleanup-request-1",
    ]);
    expect(remote.pendingCount).toBe(0);
  });

  test("treats read disconnects as retryable uncertainty", async () => {
    const transport = new ManualTransport();
    const remote = new RemoteExecutorConnection({
      ...identity,
      capabilities: [...identity.capabilities],
      transport,
      grant,
    });
    transport.receive(hello);
    await remote.ready();
    const result = remote.execute(context, { kind: "fs.read", path: "x" });
    transport.receive({
      t: "receipt",
      version: EXECUTOR_PROTOCOL_VERSION,
      requestId: "request-1",
      receipt: {
        receiptId: "r",
        requestId: "request-1",
        state: "queued",
        acceptedAt: "2026-08-22T12:00:00.000Z",
      },
    });
    transport.drop();
    await expect(result).rejects.toMatchObject({ ambiguous: false });
  });
});

describe("remote Executor registry", () => {
  test("rejects duplicate and stale incarnations and unregisters explicitly", () => {
    const registry = new RemoteExecutorRegistry();
    registry.register({
      ...identity,
      capabilities: [...identity.capabilities],
      transport: new ManualTransport(),
      grant,
    });
    expect(() =>
      registry.register({
        ...identity,
        capabilities: [...identity.capabilities],
        instanceId: "instance-2",
        transport: new ManualTransport(),
        grant,
      }),
    ).toThrow(RemoteExecutorRegistrationError);
    registry.disconnect(identity.executorId);
    expect(() =>
      registry.register({
        ...identity,
        capabilities: [...identity.capabilities],
        generation: 2,
        instanceId: "old",
        transport: new ManualTransport(),
        grant,
      }),
    ).toThrowError(/stale/);
    const next = registry.register({
      ...identity,
      capabilities: [...identity.capabilities],
      generation: 4,
      instanceId: "next",
      transport: new ManualTransport(),
      grant,
    });
    expect(registry.unregister(identity.executorId, "next", 4)).toBe(true);
    expect(next.connected).toBe(false);
  });
});
