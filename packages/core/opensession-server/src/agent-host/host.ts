import { chmod, lstat, mkdir, unlink } from "node:fs/promises";
import { dirname, isAbsolute, parse, resolve } from "node:path";
import { createServer, connect, type Server, type Socket } from "node:net";
import {
  AGENT_HOST_PROTOCOL_VERSION,
  decodeAgentHostHello,
  decodeExecutorGrant,
  isAgentTurnFence,
  type AgentHostClientMessage,
  type AgentHostServerMessage,
  type AgentTurnFence,
  type AgentTurnSpec,
  type StreamEvent,
  type TranscriptEntry,
} from "@tellahq/opensession-protocol";
import type {
  AgentTurnDriver,
  AgentTurnDriverFactory,
  AgentTurnResult,
} from "./driver";
import {
  AGENT_HOST_MAX_FRAME_BYTES,
  BoundedNdjsonDecoder,
  encodeNdjsonFrame,
} from "./socket-framing";

export interface AgentHostOptions {
  socketPath: string;
  createDriver: AgentTurnDriverFactory;
  maxFrameBytes?: number;
  cancellationDeadlineMs?: number;
  livenessProbeTimeoutMs?: number;
  setTimeout?: typeof globalThis.setTimeout;
  clearTimeout?: typeof globalThis.clearTimeout;
}

interface ConnectionState {
  socket: Socket;
  handshake: boolean;
  closed: boolean;
  queue: Promise<void>;
}

interface ActiveTurn {
  fence: AgentTurnFence;
  driver: AgentTurnDriver;
  owner: ConnectionState;
  requestId: string;
  pendingAppendId?: string;
  askIds: Set<string>;
  abandonTimer?: ReturnType<typeof setTimeout>;
}

interface SocketIdentity {
  dev: number;
  ino: number;
}

type DriverEmission =
  | { t: "event"; event: StreamEvent }
  | { t: "transcript_proposal"; appendId: string; entries: TranscriptEntry[] }
  | { t: "ask"; askId: string; input: Record<string, unknown> };

const allowed = (value: Record<string, unknown>, keys: string[]) =>
  Object.keys(value).every((key) => keys.includes(key));
const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
const nonempty = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0;

function sameLineage(left: AgentTurnFence, right: AgentTurnFence): boolean {
  return (
    left.sessionId === right.sessionId &&
    left.runId === right.runId &&
    left.turnId === right.turnId
  );
}

function sameFence(left: AgentTurnFence, right: AgentTurnFence): boolean {
  return sameLineage(left, right) && left.generation === right.generation;
}

function validTurnSpec(value: unknown): value is AgentTurnSpec {
  if (
    !record(value) ||
    !allowed(value, [
      "fence",
      "input",
      "mode",
      "modelPolicy",
      "mcpPolicy",
      "transcriptPolicy",
      "executorGrant",
    ])
  )
    return false;
  const { fence, input, modelPolicy, mcpPolicy, transcriptPolicy } = value;
  if (
    !isAgentTurnFence(fence) ||
    !record(input) ||
    !allowed(input, ["prompt", "promptEntryId", "images"])
  )
    return false;
  if (
    typeof input.prompt !== "string" ||
    (input.promptEntryId !== undefined && !nonempty(input.promptEntryId)) ||
    (input.images !== undefined && !Array.isArray(input.images))
  )
    return false;
  if (!(["ask", "code", "scratch"] as unknown[]).includes(value.mode))
    return false;
  if (
    !record(modelPolicy) ||
    !allowed(modelPolicy, [
      "model",
      "effort",
      "fastMode",
      "accessGrant",
      "fallbackModel",
    ]) ||
    !nonempty(modelPolicy.model)
  )
    return false;
  if (
    modelPolicy.effort !== undefined &&
    typeof modelPolicy.effort !== "string"
  )
    return false;
  if (
    modelPolicy.fastMode !== undefined &&
    typeof modelPolicy.fastMode !== "boolean"
  )
    return false;
  if (
    modelPolicy.accessGrant !== undefined &&
    typeof modelPolicy.accessGrant !== "string"
  )
    return false;
  if (
    modelPolicy.fallbackModel !== undefined &&
    typeof modelPolicy.fallbackModel !== "string"
  )
    return false;
  if (!record(mcpPolicy) || !allowed(mcpPolicy, ["servers", "accessGrant"]))
    return false;
  if (!(
    mcpPolicy.servers === "all" ||
    (Array.isArray(mcpPolicy.servers) && mcpPolicy.servers.every(nonempty))
  ))
    return false;
  if (
    mcpPolicy.accessGrant !== undefined &&
    typeof mcpPolicy.accessGrant !== "string"
  )
    return false;
  if (
    !record(transcriptPolicy) ||
    !allowed(transcriptPolicy, [
      "afterChangeSeq",
      "maxAppendBytes",
      "requireAck",
    ])
  )
    return false;
  if (
    transcriptPolicy.afterChangeSeq !== undefined &&
    (!Number.isSafeInteger(transcriptPolicy.afterChangeSeq) ||
      (transcriptPolicy.afterChangeSeq as number) < 0)
  )
    return false;
  if (
    !Number.isSafeInteger(transcriptPolicy.maxAppendBytes) ||
    (transcriptPolicy.maxAppendBytes as number) < 1 ||
    transcriptPolicy.requireAck !== true
  )
    return false;
  return decodeExecutorGrant(value.executorGrant) !== undefined;
}

function decodeMessage(value: unknown): AgentHostClientMessage | undefined {
  if (
    !record(value) ||
    value.version !== AGENT_HOST_PROTOCOL_VERSION ||
    !nonempty(value.requestId) ||
    !nonempty(value.t)
  )
    return undefined;
  if (value.t === "hello") return decodeAgentHostHello(value);
  if (value.t === "start_turn") {
    return allowed(value, ["t", "version", "requestId", "spec"]) &&
      validTurnSpec(value.spec)
      ? (value as unknown as AgentHostClientMessage)
      : undefined;
  }
  if (!isAgentTurnFence(value.fence)) return undefined;
  switch (value.t) {
    case "steer":
      return allowed(value, [
        "t",
        "version",
        "requestId",
        "fence",
        "text",
        "images",
        "steerId",
      ]) &&
        nonempty(value.text) &&
        nonempty(value.steerId) &&
        (value.images === undefined || Array.isArray(value.images))
        ? (value as unknown as AgentHostClientMessage)
        : undefined;
    case "answer": {
      const result = value.result;
      const validResult =
        record(result) &&
        (result.behavior === "allow"
          ? record(result.updatedInput) &&
            allowed(result, ["behavior", "updatedInput"])
          : result.behavior === "deny" &&
            typeof result.message === "string" &&
            allowed(result, ["behavior", "message"]));
      return allowed(value, [
        "t",
        "version",
        "requestId",
        "fence",
        "askId",
        "result",
      ]) &&
        nonempty(value.askId) &&
        validResult
        ? (value as unknown as AgentHostClientMessage)
        : undefined;
    }
    case "cancel":
    case "shutdown":
      return allowed(value, ["t", "version", "requestId", "fence"])
        ? (value as unknown as AgentHostClientMessage)
        : undefined;
    case "transcript_ack":
      return allowed(value, [
        "t",
        "version",
        "requestId",
        "fence",
        "appendId",
        "changeSeq",
      ]) &&
        nonempty(value.appendId) &&
        Number.isSafeInteger(value.changeSeq) &&
        (value.changeSeq as number) >= 0
        ? (value as unknown as AgentHostClientMessage)
        : undefined;
    default:
      return undefined;
  }
}

export class AgentHost {
  private server?: Server;
  private starting?: Promise<void>;
  private stopping?: Promise<void>;
  private active?: ActiveTurn;
  private socketIdentity?: SocketIdentity;
  private readonly connections = new Set<ConnectionState>();

  constructor(private readonly options: AgentHostOptions) {}

  start(): Promise<void> {
    if (this.server?.listening) return Promise.resolve();
    if (this.starting) return this.starting;
    if (this.stopping) throw new Error("Agent Host is stopping");
    this.starting = this.startListening().finally(() => {
      this.starting = undefined;
    });
    return this.starting;
  }

  stop(): Promise<void> {
    if (this.stopping) return this.stopping;
    this.stopping = this.stopInternal().finally(() => {
      this.stopping = undefined;
    });
    return this.stopping;
  }

  private async startListening(): Promise<void> {
    await this.prepareSocketPath();
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const server = createServer((socket) => this.accept(socket));
      this.server = server;
      try {
        await new Promise<void>((resolveListen, rejectListen) => {
          const onError = (error: Error) => rejectListen(error);
          server.once("error", onError);
          server.listen(this.options.socketPath, () => {
            server.off("error", onError);
            resolveListen();
          });
        });
        const socketStat = await lstat(this.options.socketPath);
        if (!socketStat.isSocket() || socketStat.isSymbolicLink())
          throw new Error("Agent Host socket path is unsafe");
        await chmod(this.options.socketPath, 0o600);
        this.socketIdentity = { dev: socketStat.dev, ino: socketStat.ino };
        return;
      } catch (error) {
        this.server = undefined;
        if (server.listening)
          await new Promise<void>((resolveClose) =>
            server.close(() => resolveClose()),
          );
        const code = (error as NodeJS.ErrnoException).code;
        if (code !== "EADDRINUSE" || attempt > 0) throw error;
        await this.removeStaleSocket();
      }
    }
  }

  private async stopInternal(): Promise<void> {
    await this.starting?.catch(() => undefined);
    const server = this.server;
    this.server = undefined;
    const active = this.active;
    if (active) {
      this.fence(active);
      this.invokeDriver(() => active.driver.cancel());
      this.invokeDriver(() => active.driver.shutdown());
    }
    for (const connection of this.connections) {
      connection.closed = true;
      connection.socket.removeAllListeners();
      connection.socket.destroy();
    }
    this.connections.clear();
    if (server?.listening)
      await new Promise<void>((resolveClose) =>
        server.close(() => resolveClose()),
      );
    await this.unlinkOwnedSocket();
  }

  private async prepareSocketPath(): Promise<void> {
    const socketPath = this.options.socketPath;
    if (!isAbsolute(socketPath) || resolve(socketPath) !== socketPath)
      throw new Error("Agent Host socket path must be absolute and normalized");
    const parent = dirname(socketPath);
    if (parent === parse(parent).root)
      throw new Error(
        "Agent Host socket parent must not be the filesystem root",
      );
    await mkdir(parent, { recursive: true, mode: 0o700 });
    await this.rejectSymlinkComponents(parent);
    const parentStat = await lstat(parent);
    if (!parentStat.isDirectory() || parentStat.isSymbolicLink())
      throw new Error("Agent Host socket parent is unsafe");
    const uid = process.getuid?.();
    if (uid !== undefined && parentStat.uid !== uid)
      throw new Error("Agent Host socket parent has a different owner");
    await chmod(parent, 0o700);
    await this.removeStaleSocket();
  }

  private async rejectSymlinkComponents(path: string): Promise<void> {
    const root = parse(path).root;
    const relative = path.slice(root.length).split("/").filter(Boolean);
    let current = root;
    for (const part of relative) {
      current = resolve(current, part);
      if ((await lstat(current)).isSymbolicLink())
        throw new Error("Agent Host socket path contains a symlink");
    }
  }

  private async removeStaleSocket(): Promise<void> {
    let socketStat;
    try {
      socketStat = await lstat(this.options.socketPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }
    if (socketStat.isSymbolicLink() || !socketStat.isSocket())
      throw new Error("Agent Host socket path is unsafe");
    if (await this.socketAcceptsConnections())
      throw Object.assign(new Error("Agent Host socket is already live"), {
        code: "EADDRINUSE",
      });
    const current = await lstat(this.options.socketPath);
    if (current.dev !== socketStat.dev || current.ino !== socketStat.ino)
      throw new Error("Agent Host socket changed during stale recovery");
    await unlink(this.options.socketPath);
  }

  private socketAcceptsConnections(): Promise<boolean> {
    return new Promise((resolveProbe, rejectProbe) => {
      const socket = connect(this.options.socketPath);
      const setTimer = this.options.setTimeout ?? globalThis.setTimeout;
      const clearTimer = this.options.clearTimeout ?? globalThis.clearTimeout;
      let settled = false;
      const settle = (live: boolean, error?: Error) => {
        if (settled) return;
        settled = true;
        clearTimer(timer);
        socket.destroy();
        if (error) rejectProbe(error);
        else resolveProbe(live);
      };
      const timeoutMs = this.positiveDeadline(
        this.options.livenessProbeTimeoutMs,
        250,
        "livenessProbeTimeoutMs",
      );
      const timer = setTimer(
        () => settle(false, new Error("Agent Host liveness probe timed out")),
        timeoutMs,
      );
      timer.unref?.();
      socket.once("connect", () => settle(true));
      socket.once("error", (error: NodeJS.ErrnoException) => {
        if (error.code === "ECONNREFUSED" || error.code === "ENOENT")
          settle(false);
        else settle(false, error);
      });
    });
  }

  private async unlinkOwnedSocket(): Promise<void> {
    const identity = this.socketIdentity;
    this.socketIdentity = undefined;
    if (!identity) return;
    try {
      const current = await lstat(this.options.socketPath);
      if (
        current.isSocket() &&
        !current.isSymbolicLink() &&
        current.dev === identity.dev &&
        current.ino === identity.ino
      )
        await unlink(this.options.socketPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }

  private positiveDeadline(
    configured: number | undefined,
    fallback: number,
    name: string,
  ): number {
    const value = configured ?? fallback;
    if (!Number.isFinite(value) || value <= 0)
      throw new Error(`${name} must be a positive finite number`);
    return value;
  }

  private accept(socket: Socket): void {
    const state: ConnectionState = {
      socket,
      handshake: false,
      closed: false,
      queue: Promise.resolve(),
    };
    const decoder = new BoundedNdjsonDecoder(
      this.options.maxFrameBytes ?? AGENT_HOST_MAX_FRAME_BYTES,
    );
    this.connections.add(state);
    socket.on("data", (chunk) => {
      try {
        for (const value of decoder.push(Buffer.from(chunk))) {
          state.queue = state.queue
            .then(() => this.receive(state, value))
            .catch(() => this.close(state));
        }
      } catch {
        this.close(state);
      }
    });
    socket.on("end", () => {
      try {
        decoder.finish();
      } catch {}
    });
    socket.on("error", () => this.close(state));
    socket.on("close", () => this.disconnected(state));
  }

  private async receive(
    connection: ConnectionState,
    value: unknown,
  ): Promise<void> {
    if (connection.closed) return;
    if (!connection.handshake) {
      const hello = decodeAgentHostHello(value);
      if (!hello) {
        if (
          record(value) &&
          nonempty(value.requestId) &&
          value.version !== AGENT_HOST_PROTOCOL_VERSION
        ) {
          this.send(connection, {
            t: "error",
            version: AGENT_HOST_PROTOCOL_VERSION,
            requestId: value.requestId,
            code: "unsupported_version",
            message: "Unsupported Agent Host protocol version",
          });
          connection.closed = true;
          connection.socket.end();
        } else {
          this.close(connection);
        }
        return;
      }
      connection.handshake = true;
      this.send(connection, { ...hello, accepted: true });
      return;
    }
    const message = decodeMessage(value);
    if (!message || message.t === "hello") {
      this.error(
        connection,
        record(value) && nonempty(value.requestId)
          ? value.requestId
          : "invalid",
        "invalid_request",
        "Invalid Agent Host request",
      );
      this.close(connection);
      return;
    }
    if (message.t === "start_turn") {
      this.startTurn(connection, message.requestId, message.spec);
      return;
    }
    const active = this.active;
    if (
      !active ||
      active.owner !== connection ||
      !sameFence(active.fence, message.fence)
    ) {
      this.error(
        connection,
        message.requestId,
        "stale_generation",
        "Request does not own the active turn",
        message.fence,
      );
      return;
    }
    try {
      switch (message.t) {
        case "steer":
          await active.driver.steer({
            steerId: message.steerId,
            text: message.text,
            images: message.images,
          });
          break;
        case "answer":
          if (!active.askIds.delete(message.askId))
            throw new Error("Unknown askId");
          await active.driver.answer(message.askId, message.result);
          break;
        case "cancel":
          await active.driver.cancel();
          break;
        case "transcript_ack":
          if (active.pendingAppendId !== message.appendId)
            throw new Error("Unknown appendId");
          active.pendingAppendId = undefined;
          await active.driver.transcriptAck(
            message.appendId,
            message.changeSeq,
          );
          break;
        case "shutdown":
          this.fence(active);
          this.invokeDriver(() => active.driver.cancel());
          this.invokeDriver(() => active.driver.shutdown());
          this.close(connection);
          void this.stop();
          break;
      }
    } catch (error) {
      this.error(
        connection,
        message.requestId,
        "invalid_request",
        error instanceof Error ? error.message : String(error),
        active.fence,
      );
    }
  }

  private startTurn(
    owner: ConnectionState,
    requestId: string,
    spec: AgentTurnSpec,
  ): void {
    if (this.active) {
      const code =
        sameLineage(this.active.fence, spec.fence) &&
        !sameFence(this.active.fence, spec.fence)
          ? "stale_generation"
          : "host_busy";
      this.error(
        owner,
        requestId,
        code,
        "Agent Host already owns a turn",
        spec.fence,
      );
      return;
    }
    let driver: AgentTurnDriver;
    try {
      driver = this.options.createDriver(spec);
    } catch (error) {
      this.error(
        owner,
        requestId,
        "turn_failed",
        error instanceof Error ? error.message : String(error),
        spec.fence,
      );
      return;
    }
    const active: ActiveTurn = {
      fence: { ...spec.fence },
      driver,
      owner,
      requestId,
      askIds: new Set(),
    };
    this.active = active;
    this.send(owner, {
      t: "turn_started",
      version: AGENT_HOST_PROTOCOL_VERSION,
      requestId,
      fence: active.fence,
    });
    void driver
      .run(spec, {
        event: (event) => this.emitFor(active, { t: "event", event }),
        proposeTranscript: (appendId, entries) => {
          if (!nonempty(appendId) || active.pendingAppendId)
            throw new Error(
              "Transcript proposal requires its prior acknowledgement",
            );
          if (
            Buffer.byteLength(JSON.stringify(entries)) >
            spec.transcriptPolicy.maxAppendBytes
          )
            throw new Error("Transcript proposal exceeds maxAppendBytes");
          if (
            !this.emitFor(active, {
              t: "transcript_proposal",
              appendId,
              entries,
            })
          )
            throw new Error("Transcript proposal owner is disconnected");
          active.pendingAppendId = appendId;
        },
        ask: (askId, input) => {
          if (!nonempty(askId) || active.askIds.has(askId))
            throw new Error("Invalid askId");
          if (!this.emitFor(active, { t: "ask", askId, input }))
            throw new Error("Ask owner is disconnected");
          active.askIds.add(askId);
        },
      })
      .then(
        (result) => this.finishTurn(active, result),
        (error) =>
          this.finishTurn(active, {
            status: "failed",
            error: error instanceof Error ? error.message : String(error),
          }),
      );
  }

  private finishTurn(active: ActiveTurn, result: AgentTurnResult): void {
    if (this.active !== active) return;
    this.fence(active);
    this.send(active.owner, {
      t: "turn_finished",
      version: AGENT_HOST_PROTOCOL_VERSION,
      requestId: active.requestId,
      fence: active.fence,
      ...result,
    });
  }

  private emitFor(active: ActiveTurn, message: DriverEmission): boolean {
    if (this.active !== active || active.owner.closed) return false;
    return this.send(active.owner, {
      ...message,
      version: AGENT_HOST_PROTOCOL_VERSION,
      requestId: active.requestId,
      fence: active.fence,
    } as AgentHostServerMessage);
  }

  private error(
    connection: ConnectionState,
    requestId: string,
    code: Extract<AgentHostServerMessage, { t: "error" }>["code"],
    message: string,
    fence?: AgentTurnFence,
  ): void {
    this.send(connection, {
      t: "error",
      version: AGENT_HOST_PROTOCOL_VERSION,
      requestId,
      code,
      message,
      fence,
    });
  }

  private send(
    connection: ConnectionState,
    message: AgentHostServerMessage,
  ): boolean {
    if (connection.closed || !connection.socket.writable) return false;
    try {
      connection.socket.write(
        encodeNdjsonFrame(message, this.options.maxFrameBytes),
      );
      return true;
    } catch {
      this.close(connection);
      return false;
    }
  }

  private close(connection: ConnectionState): void {
    if (connection.closed) return;
    connection.closed = true;
    connection.socket.destroy();
  }

  private disconnected(connection: ConnectionState): void {
    connection.closed = true;
    this.connections.delete(connection);
    const active = this.active;
    if (active?.owner !== connection || active.abandonTimer) return;
    this.invokeDriver(() => active.driver.cancel());
    const setTimer = this.options.setTimeout ?? globalThis.setTimeout;
    active.abandonTimer = setTimer(
      () => this.fence(active),
      this.positiveDeadline(
        this.options.cancellationDeadlineMs,
        5_000,
        "cancellationDeadlineMs",
      ),
    );
    active.abandonTimer.unref?.();
  }

  private invokeDriver(action: () => void | Promise<void>): void {
    try {
      void Promise.resolve(action()).catch(() => undefined);
    } catch {}
  }

  private fence(active: ActiveTurn): void {
    if (active.abandonTimer) {
      const clearTimer = this.options.clearTimeout ?? globalThis.clearTimeout;
      clearTimer(active.abandonTimer);
      active.abandonTimer = undefined;
    }
    if (this.active === active) this.active = undefined;
  }
}

export function createAgentHost(options: AgentHostOptions): AgentHost {
  return new AgentHost(options);
}
