import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, stat, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { connect, createServer, type Socket } from "node:net";
import {
  AGENT_HOST_PROTOCOL_VERSION,
  decodeAgentExecutorAccessGrant,
  type AgentHostClientMessage,
  type AgentHostServerMessage,
  type AgentTurnSpec,
} from "@tellahq/opensession-protocol";
import { AgentHostClient } from "../server/agent-host-client";
import type {
  AgentTurnDriver,
  AgentTurnOutput,
  AgentTurnResult,
} from "./driver";
import { createAgentHost, type AgentHost } from "./host";
import { BoundedNdjsonDecoder, encodeNdjsonFrame } from "./socket-framing";

const accessGrant = decodeAgentExecutorAccessGrant("test-agent-host-access")!;
const fence = {
  sessionId: "session-1",
  runId: "run-1",
  turnId: "turn-1",
  generation: 3,
};
const spec: AgentTurnSpec = {
  fence,
  input: { prompt: "Build it" },
  mode: "code",
  modelPolicy: { model: "test-model" },
  enginePolicy: {},
  mcpPolicy: { servers: [] },
  transcriptPolicy: { maxAppendBytes: 4096, requireAck: true },
  runPolicy: { trustProfile: "interactive", runKind: "prompt" },
  identityPolicy: {},
  environmentPolicy: {},
  workspacePolicy: { executionRoot: "/work/session-1" },
  executorPolicy: {
    executorId: "executor-1",
    rootId: "root-1",
    generation: fence.generation,
    accessGrant,
    deadlineMs: Date.now() + 60 * 60_000,
  },
};

class FakeDriver implements AgentTurnDriver {
  output?: AgentTurnOutput;
  seenSpec?: AgentTurnSpec;
  steers: string[] = [];
  answers: string[] = [];
  acks: string[] = [];
  cancelled = 0;
  shutdowns = 0;
  nonsettlingCancel = false;
  nonsettlingSteer = false;
  private resolve!: (result: AgentTurnResult) => void;
  readonly completion = new Promise<AgentTurnResult>((resolve) => {
    this.resolve = resolve;
  });
  run(turnSpec: AgentTurnSpec, output: AgentTurnOutput) {
    this.seenSpec = turnSpec;
    this.output = output;
    return this.completion;
  }
  steer(input: { steerId: string; text: string }): void | Promise<void> {
    this.steers.push(`${input.steerId}:${input.text}`);
    if (this.nonsettlingSteer) return new Promise(() => undefined);
  }
  answer(askId: string) {
    this.answers.push(askId);
  }
  cancel(): void | Promise<void> {
    this.cancelled += 1;
    if (this.nonsettlingCancel) return new Promise(() => undefined);
  }
  transcriptAck(appendId: string) {
    this.acks.push(appendId);
  }
  shutdown() {
    this.shutdowns += 1;
  }
  finish(result: AgentTurnResult = { status: "completed" }) {
    this.resolve(result);
  }
}

const resources: Array<{ host: AgentHost; dir: string }> = [];
afterEach(async () => {
  for (const resource of resources.splice(0)) {
    await resource.host.stop();
    await rm(resource.dir, { recursive: true, force: true });
  }
});

async function setup() {
  const dir = await mkdtemp(join(tmpdir(), "agent-host-test-"));
  const socketPath = join(dir, "host.sock");
  const driver = new FakeDriver();
  const host = createAgentHost({
    socketPath,
    createDriver: () => driver,
    authorizeGeneration: () => true,
  });
  resources.push({ host, dir });
  await host.start();
  return { host, driver, socketPath };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 5));

describe("Agent Host transport", () => {
  test("runs event, transcript, ask, steer, answer, ack, cancel and finish flow", async () => {
    const { driver, socketPath } = await setup();
    const messages: AgentHostServerMessage[] = [];
    const client = new AgentHostClient({
      socketPath,
      onMessage: (message) => messages.push(message),
    });
    await client.connect();
    await client.startTurn(spec);
    expect(driver.seenSpec?.executorPolicy).toEqual(spec.executorPolicy);
    driver.output!.event({ type: "text_chunk", text: "hello" });
    driver.output!.proposeTranscript("append-1", [
      {
        id: "entry-1",
        type: "assistant",
        content: "hello",
        timestamp: new Date(0).toISOString(),
      },
    ]);
    driver.output!.ask("ask-1", { question: "Continue?" });
    client.steer("continue", "steer-1");
    client.answer("ask-1", { behavior: "deny", message: "no" });
    client.transcriptAck("append-1", 7);
    client.cancel();
    await tick();
    expect(driver.steers).toEqual(["steer-1:continue"]);
    expect(driver.answers).toEqual(["ask-1"]);
    expect(driver.acks).toEqual(["append-1"]);
    expect(driver.cancelled).toBe(1);
    expect(messages.map((message) => message.t)).toEqual([
      "event",
      "transcript_proposal",
      "ask",
    ]);
    driver.finish();
    await tick();
    expect(messages.at(-1)?.t).toBe("turn_finished");
    client.close();
  });

  test("rejects replay at or below the lineage generation high-water mark", async () => {
    const { driver, socketPath } = await setup();
    const client = new AgentHostClient({ socketPath });
    await client.connect();
    await client.startTurn(spec);
    driver.finish();
    await tick();
    await expect(client.startTurn(spec)).rejects.toThrow("stale_generation");
    await expect(
      client.startTurn({
        ...spec,
        fence: { ...fence, generation: fence.generation - 1 },
        executorPolicy: {
          ...spec.executorPolicy,
          generation: fence.generation - 1,
        },
      }),
    ).rejects.toThrow("stale_generation");
    client.close();
  });

  test("fails closed without durable generation authority", async () => {
    const dir = await mkdtemp(join(tmpdir(), "agent-host-no-authority-test-"));
    const socketPath = join(dir, "host.sock");
    const driver = new FakeDriver();
    const host = createAgentHost({
      socketPath,
      createDriver: () => driver,
    });
    resources.push({ host, dir });
    await host.start();
    const client = new AgentHostClient({ socketPath });
    await client.connect();
    await expect(client.startTurn(spec)).rejects.toThrow(
      "Durable generation authority is required",
    );
    expect(driver.output).toBeUndefined();
    client.close();
  });

  test("requires and consults durable generation authority when configured", async () => {
    const dir = await mkdtemp(join(tmpdir(), "agent-host-authority-test-"));
    const socketPath = join(dir, "host.sock");
    const driver = new FakeDriver();
    let durableFloor = fence.generation;
    const host = createAgentHost({
      socketPath,
      createDriver: () => driver,
      requireDurableGenerationAuthority: true,
      authorizeGeneration: async (candidate) => {
        if (candidate.generation <= durableFloor) return false;
        durableFloor = candidate.generation;
        return true;
      },
    });
    resources.push({ host, dir });
    await host.start();
    const client = new AgentHostClient({ socketPath });
    await client.connect();
    await expect(client.startTurn(spec)).rejects.toThrow("stale_generation");
    await client.startTurn({
      ...spec,
      fence: { ...fence, generation: fence.generation + 1 },
      executorPolicy: {
        ...spec.executorPolicy,
        generation: fence.generation + 1,
      },
    });
    driver.finish();
    await tick();
    expect(durableFloor).toBe(fence.generation + 1);
    client.close();
  });

  test("stop aborts and fences a pending generation reservation", async () => {
    const dir = await mkdtemp(
      join(tmpdir(), "agent-host-reservation-stop-test-"),
    );
    const socketPath = join(dir, "host.sock");
    let resolveAuthority!: (allowed: boolean) => void;
    let signal: AbortSignal | undefined;
    let created = 0;
    const authority = new Promise<boolean>((resolve) => {
      resolveAuthority = resolve;
    });
    const host = createAgentHost({
      socketPath,
      createDriver: () => {
        created += 1;
        return new FakeDriver();
      },
      authorizeGeneration: (_fence, candidateSignal) => {
        signal = candidateSignal;
        return authority;
      },
    });
    resources.push({ host, dir });
    await host.start();
    const client = new AgentHostClient({ socketPath });
    await client.connect();
    const starting = client.startTurn(spec).catch((error: unknown) => error);
    await tick();
    await host.stop();
    expect(String(await starting)).toContain("disconnected");
    expect(signal?.aborted).toBe(true);
    resolveAuthority(true);
    await tick();
    expect(created).toBe(0);
    client.close();
  });

  test("disconnect aborts a reservation and ignores late authorization", async () => {
    const dir = await mkdtemp(
      join(tmpdir(), "agent-host-reservation-close-test-"),
    );
    const socketPath = join(dir, "host.sock");
    let resolveAuthority!: (allowed: boolean) => void;
    let signal: AbortSignal | undefined;
    let created = 0;
    const authority = new Promise<boolean>((resolve) => {
      resolveAuthority = resolve;
    });
    const host = createAgentHost({
      socketPath,
      createDriver: () => {
        created += 1;
        return new FakeDriver();
      },
      authorizeGeneration: (_fence, candidateSignal) => {
        signal = candidateSignal;
        return authority;
      },
    });
    resources.push({ host, dir });
    await host.start();
    const client = new AgentHostClient({ socketPath });
    await client.connect();
    const starting = client.startTurn(spec).catch((error: unknown) => error);
    await tick();
    client.close();
    expect(String(await starting)).toContain("closed");
    await tick();
    expect(signal?.aborted).toBe(true);
    resolveAuthority(true);
    await tick();
    expect(created).toBe(0);
  });

  test("authorization timeout poisons the epoch and ignores late resolution", async () => {
    const dir = await mkdtemp(
      join(tmpdir(), "agent-host-reservation-timeout-test-"),
    );
    const socketPath = join(dir, "host.sock");
    let resolveAuthority!: (allowed: boolean) => void;
    let signal: AbortSignal | undefined;
    let created = 0;
    const authority = new Promise<boolean>((resolve) => {
      resolveAuthority = resolve;
    });
    const host = createAgentHost({
      socketPath,
      createDriver: () => {
        created += 1;
        return new FakeDriver();
      },
      authorizeGeneration: (_fence, candidateSignal) => {
        signal = candidateSignal;
        return authority;
      },
      authorizationDeadlineMs: 10,
    });
    resources.push({ host, dir });
    await host.start();
    const client = new AgentHostClient({ socketPath, timeoutMs: 100 });
    await client.connect();
    await expect(client.startTurn(spec)).rejects.toThrow(
      "authorization timed out",
    );
    expect(signal?.aborted).toBe(true);
    resolveAuthority(true);
    await tick();
    expect(created).toBe(0);
    await expect(client.startTurn(spec)).rejects.toThrow("host_busy");
    client.close();
  });

  test("shutdown bypasses a nonsettling generation authority", async () => {
    const dir = await mkdtemp(
      join(tmpdir(), "agent-host-reservation-shutdown-test-"),
    );
    const socketPath = join(dir, "host.sock");
    let signal: AbortSignal | undefined;
    const host = createAgentHost({
      socketPath,
      createDriver: () => new FakeDriver(),
      authorizeGeneration: (_fence, candidateSignal) => {
        signal = candidateSignal;
        return new Promise(() => undefined);
      },
    });
    resources.push({ host, dir });
    await host.start();
    const client = new AgentHostClient({ socketPath });
    await client.connect();
    const starting = client.startTurn(spec);
    await tick();
    client.shutdown();
    await expect(starting).rejects.toThrow("disconnected");
    expect(signal?.aborted).toBe(true);
    client.close();
  });

  test("rejects a stale generation and keeps the active turn", async () => {
    const { driver, socketPath } = await setup();
    const client = new AgentHostClient({ socketPath });
    await client.connect();
    await client.startTurn(spec);
    const messages = await rawExchange(
      socketPath,
      [
        {
          t: "hello",
          version: AGENT_HOST_PROTOCOL_VERSION,
          requestId: "hello-2",
        },
        {
          t: "cancel",
          version: AGENT_HOST_PROTOCOL_VERSION,
          requestId: "stale",
          fence: { ...fence, generation: 2 },
        },
      ],
      2,
    );
    expect(messages[1]).toMatchObject({
      t: "error",
      code: "stale_generation",
      requestId: "stale",
    });
    expect(driver.cancelled).toBe(0);
    client.close();
  });

  test("rejects the old turn-wide Executor grant contract", async () => {
    const { socketPath } = await setup();
    const { executorPolicy: _, ...withoutExecutorPolicy } = spec;
    const messages = await rawExchange(
      socketPath,
      [
        {
          t: "hello",
          version: AGENT_HOST_PROTOCOL_VERSION,
          requestId: "hello",
        },
        {
          t: "start_turn",
          version: AGENT_HOST_PROTOCOL_VERSION,
          requestId: "old-contract",
          spec: { ...withoutExecutorPolicy, executorGrant: accessGrant },
        },
      ],
      2,
    );
    expect(messages.at(-1)).toMatchObject({
      t: "error",
      requestId: "old-contract",
      code: "invalid_request",
    });
  });

  test("fails closed on a malformed frame and cancels on owner disconnect", async () => {
    const { driver, socketPath } = await setup();
    const malformed = connect(socketPath);
    await new Promise<void>((resolve) => malformed.once("connect", resolve));
    malformed.write("not-json\n");
    await new Promise<void>((resolve) => malformed.once("close", resolve));

    const client = new AgentHostClient({ socketPath });
    await client.connect();
    await client.startTurn(spec);
    client.close();
    await tick();
    expect(driver.cancelled).toBe(1);
  });

  test("creates an exact private parent and socket mode", async () => {
    const { socketPath } = await setup();
    expect((await stat(join(socketPath, ".."))).mode & 0o777).toBe(0o700);
    expect((await stat(socketPath)).mode & 0o777).toBe(0o600);
  });

  test("refuses a second live host without unlinking the first", async () => {
    const { host, socketPath } = await setup();
    const second = createAgentHost({
      socketPath,
      createDriver: () => new FakeDriver(),
    });
    resources.push({ host: second, dir: join(socketPath, "..") });
    await expect(second.start()).rejects.toThrow("already claimed");
    expect((await stat(socketPath)).isSocket()).toBe(true);
    await host.start();
  });

  test("serializes concurrent contenders and permits a successor after cleanup", async () => {
    const dir = await mkdtemp(join(tmpdir(), "agent-host-contender-test-"));
    const socketPath = join(dir, "host.sock");
    const hosts = [
      createAgentHost({ socketPath, createDriver: () => new FakeDriver() }),
      createAgentHost({ socketPath, createDriver: () => new FakeDriver() }),
    ];
    try {
      const starts = await Promise.allSettled(
        hosts.map((host) => host.start()),
      );
      expect(
        starts.filter((result) => result.status === "fulfilled"),
      ).toHaveLength(1);
      expect(
        starts.filter((result) => result.status === "rejected"),
      ).toHaveLength(1);
      const winner = hosts[starts[0]!.status === "fulfilled" ? 0 : 1]!;
      const loser = hosts[winner === hosts[0] ? 1 : 0]!;
      await winner.stop();
      await loser.start();
      expect((await stat(socketPath)).isSocket()).toBe(true);
      await loser.stop();
    } finally {
      await Promise.all(hosts.map((host) => host.stop()));
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("atomically admits only one concurrent process claim", async () => {
    const dir = await mkdtemp(join(tmpdir(), "agent-host-process-claim-test-"));
    const socketPath = join(dir, "host.sock");
    const script = `const {createAgentHost}=await import(process.env.HOST_MODULE);const host=createAgentHost({socketPath:process.env.SOCKET_PATH,createDriver:()=>{throw new Error("unused")}});try{await host.start();console.log("acquired");await new Promise(r=>setTimeout(r,500));await host.stop()}catch(error){console.log(String(error).includes("already claimed")?"claimed":"unexpected:"+error)}`;
    const spawn = () =>
      Bun.spawn({
        cmd: [process.execPath, "-e", script],
        env: {
          ...process.env,
          HOST_MODULE: join(import.meta.dir, "host.ts"),
          SOCKET_PATH: socketPath,
        },
        stdout: "pipe",
        stderr: "pipe",
      });
    const children = [spawn(), spawn()];
    try {
      const output = await Promise.all(
        children.map((child) => new Response(child.stdout).text()),
      );
      await Promise.all(children.map((child) => child.exited));
      expect(output.filter((value) => value.includes("acquired"))).toHaveLength(
        1,
      );
      expect(output.filter((value) => value.includes("claimed"))).toHaveLength(
        1,
      );
    } finally {
      for (const child of children) child.kill();
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("rejects a symlink at the final socket path", async () => {
    const dir = await mkdtemp(join(tmpdir(), "agent-host-symlink-test-"));
    const socketPath = join(dir, "host.sock");
    await symlink(join(dir, "missing.sock"), socketPath);
    const host = createAgentHost({
      socketPath,
      createDriver: () => new FakeDriver(),
    });
    resources.push({ host, dir });
    await expect(host.start()).rejects.toThrow("unsafe");
  });

  test("fails closed on a crashed claim until supervisor cleanup", async () => {
    const dir = await mkdtemp(join(tmpdir(), "agent-host-stale-test-"));
    const socketPath = join(dir, "host.sock");
    const child = Bun.spawn({
      cmd: [
        process.execPath,
        "-e",
        `const {createAgentHost}=await import(process.env.HOST_MODULE);const host=createAgentHost({socketPath:process.env.SOCKET_PATH,createDriver:()=>{throw new Error("unused")}});await host.start();console.log("ready");await new Promise(()=>{});`,
      ],
      env: {
        ...process.env,
        HOST_MODULE: join(import.meta.dir, "host.ts"),
        SOCKET_PATH: socketPath,
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    const reader = child.stdout.getReader();
    expect(new TextDecoder().decode((await reader.read()).value)).toContain(
      "ready",
    );
    child.kill(9);
    await child.exited;
    expect((await stat(socketPath)).isSocket()).toBe(true);
    const host = createAgentHost({
      socketPath,
      createDriver: () => new FakeDriver(),
    });
    resources.push({ host, dir });
    await expect(host.start()).rejects.toThrow("already claimed");

    // The supervisor must verify that the prior process is dead before this.
    await rm(`${socketPath}.claim`);
    await host.start();
    expect((await stat(socketPath)).isSocket()).toBe(true);
  });

  test("poisons abandoned ownership instead of overlapping a successor", async () => {
    const dir = await mkdtemp(join(tmpdir(), "agent-host-fence-test-"));
    const socketPath = join(dir, "host.sock");
    const drivers = [new FakeDriver(), new FakeDriver()];
    drivers[0]!.nonsettlingCancel = true;
    let created = 0;
    let abandon: (() => void) | undefined;
    const setHostTimeout = ((callback: () => void) => {
      abandon = callback;
      return { unref: () => undefined };
    }) as unknown as typeof setTimeout;
    const host = createAgentHost({
      socketPath,
      createDriver: () => drivers[created++]!,
      cancellationDeadlineMs: 15,
      authorizeGeneration: () => true,
      setTimeout: setHostTimeout,
      clearTimeout: (() => undefined) as unknown as typeof clearTimeout,
    });
    resources.push({ host, dir });
    await host.start();

    const first = new AgentHostClient({ socketPath });
    await first.connect();
    await first.startTurn(spec);
    first.close();
    await tick();
    expect(abandon).toBeDefined();
    abandon!();

    const second = new AgentHostClient({ socketPath });
    await second.connect();
    await expect(
      second.startTurn({
        ...spec,
        fence: { ...fence, turnId: "turn-2", generation: 4 },
        executorPolicy: { ...spec.executorPolicy, generation: 4 },
      }),
    ).rejects.toThrow("host_busy");
    drivers[0]!.output!.event({ type: "text_chunk", text: "late" });
    drivers[0]!.finish();
    await tick();
    expect(drivers[0]!.cancelled).toBe(1);
    expect(created).toBe(1);
    await expect(
      second.startTurn({
        ...spec,
        fence: { ...fence, turnId: "turn-3", generation: 5 },
        executorPolicy: { ...spec.executorPolicy, generation: 5 },
      }),
    ).rejects.toThrow("host_busy");
    second.close();
  });

  test("retains its claim when stop cannot drain physical work", async () => {
    const dir = await mkdtemp(join(tmpdir(), "agent-host-stop-poison-test-"));
    const socketPath = join(dir, "host.sock");
    const driver = new FakeDriver();
    driver.nonsettlingCancel = true;
    const host = createAgentHost({
      socketPath,
      createDriver: () => driver,
      authorizeGeneration: () => true,
    });
    resources.push({ host, dir });
    await host.start();
    const client = new AgentHostClient({ socketPath });
    await client.connect();
    await client.startTurn(spec);
    await host.stop();

    const contender = createAgentHost({
      socketPath,
      createDriver: () => new FakeDriver(),
    });
    resources.push({ host: contender, dir });
    await expect(contender.start()).rejects.toThrow("already claimed");
    client.close();
  });

  test("lets cancel bypass a nonsettling driver control", async () => {
    const { driver, socketPath } = await setup();
    driver.nonsettlingSteer = true;
    const client = new AgentHostClient({ socketPath });
    await client.connect();
    await client.startTurn(spec);
    client.steer("blocked", "steer-blocked");
    client.cancel();
    await tick();
    expect(driver.steers).toEqual(["steer-blocked:blocked"]);
    expect(driver.cancelled).toBe(1);
    client.close();
  });

  test("keeps the receive queue responsive to a nonsettling in-band cancel", async () => {
    const { driver, socketPath } = await setup();
    driver.nonsettlingCancel = true;
    const messages = await rawExchange(
      socketPath,
      [
        {
          t: "hello",
          version: AGENT_HOST_PROTOCOL_VERSION,
          requestId: "hello",
        },
        {
          t: "start_turn",
          version: AGENT_HOST_PROTOCOL_VERSION,
          requestId: "start",
          spec,
        },
        {
          t: "cancel",
          version: AGENT_HOST_PROTOCOL_VERSION,
          requestId: "cancel",
          fence,
        },
        {
          t: "answer",
          version: AGENT_HOST_PROTOCOL_VERSION,
          requestId: "after-cancel",
          fence,
          askId: "missing",
          result: { behavior: "deny", message: "no" },
        },
      ],
      3,
    );
    expect(messages.map((message) => message.t)).toEqual([
      "hello",
      "turn_started",
      "error",
    ]);
    expect(driver.cancelled).toBe(1);
  });

  test("does not retain a transcript proposal when its owner is unwritable", async () => {
    const { driver, socketPath } = await setup();
    const client = new AgentHostClient({ socketPath });
    await client.connect();
    await client.startTurn(spec);
    client.close();
    await tick();
    const entry = {
      id: "entry-1",
      type: "assistant" as const,
      content: "late",
      timestamp: new Date(0).toISOString(),
    };
    expect(() => driver.output!.proposeTranscript("append-1", [entry])).toThrow(
      "owner is disconnected",
    );
    expect(() => driver.output!.proposeTranscript("append-2", [entry])).toThrow(
      "owner is disconnected",
    );
  });

  test("shares one bounded connect handshake and blocks premature turns", async () => {
    const dir = await mkdtemp(join(tmpdir(), "agent-host-connect-test-"));
    const socketPath = join(dir, "host.sock");
    const sockets = new Set<Socket>();
    let connections = 0;
    const server = createServer((socket) => {
      sockets.add(socket);
      connections += 1;
      socket.on("close", () => sockets.delete(socket));
      const decoder = new BoundedNdjsonDecoder();
      socket.on("data", (chunk) => {
        for (const message of decoder.push(
          Buffer.from(chunk),
        ) as AgentHostClientMessage[]) {
          if (message.t === "hello")
            setTimeout(
              () =>
                socket.write(encodeNdjsonFrame({ ...message, accepted: true })),
              20,
            );
        }
      });
      socket.on("error", () => undefined);
    });
    await new Promise<void>((resolve) => server.listen(socketPath, resolve));
    const client = new AgentHostClient({ socketPath, timeoutMs: 100 });
    try {
      const first = client.connect();
      const second = client.connect();
      expect(second).toBe(first);
      await expect(client.startTurn(spec)).rejects.toThrow(
        "handshake is not complete",
      );
      await Promise.all([first, second]);
      expect(connections).toBe(1);
    } finally {
      client.close();
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("start timeout closes the generation and ignores its late acknowledgement", async () => {
    const dir = await mkdtemp(join(tmpdir(), "agent-host-client-test-"));
    const socketPath = join(dir, "host.sock");
    const outbound: AgentHostClientMessage[] = [];
    let connectionNumber = 0;
    const sockets = new Set<Socket>();
    const server = createServer((socket) => {
      sockets.add(socket);
      socket.on("close", () => sockets.delete(socket));
      connectionNumber += 1;
      const number = connectionNumber;
      const decoder = new BoundedNdjsonDecoder();
      socket.on("data", (chunk) => {
        for (const message of decoder.push(
          Buffer.from(chunk),
        ) as AgentHostClientMessage[]) {
          outbound.push(message);
          if (message.t === "hello")
            socket.write(encodeNdjsonFrame({ ...message, accepted: true }));
          if (message.t === "start_turn") {
            const reply = {
              t: "turn_started" as const,
              version: AGENT_HOST_PROTOCOL_VERSION,
              requestId: message.requestId,
              fence: message.spec.fence,
            };
            if (number === 1)
              setTimeout(() => socket.write(encodeNdjsonFrame(reply)), 50);
            else socket.write(encodeNdjsonFrame(reply));
          }
        }
      });
      socket.on("error", () => undefined);
    });
    await new Promise<void>((resolve) => server.listen(socketPath, resolve));
    const seen: AgentHostServerMessage[] = [];
    const client = new AgentHostClient({
      socketPath,
      timeoutMs: 20,
      onMessage: (message) => seen.push(message),
    });
    try {
      await client.connect();
      await expect(client.startTurn(spec)).rejects.toThrow(
        "turn_started timed out",
      );
      await new Promise((resolve) => setTimeout(resolve, 65));
      expect(outbound.map((message) => message.t)).toContain("cancel");
      expect(() => client.connect()).toThrow("ownership is uncertain");
      expect(connectionNumber).toBe(1);
      expect(seen).toEqual([]);
    } finally {
      client.close();
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("start and stop are idempotent and clean up the socket", async () => {
    const { host, socketPath } = await setup();
    await host.start();
    await host.stop();
    await host.stop();
    expect(await Bun.file(socketPath).exists()).toBe(false);
  });
});

async function rawExchange(
  socketPath: string,
  outbound: unknown[],
  count: number,
): Promise<AgentHostServerMessage[]> {
  return new Promise((resolve, reject) => {
    const socket: Socket = connect(socketPath);
    const decoder = new BoundedNdjsonDecoder();
    const messages: AgentHostServerMessage[] = [];
    socket.on("connect", () => {
      for (const message of outbound) socket.write(encodeNdjsonFrame(message));
    });
    socket.on("data", (chunk) => {
      try {
        messages.push(
          ...(decoder.push(Buffer.from(chunk)) as AgentHostServerMessage[]),
        );
        if (messages.length >= count) {
          socket.destroy();
          resolve(messages);
        }
      } catch (error) {
        reject(error);
      }
    });
    socket.on("error", reject);
  });
}
