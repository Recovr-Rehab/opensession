import { afterEach, describe, expect, test } from "bun:test";
import { SessionKernelActorClient } from "./actor-client";
import {
  __setSessionKernelStoreForTest,
  installSessionKernelActor,
  sessionKernel,
} from "./kernel";
import { SESSION_KERNEL_MAX_WAITERS_PER_COMMAND } from "./actor-protocol";

let client: SessionKernelActorClient | undefined;
afterEach(() => {
  installSessionKernelActor(undefined);
  __setSessionKernelStoreForTest(undefined);
  client?.terminate();
  client = undefined;
});

async function actor(): Promise<SessionKernelActorClient> {
  const worker = new Worker(
    new URL("../../session-kernel-worker.ts", import.meta.url).href,
    { type: "module" },
  );
  client = new SessionKernelActorClient(worker);
  await client.hello();
  return client;
}

describe("session kernel actor boundary", () => {
  test("admits independent commands while physical work is active", async () => {
    const host = await actor();
    const first = await host.begin("s1", { requestId: "first", type: "test" });
    const second = await host.begin("s1", {
      requestId: "second",
      type: "test",
    });
    expect(first.executionId).toBeString();
    expect(second.executionId).toBeString();
    expect(second.executionId).not.toBe(first.executionId);
    await host.complete(second.executionId!, "two", []);
    await host.complete(first.executionId!, "one", []);
    expect(host.store.command("s1", "second")).toMatchObject({
      status: "completed",
      result: "two",
    });
  });

  test("coalesces and bounds waiters for the same execution", async () => {
    const host = await actor();
    const active = await host.begin("bounded", {
      requestId: "same",
      type: "test",
      payload: { stable: true },
    });
    const waiting = Array.from(
      { length: SESSION_KERNEL_MAX_WAITERS_PER_COMMAND },
      () =>
        host.begin("bounded", {
          requestId: "same",
          type: "test",
          payload: { stable: true },
        }),
    );
    await Bun.sleep(25);
    await expect(
      host.begin("bounded", {
        requestId: "same",
        type: "test",
        payload: { stable: true },
      }),
    ).rejects.toMatchObject({ retryable: true });
    await host.complete(active.executionId!, "done", []);
    expect(
      (await Promise.all(waiting)).map(({ duplicate, result }) => ({
        duplicate,
        result,
      })),
    ).toEqual(
      Array.from({ length: SESSION_KERNEL_MAX_WAITERS_PER_COMMAND }, () => ({
        duplicate: true,
        result: "done",
      })),
    );
  });

  test("fail-stops after a failure receipt cannot be settled", async () => {
    const host = await actor();
    await expect(
      host.fail("missing-execution", "disk failed", true),
    ).rejects.toThrow();
    await expect(
      host.begin("s1", { requestId: "after-fatal", type: "test" }),
    ).rejects.toThrow();
  });

  test("starts compatibility work independently during an async execution", async () => {
    const host = await actor();
    const first = await host.begin("s1", { requestId: "first", type: "test" });
    const syncDuring = host.beginSync("s1", {
      requestId: "sync",
      type: "sync:transcript_append",
    });
    expect(syncDuring.executionId).toBeString();
    host.store.setRunState({
      sessionId: "s1",
      state: "running",
      event: "stream_started",
    });
    expect(host.store.runState("s1").state).toBe("running");
    host.completeSync(syncDuring.executionId!, "synced", []);
    expect(host.store.command("s1", "sync")).toMatchObject({
      status: "completed",
      result: "synced",
    });
    await host.complete(first.executionId!, null, []);

    const sync = host.beginSync("s1", {
      requestId: "after",
      type: "sync:test",
    });
    expect(sync.executionId).toBeString();
    host.completeSync(sync.executionId!, "done", []);
  });

  test("a tombstone rejects compatibility writes during an active execution", async () => {
    const host = await actor();
    const active = await host.begin("deleted", {
      requestId: "active",
      type: "test",
    });
    host.store.tombstoneSession("deleted");
    expect(() =>
      host.beginSync("deleted", {
      requestId: "late",
      type: "sync:transcript_append",
      }),
    ).toThrow("Session deleted was deleted");
    await host.complete(active.executionId!, null, []);
  });

  test("persists detached writes while a command effect is active", async () => {
    const host = await actor();
    const active = await host.begin("detached", {
      requestId: "active",
      type: "submit_prompt",
    });
    installSessionKernelActor(host);
    const kernel = sessionKernel("detached");

    kernel.setRunState({ state: "running", event: "stream_started" });
    kernel.enqueueEffect("notify", { ok: true }, "detached-effect");
    expect(kernel.runState().state).toBe("running");
    expect(host.store.pendingOutbox(Date.now(), 10, ["notify"])).toHaveLength(
      1,
    );

    await host.complete(active.executionId!, "done", []);
  });

  test("reduces run events atomically while gateway work is still active", async () => {
    const host = await actor();
    const active = await host.begin("autonomous", {
      requestId: "physical-work",
      type: "submit_prompt",
    });
    expect(
      host.decideRunEvent({ sessionId: "autonomous", event: "prompt" }),
    ).toMatchObject({ accepted: true, from: "idle", to: "starting" });
    expect(
      host.decideRunEvent({
      sessionId: "autonomous",
      event: "run_registered",
      runKey: "run-1",
      }),
    ).toMatchObject({
      accepted: true,
      from: "starting",
      to: "running",
      state: { currentRunId: "run-1", generation: 1 },
    });
    expect(
      host.decideRunEvent({
      sessionId: "autonomous",
      event: "run_registered",
      runKey: "stale-run",
      }),
    ).toMatchObject({
      accepted: false,
      reason: "stale_run",
      state: { currentRunId: "run-1", generation: 1 },
    });
    expect(host.store.runState("autonomous")).toMatchObject({
      state: "running",
      currentRunId: "run-1",
      generation: 1,
    });
    await host.complete(active.executionId!, "done", []);
  });

  test("hydrates persisted run state into the gateway projection", async () => {
    const host = await actor();
    host.callStore("setRunState", [
      {
      sessionId: "persisted",
      state: "running",
      event: "run_registered",
      generation: 4,
      currentRunId: "run-4",
      },
    ]);
    await host.hello();
    expect(host.store.runState("persisted")).toMatchObject({
      state: "running",
      generation: 4,
      currentRunId: "run-4",
    });
  });

  test("fails new requests immediately after the actor stops", async () => {
    const host = await actor();
    host.terminate();
    client = undefined;
    await expect(
      host.begin("s1", { requestId: "after-stop", type: "test" }),
    ).rejects.toThrow("actor stopped");
  });

  test("returns a terminal failure instead of re-executing it", async () => {
    const host = await actor();
    const first = await host.begin("sticky", {
      requestId: "same",
      type: "test",
    });
    await host.complete(
      first.executionId!,
      { __sessionKernelFailure: true, message: "not allowed" },
      [],
    );
    let failure: unknown;
    try {
      await host.begin("sticky", { requestId: "same", type: "test" });
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toContain("not allowed");
  });

  test("acknowledges replay results through async IPC", async () => {
    const host = await actor();
    const admission = await host.begin("ack", {
      requestId: "one",
      type: "take",
    });
    await host.complete(admission.executionId!, { item: "kept" }, []);
    await host.acknowledgeCommand("ack", "one");
    expect(host.store.command("ack", "one")?.acknowledgedAt).toBeNumber();
  });

  test("loads registered runtime work through async IPC", async () => {
    const host = await actor();
    host.callStore("scheduleTimer", [
      {
      sessionId: "known",
      timerId: "wake",
      kind: "known_timer",
      dueAt: Date.now() - 1,
      payload: null,
      },
    ]);
    host.callStore("scheduleTimer", [
      {
      sessionId: "future",
      timerId: "wake",
      kind: "future_timer",
      dueAt: Date.now() - 1,
      payload: null,
      },
    ]);
    host.callStore("enqueueOutbox", ["known", "known_effect", null, "known"]);
    host.callStore("enqueueOutbox", [
      "future",
      "future_effect",
      null,
      "future",
    ]);
    const work = await host.runtimeWork(["known_timer"], ["known_effect"]);
    expect(work.timers.map((timer) => timer.kind)).toEqual(["known_timer"]);
    expect(work.outbox.map((item) => item.kind)).toEqual(["known_effect"]);
  });

  test("returns a committed result after an uncertain reply", async () => {
    const host = await actor();
    const first = await host.begin("s1", {
      requestId: "same",
      type: "test",
      payload: { n: 1 },
    });
    await host.complete(first.executionId!, { accepted: true }, []);
    expect(
      await host.begin("s1", {
        requestId: "same",
        type: "test",
        payload: { n: 1 },
      }),
    ).toMatchObject({ duplicate: true, result: { accepted: true } });
  });
  test("keeps actor reducers responsive while gateway effects stay ordered", async () => {
    const host = await actor();
    installSessionKernelActor(host);
    const kernel = sessionKernel("ordered-effects");
    let releaseFirst!: () => void;
    const firstBlocked = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const order: string[] = [];
    const first = kernel.dispatch(
      { requestId: "first-effect", type: "test", replaySafe: true },
      async () => {
        order.push("first-start");
        await firstBlocked;
        order.push("first-end");
        return "first";
      },
    );
    const second = kernel.dispatch(
      { requestId: "second-effect", type: "test", replaySafe: true },
      () => {
        order.push("second");
        return "second";
      },
    );
    await Bun.sleep(20);
    expect(order).toEqual(["first-start"]);
    host.decideDelivery({
      op: "set",
      sessionId: "ordered-effects",
      slot: "queued",
      value: [{ id: "q1", content: "still responsive" }],
    });
    host.decideAsk({
      op: "set",
      sessionId: "ordered-effects",
      value: { questionId: "ask-1", questions: [] },
    });
    expect(
      host.decideDelivery({
        op: "snapshot",
        sessionId: "ordered-effects",
      }).queued,
    ).toHaveLength(1);
    expect(
      host.decideAsk({
        op: "snapshot",
        sessionId: "ordered-effects",
      }),
    ).toMatchObject({ questionId: "ask-1" });
    releaseFirst();
    expect(await first).toMatchObject({ result: "first" });
    expect(await second).toMatchObject({ result: "second" });
    expect(order).toEqual(["first-start", "first-end", "second"]);
  });
});
