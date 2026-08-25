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
import { InMemoryCommandLedger, LedgerFullError } from "./ledger";

class FakeEnd implements DuplexJsonTransport {
  peer?: FakeEnd;
  messages: unknown[] = [];
  #message = new Set<(message: unknown) => void | Promise<void>>();
  #close = new Set<(reason?: unknown) => void>();
  send(message: unknown): void {
    this.messages.push(structuredClone(message));
    queueMicrotask(() => {
      if (!this.peer) return;
      for (const handler of this.peer.#message)
        void handler(structuredClone(message));
    });
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
function pair(): [FakeEnd, FakeEnd] {
  const a = new FakeEnd();
  const b = new FakeEnd();
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
    await ledger.put({
      requestId: "old-request",
      idempotencyKey: "stable",
      receipt,
      outcome: { kind: "fs.changed", path: "x" },
    });
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

  test("records cancellation without replaying a mutation", async () => {
    const [control, daemon] = pair();
    const agent = new RunnerExecutorAgent({
      ...identity,
      capabilities: [...identity.capabilities],
      rootId: "root-1",
      transport: daemon,
      executor: new RecordingExecutor(),
      ledger: new InMemoryCommandLedger(),
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
    await tick();
    expect(
      daemon.messages.some(
        (message: any) => message.t === "error" && message.requestId === "bad",
      ),
    ).toBe(true);
  });
});

describe("command ledger", () => {
  test("is bounded and keeps stable receipts", async () => {
    const ledger = new InMemoryCommandLedger(1);
    const receipt = {
      receiptId: "r1",
      requestId: "q1",
      state: "queued" as const,
      acceptedAt: "now",
    };
    await ledger.put({ requestId: "q1", receipt });
    expect((await ledger.find("q1"))?.receipt.receiptId).toBe("r1");
    await expect(
      ledger.put({
        requestId: "q2",
        receipt: { ...receipt, receiptId: "r2", requestId: "q2" },
      }),
    ).rejects.toBeInstanceOf(LedgerFullError);
  });
});
