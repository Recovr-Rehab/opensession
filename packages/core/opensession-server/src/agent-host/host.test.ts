import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, stat, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { connect, createServer, type Socket } from "node:net";
import {
  AGENT_HOST_PROTOCOL_VERSION,
  decodeExecutorGrant,
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

const grant = decodeExecutorGrant("test-executor-grant")!;
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
  mcpPolicy: { servers: [] },
  transcriptPolicy: { maxAppendBytes: 4096, requireAck: true },
  executorGrant: grant,
};

class FakeDriver implements AgentTurnDriver {
  output?: AgentTurnOutput;
  steers: string[] = [];
  answers: string[] = [];
  acks: string[] = [];
  cancelled = 0;
  shutdowns = 0;
  nonsettlingCancel = false;
  private resolve!: (result: AgentTurnResult) => void;
  readonly completion = new Promise<AgentTurnResult>((resolve) => {
    this.resolve = resolve;
  });
  run(_spec: AgentTurnSpec, output: AgentTurnOutput) {
    this.output = output;
    return this.completion;
  }
  steer(input: { steerId: string; text: string }) {
    this.steers.push(`${input.steerId}:${input.text}`);
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
  const host = createAgentHost({ socketPath, createDriver: () => driver });
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
    await expect(second.start()).rejects.toThrow("already live");
    expect((await stat(socketPath)).isSocket()).toBe(true);
    await host.start();
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

  test("recovers a socket left stale by a crashed process", async () => {
    const dir = await mkdtemp(join(tmpdir(), "agent-host-stale-test-"));
    const socketPath = join(dir, "host.sock");
    const child = Bun.spawn({
      cmd: [
        process.execPath,
        "-e",
        `const {createServer}=require("node:net");const server=createServer();server.listen(process.env.SOCKET_PATH,()=>process.stdout.write("ready\\n"));`,
      ],
      env: { ...process.env, SOCKET_PATH: socketPath },
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
    await host.start();
    expect((await stat(socketPath)).isSocket()).toBe(true);
  });

  test("bounds abandoned ownership and fences late driver output", async () => {
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

    const messages: AgentHostServerMessage[] = [];
    const second = new AgentHostClient({
      socketPath,
      onMessage: (message) => messages.push(message),
    });
    await second.connect();
    await second.startTurn({
      ...spec,
      fence: { ...fence, turnId: "turn-2", generation: 4 },
    });
    drivers[0]!.output!.event({ type: "text_chunk", text: "late" });
    drivers[0]!.finish();
    await tick();
    expect(drivers[0]!.cancelled).toBe(1);
    expect(messages).toEqual([]);
    drivers[1]!.finish();
    await tick();
    expect(messages.map((message) => message.t)).toEqual(["turn_finished"]);
    second.close();
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
      await client.connect();
      await client.startTurn({
        ...spec,
        fence: { ...fence, turnId: "turn-fresh", generation: 4 },
      });
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
