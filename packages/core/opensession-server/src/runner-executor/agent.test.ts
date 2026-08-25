import { describe, expect, test } from "bun:test";
import {
  EXECUTOR_PROTOCOL_VERSION,
  decodeExecutorGrant,
  type ExecutorGrant,
} from "@tellahq/opensession-protocol/executor";
import type {
  Executor,
  ExecutorContext,
  ExecutorSuccess,
} from "../server/executors/contract";
import { RemoteExecutorConnection } from "../server/executors/remote";
import { RunnerExecutorAgent, type DuplexJsonTransport } from "./agent";
import {
  InMemoryCommandLedger,
  LedgerFullError,
  operationDigest,
} from "./ledger";

class FakeEnd implements DuplexJsonTransport {
  peer?: FakeEnd;
  constructor(readonly macrotask = false) {}
  messages: unknown[] = [];
  #message = new Set<(message: unknown) => void | Promise<void>>();
  #close = new Set<(reason?: unknown) => void>();
  send(message: unknown): void {
    this.messages.push(structuredClone(message));
    const deliver = () => {
      if (!this.peer) return;
      for (const handler of this.peer.#message)
        void Promise.resolve(handler(structuredClone(message))).catch(() => {});
    };
    if (this.macrotask) setTimeout(deliver, 0);
    else queueMicrotask(deliver);
  }
  onMessage(handler: (message: unknown) => void | Promise<void>): () => void {
    this.#message.add(handler);
    return () => this.#message.delete(handler);
  }
  onClose(handler: (reason?: unknown) => void): () => void {
    this.#close.add(handler);
    return () => this.#close.delete(handler);
  }
  close(reason?: unknown): void {
    for (const handler of this.#close) handler(reason);
    if (this.peer) for (const handler of this.peer.#close) handler(reason);
  }
}
function pair(macrotask = false): [FakeEnd, FakeEnd] {
  const a = new FakeEnd(macrotask);
  const b = new FakeEnd(macrotask);
  a.peer = b;
  b.peer = a;
  return [a, b];
}
const grant = decodeExecutorGrant("opaque") as ExecutorGrant;
const identity = {
  executorId: "executor-1",
  instanceId: "instance-1",
  generation: 2,
  capabilities: ["fs"] as const,
};
const context: ExecutorContext = {
  rootId: "root-1",
  sessionId: "session-1",
  runId: "run-1",
  generation: 2,
  requestId: "request-1",
};
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

class RecordingExecutor implements Executor {
  calls = 0;
  async execute(): Promise<ExecutorSuccess> {
    this.calls++;
    return {
      outcome: {
        kind: "fs.read",
        streamId: "stream-1",
        size: 5,
        binary: false,
      },
      events: [
        {
          kind: "text",
          streamId: "stream-1",
          sequence: 0,
          channel: "file",
          data: "hello",
          eof: true,
        },
      ],
    };
  }
}

describe("runner Executor agent", () => {
  test("handshakes, roundtrips reads, and enforces stream credit", async () => {
    const [control, daemon] = pair();
    const backend = new RecordingExecutor();
    const agent = new RunnerExecutorAgent({
      ...identity,
      capabilities: [...identity.capabilities],
      rootId: "root-1",
      transport: daemon,
      executor: backend,
      ledger: new InMemoryCommandLedger(),
      validateGrant: () => true,
      createId: () => "hello-1",
    });
    const remote = new RemoteExecutorConnection({
      ...identity,
      capabilities: [...identity.capabilities],
      transport: control,
      grant,
      initialStreamCreditBytes: 5,
    });
    await agent.start();
    await remote.ready();
    const result = await remote.execute(context, {
      kind: "fs.read",
      path: "file.txt",
    });
    expect(result.events?.[0]).toMatchObject({ data: "hello", eof: true });
    expect(backend.calls).toBe(1);
    const eventIndex = daemon.messages.findIndex(
      (message: any) => message.t === "event",
    );
    const creditIndex = control.messages.findIndex(
      (message: any) => message.t === "stream_credit",
    );
    expect(creditIndex).toBeGreaterThan(-1);
    expect(eventIndex).toBeGreaterThan(-1);
  });

  test("waits for credit-gated macrotask event delivery before eventsComplete", async () => {
    const [control, daemon] = pair(true);
    const agent = new RunnerExecutorAgent({
      ...identity,
      capabilities: [...identity.capabilities],
      rootId: "root-1",
      transport: daemon,
      executor: {
        execute: async () => ({
          outcome: {
            kind: "fs.read",
            streamId: "stream-1",
            size: 6,
            binary: false,
          },
          events: [
            {
              kind: "text",
              streamId: "stream-1",
              sequence: 0,
              channel: "file",
              data: "abc",
            },
            {
              kind: "text",
              streamId: "stream-1",
              sequence: 1,
              channel: "file",
              data: "def",
              eof: true,
            },
          ],
        }),
      },
      ledger: new InMemoryCommandLedger(),
      validateGrant: () => true,
    });
    const remote = new RemoteExecutorConnection({
      ...identity,
      capabilities: [...identity.capabilities],
      transport: control,
      grant,
      initialStreamCreditBytes: 3,
    });
    await agent.start();
    await remote.ready();
    await expect(
      remote.execute(context, { kind: "fs.read", path: "x" }),
    ).resolves.toMatchObject({
      events: [{ data: "abc" }, { data: "def" }],
    });
    const terminal = daemon.messages.findIndex(
      (message: any) =>
        message.t === "receipt_status" && message.eventsComplete,
    );
    const lastEvent = daemon.messages.findLastIndex(
      (message: any) => message.t === "event",
    );
    expect(lastEvent).toBeGreaterThan(-1);
    expect(terminal).toBeGreaterThan(lastEvent);
    const executeFrame = control.messages.find(
      (message: any) => message.t === "execute",
    ) as any;
    const credits = control.messages.filter(
      (message: any) => message.t === "stream_credit",
    ) as any[];
    expect(credits.length).toBeGreaterThan(1);
    expect(credits.at(-1).fence.deadlineMs).toBeGreaterThanOrEqual(
      executeFrame.fence.deadlineMs,
    );
  });

  test("fails closed when grant validation throws", async () => {
    const [control, daemon] = pair();
    const backend = new RecordingExecutor();
    const agent = new RunnerExecutorAgent({
      ...identity,
      capabilities: [...identity.capabilities],
      rootId: "root-1",
      transport: daemon,
      executor: backend,
      ledger: new InMemoryCommandLedger(),
      validateGrant: () => {
        throw new Error("validator unavailable");
      },
    });
    const remote = new RemoteExecutorConnection({
      ...identity,
      capabilities: [...identity.capabilities],
      transport: control,
      grant,
    });
    await agent.start();
    await remote.ready();
    await expect(
      remote.execute(context, { kind: "fs.read", path: "x" }),
    ).rejects.toMatchObject({ code: "invalid_grant" });
    expect(backend.calls).toBe(0);
  });

  test("deduplicates accepted mutations by stable idempotency key", async () => {
    const [control, daemon] = pair();
    const backend: Executor = {
      execute: async () => ({ outcome: { kind: "fs.changed", path: "x" } }),
    };
    let calls = 0;
    const counted: Executor = {
      execute: async (ctx, op) => {
        calls++;
        return backend.execute(ctx, op);
      },
    };
    const agent = new RunnerExecutorAgent({
      ...identity,
      capabilities: [...identity.capabilities],
      rootId: "root-1",
      transport: daemon,
      executor: counted,
      ledger: new InMemoryCommandLedger(),
      validateGrant: () => true,
    });
    const remote = new RemoteExecutorConnection({
      ...identity,
      capabilities: [...identity.capabilities],
      transport: control,
      grant,
    });
    await agent.start();
    await remote.ready();
    await remote.execute(context, {
      kind: "fs.write",
      path: "x",
      data: "a",
      encoding: "utf8",
      idempotencyKey: "stable-1",
    });
    await remote.execute(
      { ...context, requestId: "request-2" },
      {
        kind: "fs.write",
        path: "x",
        data: "a",
        encoding: "utf8",
        idempotencyKey: "stable-1",
      },
    );
    expect(calls).toBe(1);
  });

  test("preserves committed success when sending the terminal status fails", async () => {
    const [control, daemon] = pair();
    const ledger = new InMemoryCommandLedger();
    const originalSend = daemon.send.bind(daemon);
    daemon.send = (message: unknown) => {
      originalSend(message);
      if (
        (message as any)?.t === "receipt_status" &&
        (message as any)?.receipt?.state === "succeeded"
      )
        throw new Error("transport failed after commit");
    };
    const agent = new RunnerExecutorAgent({
      ...identity,
      capabilities: [...identity.capabilities],
      rootId: "root-1",
      transport: daemon,
      executor: {
        execute: async () => ({ outcome: { kind: "fs.changed", path: "x" } }),
      },
      ledger,
      validateGrant: () => true,
      createId: (() => {
        const ids = ["hello-send-failure", "receipt-send-failure"];
        return () => ids.shift()!;
      })(),
    });
    await agent.start();
    control.send({
      ...identity,
      capabilities: [...identity.capabilities],
      t: "hello",
      accepted: true,
      version: EXECUTOR_PROTOCOL_VERSION,
      requestId: "accept",
    });
    await tick();
    control.send({
      t: "execute",
      version: EXECUTOR_PROTOCOL_VERSION,
      requestId: "send-failure-request",
      grant,
      fence: {
        rootId: context.rootId,
        sessionId: context.sessionId,
        runId: context.runId,
        generation: context.generation,
        deadlineMs: Date.now() + 10_000,
      },
      operation: {
        kind: "fs.write",
        path: "x",
        data: "a",
        encoding: "utf8",
        idempotencyKey: "send-failure-key",
      },
    });
    await tick();
    await tick();
    expect(
      (
        await ledger.get(
          { executorId: identity.executorId, ...context },
          "receipt-send-failure",
        )
      )?.receipt.state,
    ).toBe("succeeded");
  });

  test("supports reconnect hello and receipt query without replay", async () => {
    const ledger = new InMemoryCommandLedger();
    const receipt = {
      receiptId: "receipt-1",
      requestId: "old-request",
      state: "succeeded" as const,
      acceptedAt: "2026-01-01T00:00:00.000Z",
      completedAt: "2026-01-01T00:00:01.000Z",
      idempotencyKey: "stable",
    };
    const operation = {
      kind: "fs.write" as const,
      path: "x",
      data: "a",
      encoding: "utf8" as const,
      idempotencyKey: "stable",
    };
    await ledger.claim(
      {
        executorId: identity.executorId,
        rootId: context.rootId,
        sessionId: context.sessionId,
        runId: context.runId,
        generation: context.generation,
        requestId: "old-request",
        idempotencyKey: "stable",
        operation,
        operationDigest: operationDigest(operation),
      },
      { ...receipt, state: "queued", completedAt: undefined },
    );
    await ledger.transition(
      {
        executorId: identity.executorId,
        rootId: context.rootId,
        sessionId: context.sessionId,
        runId: context.runId,
        generation: context.generation,
      },
      receipt.receiptId,
      "queued",
      { state: "running" },
    );
    await ledger.transition(
      {
        executorId: identity.executorId,
        rootId: context.rootId,
        sessionId: context.sessionId,
        runId: context.runId,
        generation: context.generation,
      },
      receipt.receiptId,
      "running",
      {
        state: "succeeded",
        completedAt: receipt.completedAt,
        outcome: { kind: "fs.changed", path: "x" },
      },
    );
    const [control, daemon] = pair();
    const agent = new RunnerExecutorAgent({
      ...identity,
      capabilities: [...identity.capabilities],
      rootId: "root-1",
      transport: daemon,
      executor: {
        execute: async () => {
          throw new Error("must not replay");
        },
      },
      ledger,
      validateGrant: () => true,
    });
    await agent.start();
    control.send({
      ...identity,
      capabilities: [...identity.capabilities],
      t: "hello",
      accepted: true,
      version: EXECUTOR_PROTOCOL_VERSION,
      requestId: "accept",
    });
    await tick();
    control.send({
      t: "receipt_status",
      version: EXECUTOR_PROTOCOL_VERSION,
      requestId: "query",
      grant,
      fence: {
        rootId: context.rootId,
        sessionId: context.sessionId,
        runId: context.runId,
        generation: context.generation,
        deadlineMs: Date.now() + 10_000,
      },
      receiptId: "receipt-1",
    });
    await tick();
    expect(
      daemon.messages.some(
        (message: any) =>
          message.t === "receipt_status" &&
          message.receipt.receiptId === "receipt-1",
      ),
    ).toBe(true);
  });

  test("keeps cancellation advisory when physical execution later succeeds", async () => {
    const [control, daemon] = pair();
    let finish!: () => void;
    const execution = new Promise<ExecutorSuccess>((resolve) => {
      finish = () => resolve({ outcome: { kind: "fs.changed", path: "x" } });
    });
    const agent = new RunnerExecutorAgent({
      ...identity,
      capabilities: [...identity.capabilities],
      rootId: "root-1",
      transport: daemon,
      executor: { execute: async () => execution },
      ledger: new InMemoryCommandLedger(),
      validateGrant: () => true,
    });
    await agent.start();
    control.send({
      ...identity,
      capabilities: [...identity.capabilities],
      t: "hello",
      accepted: true,
      version: EXECUTOR_PROTOCOL_VERSION,
      requestId: "accept",
    });
    await tick();
    const fence = {
      rootId: context.rootId,
      sessionId: context.sessionId,
      runId: context.runId,
      generation: context.generation,
      deadlineMs: Date.now() + 10_000,
    };
    control.send({
      t: "execute",
      version: EXECUTOR_PROTOCOL_VERSION,
      requestId: "physical-operation",
      grant,
      fence,
      operation: {
        kind: "fs.write",
        path: "x",
        data: "a",
        encoding: "utf8",
        idempotencyKey: "physical-key",
      },
    });
    await tick();
    control.send({
      t: "cancel",
      version: EXECUTOR_PROTOCOL_VERSION,
      requestId: "cancel-advisory",
      grant,
      fence,
      target: { requestId: "physical-operation" },
      idempotencyKey: "cancel-key",
    });
    await tick();
    finish();
    await tick();
    expect(
      daemon.messages.some(
        (message: any) =>
          message.t === "error" &&
          message.requestId === "cancel-advisory" &&
          message.message.includes("may continue"),
      ),
    ).toBe(true);
    expect(
      daemon.messages.some(
        (message: any) =>
          message.t === "receipt_status" &&
          message.requestId === "physical-operation" &&
          message.receipt.state === "succeeded",
      ),
    ).toBe(true);
  });

  test("records cancellation without replaying a mutation", async () => {
    const [control, daemon] = pair();
    const agent = new RunnerExecutorAgent({
      ...identity,
      capabilities: [...identity.capabilities],
      rootId: "root-1",
      transport: daemon,
      executor: new RecordingExecutor(),
      ledger: new InMemoryCommandLedger(),
      validateGrant: () => true,
    });
    await agent.start();
    control.send({
      ...identity,
      capabilities: [...identity.capabilities],
      t: "hello",
      accepted: true,
      version: EXECUTOR_PROTOCOL_VERSION,
      requestId: "accept",
    });
    await tick();
    control.send({
      t: "cancel",
      version: EXECUTOR_PROTOCOL_VERSION,
      requestId: "cancel-1",
      grant,
      fence: {
        rootId: context.rootId,
        sessionId: context.sessionId,
        runId: context.runId,
        generation: context.generation,
        deadlineMs: Date.now() + 10_000,
      },
      target: { requestId: "mutation-1" },
      idempotencyKey: "cancel-stable-1",
    });
    await tick();
    expect(
      daemon.messages.some(
        (message: any) =>
          message.t === "error" &&
          message.requestId === "cancel-1" &&
          message.code === "cancelled",
      ),
    ).toBe(true);
  });

  test("rejects stale, malformed, and forbidden frames", async () => {
    const [control, daemon] = pair();
    const agent = new RunnerExecutorAgent({
      ...identity,
      capabilities: [...identity.capabilities],
      rootId: "root-1",
      transport: daemon,
      executor: new RecordingExecutor(),
      ledger: new InMemoryCommandLedger(),
      validateGrant: () => true,
    });
    await agent.start();
    control.send({
      ...identity,
      capabilities: [...identity.capabilities],
      t: "hello",
      accepted: true,
      version: EXECUTOR_PROTOCOL_VERSION,
      requestId: "accept",
    });
    await tick();
    control.send({
      t: "execute",
      version: EXECUTOR_PROTOCOL_VERSION,
      requestId: "bad",
      grant,
      fence: {
        rootId: "root-1",
        sessionId: "session-1",
        runId: "run-1",
        generation: 1,
        deadlineMs: Date.now() + 10_000,
      },
      operation: { kind: "fs.read", path: "x", prompt: "forbidden" },
    });
    control.send({
      t: "execute",
      version: EXECUTOR_PROTOCOL_VERSION,
      requestId: "missing-key",
      grant,
      fence: {
        rootId: "root-1",
        sessionId: "session-1",
        runId: "run-1",
        generation: 1,
        deadlineMs: Date.now() + 10_000,
      },
      operation: {
        kind: "fs.write",
        path: "x",
        data: "x",
        encoding: "utf8",
      },
    });
    await tick();
    expect(
      daemon.messages.some(
        (message: any) => message.t === "error" && message.requestId === "bad",
      ),
    ).toBe(true);
    expect(
      daemon.messages.some(
        (message: any) =>
          message.t === "error" && message.requestId === "missing-key",
      ),
    ).toBe(true);
  });
});
