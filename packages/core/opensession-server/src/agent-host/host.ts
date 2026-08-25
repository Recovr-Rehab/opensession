import {
  chmod,
  lstat,
  mkdir,
  readFile,
  rename,
  rm,
  unlink,
  writeFile,
} from "node:fs/promises";
import { dirname, isAbsolute, join, parse, resolve } from "node:path";
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
  cancelling: boolean;
  cancelSettled: boolean;
  runSettled: boolean;
  result?: AgentTurnResult;
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
  private claimOwned = false;
  private poisoned = false;
  private readonly highWaterGenerations = new Map<string, number>();
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
    if (this.poisoned)
      throw new Error("Agent Host requires process replacement");
    await this.prepareSocketParent();
    await this.acquireClaim();
    try {
      await this.removeStaleSocketWhileClaimed();
      const server = createServer((socket) => this.accept(socket));
      this.server = server;
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
    } catch (error) {
      const server = this.server;
      this.server = undefined;
      if (server?.listening)
        await new Promise<void>((resolveClose) =>
          server.close(() => resolveClose()),
        );
      await this.unlinkOwnedSocket();
      await this.releaseClaim();
      throw error;
    }
  }

  private async stopInternal(): Promise<void> {
    await this.starting?.catch(() => undefined);
    const server = this.server;
    this.server = undefined;
    const active = this.active;
    if (active) {
      this.poisoned = true;
      this.beginCancellation(active);
      this.clearAbandonTimer(active);
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
    if (!active) await this.releaseClaim();
  }

  private async prepareSocketParent(): Promise<void> {
    const socketPath = this.options.socketPath;
    if (!isAbsolute(socketPath) || resolve(socketPath) !== socketPath)
      throw new Error("Agent Host socket path must be absolute and normalized");
    const parent = dirname(socketPath);
    const root = parse(parent).root;
    if (parent === root)
      throw new Error(
        "Agent Host socket parent must not be the filesystem root",
      );
    let current = root;
    for (const part of parent.slice(root.length).split("/").filter(Boolean)) {
      current = resolve(current, part);
      try {
        const currentStat = await lstat(current);
        if (!currentStat.isDirectory() || currentStat.isSymbolicLink())
          throw new Error(
            "Agent Host socket path contains an unsafe component",
          );
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        await mkdir(current, { mode: 0o700 });
        const created = await lstat(current);
        if (!created.isDirectory() || created.isSymbolicLink())
          throw new Error("Agent Host socket parent creation raced a symlink");
      }
    }
    const parentStat = await lstat(parent);
    const uid = process.getuid?.();
    if (uid !== undefined && parentStat.uid !== uid)
      throw new Error("Agent Host socket parent has a different owner");
    await chmod(parent, 0o700);
  }

  private get claimPath(): string {
    return `${this.options.socketPath}.claim`;
  }

  private async acquireClaim(): Promise<void> {
    for (;;) {
      try {
        await mkdir(this.claimPath, { mode: 0o700 });
        this.claimOwned = true;
        await writeFile(join(this.claimPath, "owner"), String(process.pid), {
          flag: "wx",
          mode: 0o600,
        });
        return;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
          if (this.claimOwned) await this.releaseClaim();
          throw error;
        }
      }
      const claimStat = await lstat(this.claimPath);
      if (!claimStat.isDirectory() || claimStat.isSymbolicLink())
        throw new Error("Agent Host claim path is unsafe");
      const owner = Number(
        await readFile(join(this.claimPath, "owner"), "utf8"),
      );
      if (!Number.isSafeInteger(owner) || owner < 1)
        throw new Error("Agent Host claim owner is invalid");
      try {
        process.kill(owner, 0);
        throw Object.assign(new Error("Agent Host socket is already claimed"), {
          code: "EADDRINUSE",
        });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
      }
      const quarantine = `${this.claimPath}.stale-${crypto.randomUUID()}`;
      try {
        await rename(this.claimPath, quarantine);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
        throw error;
      }
      await rm(quarantine, { recursive: true, force: true });
    }
  }

  private async removeStaleSocketWhileClaimed(): Promise<void> {
    if (!this.claimOwned) throw new Error("Agent Host socket is not claimed");
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
    const stalePath = `${this.options.socketPath}.stale-${crypto.randomUUID()}`;
    await rename(this.options.socketPath, stalePath);
    await unlink(stalePath);
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
    if (!identity || !this.claimOwned) return;
    try {
      const current = await lstat(this.options.socketPath);
      if (
        !current.isSocket() ||
        current.isSymbolicLink() ||
        current.dev !== identity.dev ||
        current.ino !== identity.ino
      )
        return;
      const cleanupPath = `${this.options.socketPath}.cleanup-${crypto.randomUUID()}`;
      await rename(this.options.socketPath, cleanupPath);
      await unlink(cleanupPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }

  private async releaseClaim(): Promise<void> {
    if (!this.claimOwned) return;
    this.claimOwned = false;
    await rm(this.claimPath, { recursive: true, force: false });
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
          this.beginCancellation(active);
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
          this.beginCancellation(active);
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
    if (this.poisoned) {
      this.error(
        owner,
        requestId,
        "host_busy",
        "Agent Host requires process replacement",
        spec.fence,
      );
      return;
    }
    const lineage = this.lineageKey(spec.fence);
    const highWater = this.highWaterGenerations.get(lineage);
    if (highWater !== undefined && spec.fence.generation <= highWater) {
      this.error(
        owner,
        requestId,
        "stale_generation",
        "Agent Host generation was already observed",
        spec.fence,
      );
      return;
    }
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
      cancelling: false,
      cancelSettled: false,
      runSettled: false,
    };
    this.active = active;
    this.highWaterGenerations.set(lineage, spec.fence.generation);
    this.send(owner, {
      t: "turn_started",
      version: AGENT_HOST_PROTOCOL_VERSION,
      requestId,
      fence: active.fence,
    });
    let run: Promise<AgentTurnResult>;
    try {
      run = Promise.resolve(
        driver.run(spec, {
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
        }),
      );
    } catch (error) {
      run = Promise.reject(error);
    }
    void run.then(
      (result) => this.finishTurn(active, result),
      (error) =>
        this.finishTurn(active, {
          status: "failed",
          error: error instanceof Error ? error.message : String(error),
        }),
    );
  }

  private finishTurn(active: ActiveTurn, result: AgentTurnResult): void {
    active.runSettled = true;
    active.result = result;
    this.completeIfDrained(active);
  }

  private emitFor(active: ActiveTurn, message: DriverEmission): boolean {
    if (this.active !== active || active.cancelling || active.owner.closed)
      return false;
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
    if (active?.owner === connection) this.beginCancellation(active);
  }

  private beginCancellation(active: ActiveTurn): void {
    if (this.active !== active || active.cancelling) return;
    active.cancelling = true;
    const setTimer = this.options.setTimeout ?? globalThis.setTimeout;
    active.abandonTimer = setTimer(
      () => {
        if (
          this.active === active &&
          (!active.runSettled || !active.cancelSettled)
        )
          this.poisoned = true;
      },
      this.positiveDeadline(
        this.options.cancellationDeadlineMs,
        5_000,
        "cancellationDeadlineMs",
      ),
    );
    active.abandonTimer.unref?.();
    let cancel: Promise<void>;
    try {
      cancel = Promise.resolve(active.driver.cancel());
    } catch (error) {
      cancel = Promise.reject(error);
    }
    void cancel.then(
      () => {
        active.cancelSettled = true;
        this.completeIfDrained(active);
      },
      () => {
        active.cancelSettled = true;
        this.completeIfDrained(active);
      },
    );
  }

  private completeIfDrained(active: ActiveTurn): void {
    if (this.active !== active || !active.runSettled) return;
    if (active.cancelling && !active.cancelSettled) return;
    this.clearAbandonTimer(active);
    this.active = undefined;
    if (active.result)
      this.send(active.owner, {
        t: "turn_finished",
        version: AGENT_HOST_PROTOCOL_VERSION,
        requestId: active.requestId,
        fence: active.fence,
        ...active.result,
      });
  }

  private clearAbandonTimer(active: ActiveTurn): void {
    if (!active.abandonTimer) return;
    const clearTimer = this.options.clearTimeout ?? globalThis.clearTimeout;
    clearTimer(active.abandonTimer);
    active.abandonTimer = undefined;
  }

  private invokeDriver(action: () => void | Promise<void>): void {
    try {
      void Promise.resolve(action()).catch(() => undefined);
    } catch {}
  }

  private lineageKey(fence: AgentTurnFence): string {
    return `${fence.sessionId}\0${fence.runId}\0${fence.turnId}`;
  }
}

export function createAgentHost(options: AgentHostOptions): AgentHost {
  return new AgentHost(options);
}
