import {
  EXECUTOR_PROTOCOL_VERSION,
  decodeExecutorHello,
  type ExecutorCapability,
  type ExecutorClientMessage,
  type ExecutorConnectionIdentity,
  type ExecutorGrant,
  type ExecutorOperation,
  type ExecutorReceipt,
  type ExecutorServerMessage,
  type ExecutorStreamEvent,
} from "@tellahq/opensession-protocol/executor";
import type { DuplexJsonTransport } from "../../runner-executor/agent";
import {
  ExecutorFailure,
  isMutation,
  type Executor,
  type ExecutorContext,
  type ExecutorSuccess,
} from "./contract";

export interface RemoteExecutorConnectionOptions extends ExecutorConnectionIdentity {
  transport: DuplexJsonTransport;
  grant:
    | ExecutorGrant
    | ((
        context: ExecutorContext,
        operation: ExecutorOperation,
      ) => ExecutorGrant | Promise<ExecutorGrant>);
  deadlineMs?: (context: ExecutorContext) => number;
  maxPending?: number;
  initialStreamCreditBytes?: number;
  createId?: () => string;
}

interface Pending {
  operation: ExecutorOperation;
  context: ExecutorContext;
  grant: ExecutorGrant;
  deadlineMs: number;
  accepted: boolean;
  receipt?: ExecutorReceipt;
  outcome?: ExecutorSuccess["outcome"];
  events: ExecutorStreamEvent[];
  resolve: (result: ExecutorSuccess) => void;
  reject: (error: ExecutorFailure) => void;
}

/** One authenticated, connected remote Executor incarnation. */
export class RemoteExecutorConnection implements Executor {
  readonly identity: ExecutorConnectionIdentity;
  readonly #options: RemoteExecutorConnectionOptions;
  readonly #pending = new Map<string, Pending>();
  readonly #ready: Promise<void>;
  #resolveReady!: () => void;
  #rejectReady!: (error: Error) => void;
  #connected = true;
  #off: Array<() => void>;

  constructor(options: RemoteExecutorConnectionOptions) {
    this.#options = options;
    this.identity = {
      executorId: options.executorId,
      instanceId: options.instanceId,
      generation: options.generation,
      capabilities: [...options.capabilities],
    };
    this.#ready = new Promise((resolve, reject) => {
      this.#resolveReady = resolve;
      this.#rejectReady = reject;
    });
    void this.#ready.catch(() => {});
    this.#off = [
      options.transport.onMessage((message) => this.#receive(message)),
      options.transport.onClose((reason) => this.disconnect(reason)),
    ];
  }

  get connected(): boolean {
    return this.#connected;
  }
  get pendingCount(): number {
    return this.#pending.size;
  }
  ready(): Promise<void> {
    return this.#ready;
  }

  async execute(
    context: ExecutorContext,
    operation: ExecutorOperation,
  ): Promise<ExecutorSuccess> {
    await this.#ready;
    if (containsForbiddenField(operation))
      throw new ExecutorFailure(
        "invalid_request",
        "operation contains a forbidden field",
      );
    if (!this.#connected) throw disconnectedFailure(operation, false);
    if (context.generation !== this.identity.generation)
      throw new ExecutorFailure(
        "stale_generation",
        "executor generation does not match",
      );
    if (
      !this.identity.capabilities.includes(
        operation.kind.split(".")[0] as ExecutorCapability,
      )
    )
      throw new ExecutorFailure(
        "unsupported",
        "executor did not declare this capability",
      );
    if (this.#pending.size >= (this.#options.maxPending ?? 128))
      throw new ExecutorFailure(
        "executor_busy",
        "remote executor pending request limit reached",
      );
    const requestId = context.requestId || this.#id();
    if (this.#pending.has(requestId))
      throw new ExecutorFailure("conflict", "request is already pending");
    const grant =
      typeof this.#options.grant === "function"
        ? await this.#options.grant(context, operation)
        : this.#options.grant;
    const deadlineMs =
      this.#options.deadlineMs?.(context) ?? Date.now() + 30_000;
    return new Promise<ExecutorSuccess>((resolve, reject) => {
      this.#pending.set(requestId, {
        operation,
        context,
        grant,
        deadlineMs,
        accepted: false,
        events: [],
        resolve,
        reject,
      });
      void Promise.resolve(
        this.#options.transport.send({
          t: "execute",
          version: EXECUTOR_PROTOCOL_VERSION,
          requestId,
          grant,
          fence: {
            rootId: context.rootId,
            sessionId: context.sessionId,
            runId: context.runId,
            generation: context.generation,
            deadlineMs,
          },
          operation,
        } satisfies ExecutorClientMessage),
      ).catch((cause) => {
        const pending = this.#pending.get(requestId);
        if (!pending) return;
        this.#pending.delete(requestId);
        pending.reject(disconnectedFailure(operation, pending.accepted, cause));
      });
    });
  }

  disconnect(reason?: unknown): void {
    if (!this.#connected) return;
    this.#connected = false;
    this.#rejectReady(new Error("remote executor disconnected before hello"));
    for (const off of this.#off.splice(0)) off();
    for (const pending of this.#pending.values())
      pending.reject(
        disconnectedFailure(pending.operation, pending.accepted, reason),
      );
    this.#pending.clear();
  }

  async #receive(value: unknown): Promise<void> {
    if (!this.#connected) return;
    const hello = decodeExecutorHello(value);
    if (hello) {
      if (!sameIdentity(hello, this.identity))
        return this.disconnect("executor hello identity mismatch");
      await this.#options.transport.send({
        ...hello,
        accepted: true,
      } satisfies ExecutorServerMessage);
      this.#resolveReady();
      return;
    }
    if (!isServerMessage(value))
      return this.disconnect("malformed executor frame");
    const pending = this.#pending.get(value.requestId);
    if (!pending) return;
    if (value.t === "receipt") {
      pending.accepted = true;
      pending.receipt = value.receipt;
      return;
    }
    if (value.t === "error") {
      this.#pending.delete(value.requestId);
      pending.reject(
        new ExecutorFailure(
          value.code === "unsupported_version" ? "invalid_request" : value.code,
          value.message,
          isMutation(pending.operation) && pending.accepted,
        ),
      );
      return;
    }
    if (value.t === "event") {
      pending.events.push(value.event);
      if (pending.outcome && "eof" in value.event && value.event.eof)
        this.#finish(value.requestId, pending);
      return;
    }
    if (value.t === "receipt_status" && value.outcome) {
      pending.outcome = value.outcome;
      const streamId =
        "streamId" in value.outcome ? value.outcome.streamId : undefined;
      if (value.outcome.kind === "fs.read" && streamId) {
        await this.#credit(value.requestId, streamId);
      } else {
        this.#finish(value.requestId, pending);
      }
    }
  }

  #finish(requestId: string, pending: Pending): void {
    if (!pending.outcome) return;
    this.#pending.delete(requestId);
    pending.resolve({
      outcome: pending.outcome,
      ...(pending.events.length ? { events: pending.events } : {}),
    });
  }

  async #credit(requestId: string, streamId: string): Promise<void> {
    const pending = this.#pending.get(requestId);
    if (!pending) return;
    await this.#options.transport.send({
      t: "stream_credit",
      version: EXECUTOR_PROTOCOL_VERSION,
      requestId: `${requestId}:credit`,
      grant: pending.grant,
      fence: {
        rootId: pending.context.rootId,
        sessionId: pending.context.sessionId,
        runId: pending.context.runId,
        generation: pending.context.generation,
        deadlineMs: pending.deadlineMs,
      },
      streamId,
      bytes: this.#options.initialStreamCreditBytes ?? 4 * 1024 * 1024,
    } satisfies ExecutorClientMessage);
  }

  #id(): string {
    return this.#options.createId?.() ?? crypto.randomUUID();
  }
}

function sameIdentity(
  left: ExecutorConnectionIdentity,
  right: ExecutorConnectionIdentity,
): boolean {
  return (
    left.executorId === right.executorId &&
    left.instanceId === right.instanceId &&
    left.generation === right.generation &&
    left.capabilities.join("\0") === right.capabilities.join("\0")
  );
}
function disconnectedFailure(
  operation: ExecutorOperation,
  accepted: boolean,
  cause?: unknown,
): ExecutorFailure {
  const mutationAmbiguous = isMutation(operation) && accepted;
  return new ExecutorFailure(
    "operation_failed",
    mutationAmbiguous
      ? "remote executor disconnected after accepting mutation"
      : "remote executor disconnected before a certain result",
    mutationAmbiguous,
  );
}
function isServerMessage(
  value: unknown,
): value is Exclude<ExecutorServerMessage, { t: "hello" }> {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    containsForbiddenField(value)
  )
    return false;
  const message = value as Record<string, unknown>;
  if (
    message.version !== EXECUTOR_PROTOCOL_VERSION ||
    typeof message.requestId !== "string"
  )
    return false;
  const common = ["t", "version", "requestId"];
  const hasOnly = (extras: string[]) =>
    Object.keys(message).every(
      (key) => common.includes(key) || extras.includes(key),
    );
  if (message.t === "receipt")
    return (
      hasOnly(["receipt"]) &&
      !!message.receipt &&
      typeof message.receipt === "object"
    );
  if (message.t === "receipt_status")
    return (
      hasOnly(["receipt", "outcome"]) &&
      !!message.receipt &&
      typeof message.receipt === "object"
    );
  if (message.t === "event")
    return (
      hasOnly(["event"]) && !!message.event && typeof message.event === "object"
    );
  return (
    message.t === "error" &&
    hasOnly(["code", "message", "receipt"]) &&
    typeof message.code === "string" &&
    typeof message.message === "string"
  );
}

const FORBIDDEN_FIELDS = new Set([
  "prompt",
  "model",
  "models",
  "account",
  "accountId",
  "mcp",
  "transcript",
  "credential",
  "credentials",
  "secret",
  "accessToken",
  "apiKey",
  "authorization",
  "env",
  "enrollmentToken",
]);
function containsForbiddenField(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsForbiddenField);
  if (!value || typeof value !== "object") return false;
  return Object.entries(value).some(
    ([key, nested]) =>
      FORBIDDEN_FIELDS.has(key) || containsForbiddenField(nested),
  );
}
