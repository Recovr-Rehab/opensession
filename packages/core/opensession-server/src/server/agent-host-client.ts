import { connect, type Socket } from "node:net";
import {
  AGENT_HOST_PROTOCOL_VERSION,
  isAgentTurnFence,
  type AgentHostClientMessage,
  type AgentHostServerMessage,
  type AgentTurnFence,
  type AgentTurnSpec,
  type AskResult,
  type ImageInput,
} from "@tellahq/opensession-protocol";
import {
  AGENT_HOST_MAX_FRAME_BYTES,
  BoundedNdjsonDecoder,
  encodeNdjsonFrame,
} from "../agent-host/socket-framing";

export interface AgentHostClientOptions {
  socketPath: string;
  timeoutMs?: number;
  maxFrameBytes?: number;
  onMessage?: (
    message: Exclude<AgentHostServerMessage, { t: "hello" }>,
  ) => void;
}

interface PendingRequest {
  expected: AgentHostServerMessage["t"];
  resolve: () => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
const nonempty = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0;
const allowed = (value: Record<string, unknown>, keys: string[]) =>
  Object.keys(value).every((key) => keys.includes(key));

function sameFence(left: AgentTurnFence, right: AgentTurnFence): boolean {
  return (
    left.sessionId === right.sessionId &&
    left.runId === right.runId &&
    left.turnId === right.turnId &&
    left.generation === right.generation
  );
}

function decodeServerMessage(
  value: unknown,
): AgentHostServerMessage | undefined {
  if (
    !record(value) ||
    value.version !== AGENT_HOST_PROTOCOL_VERSION ||
    !nonempty(value.requestId) ||
    !nonempty(value.t)
  )
    return undefined;
  switch (value.t) {
    case "hello":
      return allowed(value, ["t", "version", "requestId", "accepted"]) &&
        value.accepted === true
        ? (value as unknown as AgentHostServerMessage)
        : undefined;
    case "error":
      return allowed(value, [
        "t",
        "version",
        "requestId",
        "code",
        "message",
        "fence",
      ]) &&
        [
          "unsupported_version",
          "invalid_request",
          "stale_generation",
          "host_busy",
          "turn_failed",
        ].includes(String(value.code)) &&
        typeof value.message === "string" &&
        (value.fence === undefined || isAgentTurnFence(value.fence))
        ? (value as unknown as AgentHostServerMessage)
        : undefined;
    case "turn_started":
      return allowed(value, ["t", "version", "requestId", "fence"]) &&
        isAgentTurnFence(value.fence)
        ? (value as unknown as AgentHostServerMessage)
        : undefined;
    case "event":
      return allowed(value, ["t", "version", "requestId", "fence", "event"]) &&
        isAgentTurnFence(value.fence) &&
        record(value.event)
        ? (value as unknown as AgentHostServerMessage)
        : undefined;
    case "transcript_proposal":
      return allowed(value, [
        "t",
        "version",
        "requestId",
        "fence",
        "appendId",
        "entries",
      ]) &&
        isAgentTurnFence(value.fence) &&
        nonempty(value.appendId) &&
        Array.isArray(value.entries)
        ? (value as unknown as AgentHostServerMessage)
        : undefined;
    case "ask":
      return allowed(value, [
        "t",
        "version",
        "requestId",
        "fence",
        "askId",
        "input",
      ]) &&
        isAgentTurnFence(value.fence) &&
        nonempty(value.askId) &&
        record(value.input)
        ? (value as unknown as AgentHostServerMessage)
        : undefined;
    case "turn_finished":
      return allowed(value, [
        "t",
        "version",
        "requestId",
        "fence",
        "status",
        "error",
      ]) &&
        isAgentTurnFence(value.fence) &&
        ["completed", "cancelled", "failed"].includes(String(value.status)) &&
        (value.error === undefined || typeof value.error === "string")
        ? (value as unknown as AgentHostServerMessage)
        : undefined;
    default:
      return undefined;
  }
}

export class AgentHostClient {
  private socket?: Socket;
  private connecting?: Promise<void>;
  private fence?: AgentTurnFence;
  private desynchronized = false;
  private readonly pending = new Map<string, PendingRequest>();
  private requestSequence = 0;

  constructor(private readonly options: AgentHostClientOptions) {}

  connect(): Promise<void> {
    if (this.socket && !this.socket.destroyed) {
      if (this.desynchronized)
        throw new Error("Agent Host client requires a fresh connection");
      return Promise.resolve();
    }
    if (this.connecting) return this.connecting;
    this.connecting = new Promise<void>((resolve, reject) => {
      const socket = connect(this.options.socketPath);
      const decoder = new BoundedNdjsonDecoder(
        this.options.maxFrameBytes ?? AGENT_HOST_MAX_FRAME_BYTES,
      );
      this.socket = socket;
      this.desynchronized = false;
      let settled = false;
      const failConnect = (error: Error) => {
        if (!settled) {
          settled = true;
          reject(error);
        }
        this.fail(error, socket);
      };
      socket.on("connect", () => {
        const requestId = this.nextRequestId();
        this.request(requestId, "hello", {
          t: "hello",
          version: AGENT_HOST_PROTOCOL_VERSION,
          requestId,
        }).then(() => {
          if (!settled && this.socket === socket) {
            settled = true;
            this.desynchronized = false;
            this.fence = undefined;
            resolve();
          }
        }, failConnect);
      });
      socket.on("data", (chunk) => {
        try {
          for (const value of decoder.push(Buffer.from(chunk)))
            this.receive(socket, value);
        } catch {
          socket.destroy(new Error("Malformed Agent Host frame"));
        }
      });
      socket.on("end", () => {
        try {
          decoder.finish();
        } catch {
          socket.destroy();
        }
      });
      socket.on("error", failConnect);
      socket.on("close", () =>
        failConnect(new Error("Agent Host disconnected")),
      );
    }).finally(() => {
      this.connecting = undefined;
    });
    return this.connecting;
  }

  async startTurn(spec: AgentTurnSpec): Promise<void> {
    if (!this.socket || this.socket.destroyed)
      throw new Error("Agent Host is not connected");
    if (this.fence) throw new Error("Agent Host client already owns a turn");
    const requestId = this.nextRequestId();
    this.fence = { ...spec.fence };
    try {
      await this.request(requestId, "turn_started", {
        t: "start_turn",
        version: AGENT_HOST_PROTOCOL_VERSION,
        requestId,
        spec,
      });
    } catch (error) {
      if (!this.desynchronized) this.fence = undefined;
      throw error;
    }
  }

  steer(text: string, steerId: string, images?: ImageInput[]): string {
    return this.sendFenced({ t: "steer", text, steerId, images });
  }

  answer(askId: string, result: AskResult): string {
    return this.sendFenced({ t: "answer", askId, result });
  }

  cancel(): string {
    return this.sendFenced({ t: "cancel" });
  }
  transcriptAck(appendId: string, changeSeq: number): string {
    return this.sendFenced({ t: "transcript_ack", appendId, changeSeq });
  }
  shutdown(): string {
    return this.sendFenced({ t: "shutdown" });
  }

  close(): void {
    const socket = this.socket;
    socket?.destroy();
    if (socket) this.fail(new Error("Agent Host client closed"), socket);
    this.socket = undefined;
    this.fence = undefined;
    this.desynchronized = false;
  }

  private sendFenced(message: Record<string, unknown>): string {
    if (!this.fence) throw new Error("Agent Host client has no active turn");
    const requestId = this.nextRequestId();
    this.write({
      ...message,
      version: AGENT_HOST_PROTOCOL_VERSION,
      requestId,
      fence: this.fence,
    } as AgentHostClientMessage);
    return requestId;
  }

  private request(
    requestId: string,
    expected: AgentHostServerMessage["t"],
    message: AgentHostClientMessage,
  ): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        const error = new Error(`Agent Host ${expected} timed out`);
        if (expected === "turn_started") this.desynchronize(error);
        reject(error);
      }, this.options.timeoutMs ?? 5_000);
      timer.unref?.();
      this.pending.set(requestId, { expected, resolve, reject, timer });
      try {
        this.write(message);
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(requestId);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  private write(message: AgentHostClientMessage): void {
    if (!this.socket || this.socket.destroyed || !this.socket.writable)
      throw new Error("Agent Host is disconnected");
    this.socket.write(encodeNdjsonFrame(message, this.options.maxFrameBytes));
  }

  private receive(socket: Socket, value: unknown): void {
    if (socket !== this.socket || this.desynchronized) return;
    const message = decodeServerMessage(value);
    if (!message) {
      this.socket?.destroy(new Error("Invalid Agent Host message"));
      return;
    }
    if (message.t !== "hello" && message.t !== "error") {
      if (!this.fence || !sameFence(this.fence, message.fence)) {
        this.socket?.destroy(new Error("Stale Agent Host fence"));
        return;
      }
    }
    const pending = this.pending.get(message.requestId);
    if (message.t === "error") {
      if (pending) {
        clearTimeout(pending.timer);
        this.pending.delete(message.requestId);
        pending.reject(new Error(`${message.code}: ${message.message}`));
      } else {
        this.options.onMessage?.(message);
      }
      return;
    }
    if (pending && pending.expected === message.t) {
      clearTimeout(pending.timer);
      this.pending.delete(message.requestId);
      pending.resolve();
    }
    if (message.t === "turn_finished") this.fence = undefined;
    if (message.t !== "hello" && message.t !== "turn_started")
      this.options.onMessage?.(message);
  }

  private desynchronize(error: Error): void {
    const socket = this.socket;
    if (!socket || this.desynchronized) return;
    this.desynchronized = true;
    if (this.fence && socket.writable) {
      const requestId = this.nextRequestId();
      try {
        socket.end(
          encodeNdjsonFrame(
            {
              t: "cancel",
              version: AGENT_HOST_PROTOCOL_VERSION,
              requestId,
              fence: this.fence,
            },
            this.options.maxFrameBytes,
          ),
        );
      } catch {
        socket.destroy();
      }
    } else {
      socket.destroy();
    }
    this.fail(error, socket, true);
  }

  private fail(error: Error, socket: Socket, preserveFence = false): void {
    if (socket !== this.socket) return;
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
    this.socket = undefined;
    if (!preserveFence) this.fence = undefined;
  }

  private nextRequestId(): string {
    this.requestSequence += 1;
    return `agent-host-${this.requestSequence}-${crypto.randomUUID()}`;
  }
}
