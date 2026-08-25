import {
  EXECUTOR_PROTOCOL_VERSION,
  MAX_EXECUTOR_STREAM_EVENT_BYTES,
  decodeExecutorHello,
  decodeExecutorId,
  decodeExecutorServerMessage,
  isExecutorOutcomeCompatible,
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
  helloTimeoutMs?: number;
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
  streamIds: Set<string>;
  timeout: ReturnType<typeof setTimeout>;
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
  #helloTimeout: ReturnType<typeof setTimeout>;
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
    this.#helloTimeout = setTimeout(() => {
      if (!this.#connected) return;
      void options.transport.close?.("executor hello timed out");
      this.disconnect("executor hello timed out");
    }, options.helloTimeoutMs ?? 10_000);
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
    if (!decodeExecutorId(requestId))
      throw new ExecutorFailure("invalid_request", "request ID is malformed");
    if (this.#pending.has(requestId))
      throw new ExecutorFailure("conflict", "request is already pending");
    const grant =
      typeof this.#options.grant === "function"
        ? await this.#options.grant(context, operation)
        : this.#options.grant;
    const deadlineMs =
      this.#options.deadlineMs?.(context) ?? Date.now() + 30_000;
    return new Promise<ExecutorSuccess>((resolve, reject) => {
      const timeout = setTimeout(
        () => {
          const pending = this.#pending.get(requestId);
          if (!pending) return;
          this.#pending.delete(requestId);
          void this.#cleanupStreams(requestId, pending);
          pending.reject(
            new ExecutorFailure(
              "deadline_exceeded",
              "remote executor did not produce a result before the deadline",
              isMutation(operation) && pending.accepted,
            ),
          );
        },
        Math.min(2_147_483_647, Math.max(0, deadlineMs - Date.now())),
      );
      this.#pending.set(requestId, {
        operation,
        context,
        grant,
        deadlineMs,
        accepted: false,
        events: [],
        streamIds: new Set(),
        timeout,
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
        clearTimeout(pending.timeout);
        void this.#cleanupStreams(requestId, pending);
        pending.reject(disconnectedFailure(operation, pending.accepted, cause));
      });
    });
  }

  disconnect(reason?: unknown): void {
    if (!this.#connected) return;
    this.#connected = false;
    clearTimeout(this.#helloTimeout);
    this.#rejectReady(
      new Error(
        reason === undefined
          ? "remote executor disconnected before hello"
          : String(reason),
      ),
    );
    for (const off of this.#off.splice(0)) off();
    void this.#options.transport.close?.("remote executor disconnected");
    for (const pending of this.#pending.values()) {
      clearTimeout(pending.timeout);
      pending.reject(
        disconnectedFailure(pending.operation, pending.accepted, reason),
      );
    }
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
      clearTimeout(this.#helloTimeout);
      this.#resolveReady();
      return;
    }
    const message = decodeExecutorServerMessage(value);
    if (!message || containsForbiddenField(message))
      return this.disconnect("malformed executor frame");
    const pending = this.#pending.get(message.requestId);
    if (!pending) return;
    if (message.t === "receipt") {
      if (
        !validReceiptProgression(
          pending,
          message.requestId,
          message.receipt,
          true,
        ) ||
        (message.receipt.state !== "queued" &&
          message.receipt.state !== "running")
      )
        return this.disconnect("receipt identity mismatch");
      pending.accepted = true;
      pending.receipt = message.receipt;
      return;
    }
    if (message.t === "error") {
      if (
        message.receipt &&
        !validReceiptProgression(
          pending,
          message.requestId,
          message.receipt,
          pending.receipt === undefined,
        )
      )
        return this.disconnect("error receipt identity mismatch");
      if (message.receipt) {
        pending.accepted = true;
        pending.receipt = message.receipt;
      }
      this.#pending.delete(message.requestId);
      clearTimeout(pending.timeout);
      void this.#cleanupStreams(message.requestId, pending);
      pending.reject(
        new ExecutorFailure(
          message.code === "unsupported_version"
            ? "invalid_request"
            : message.code,
          message.message,
          isMutation(pending.operation) && pending.accepted,
        ),
      );
      return;
    }
    if (message.t === "event") {
      const previous = pending.events
        .filter((event) => event.streamId === message.event.streamId)
        .at(-1);
      if (previous && message.event.sequence !== previous.sequence + 1)
        return this.disconnect("event sequence mismatch");
      pending.events.push(message.event);
      pending.streamIds.add(message.event.streamId);
      const bytes = eventBytes(message.event);
      if (bytes > 0)
        await this.#credit(message.requestId, message.event.streamId, bytes);
      return;
    }
    if (message.t === "receipt_status") {
      if (
        !validReceiptProgression(
          pending,
          message.requestId,
          message.receipt,
          false,
        )
      )
        return this.disconnect("receipt status identity mismatch");
      pending.accepted = true;
      pending.receipt = message.receipt;
      if (
        message.receipt.state === "failed" ||
        message.receipt.state === "cancelled"
      ) {
        this.#pending.delete(message.requestId);
        clearTimeout(pending.timeout);
        void this.#cleanupStreams(message.requestId, pending);
        pending.reject(
          new ExecutorFailure(
            message.error!.code === "unsupported_version"
              ? "invalid_request"
              : message.error!.code,
            message.error!.message,
            isMutation(pending.operation),
          ),
        );
        return;
      }
      if (!message.outcome) return;
      if (!isExecutorOutcomeCompatible(pending.operation, message.outcome))
        return this.disconnect("outcome is incompatible with operation");
      pending.outcome = message.outcome;
      const streamId =
        "streamId" in message.outcome ? message.outcome.streamId : undefined;
      if (pending.events.some((event) => event.streamId !== streamId))
        return this.disconnect("event stream mismatch");
      if (streamId) pending.streamIds.add(streamId);
      if (streamId && !message.eventsComplete)
        await this.#credit(message.requestId, streamId);
      if (message.eventsComplete || !streamId)
        this.#finish(message.requestId, pending);
    }
  }

  #finish(requestId: string, pending: Pending): void {
    if (!pending.outcome) return;
    this.#pending.delete(requestId);
    clearTimeout(pending.timeout);
    pending.resolve({
      outcome: pending.outcome,
      ...(pending.events.length ? { events: pending.events } : {}),
    });
  }

  async #credit(
    requestId: string,
    streamId: string,
    bytes = Math.max(
      this.#options.initialStreamCreditBytes ?? 4 * 1024 * 1024,
      MAX_EXECUTOR_STREAM_EVENT_BYTES,
    ),
  ): Promise<void> {
    const pending = this.#pending.get(requestId);
    if (!pending) return;
    await this.#options.transport.send({
      t: "stream_credit",
      version: EXECUTOR_PROTOCOL_VERSION,
      requestId,
      grant: pending.grant,
      fence: {
        rootId: pending.context.rootId,
        sessionId: pending.context.sessionId,
        runId: pending.context.runId,
        generation: pending.context.generation,
        deadlineMs: Date.now() + 30_000,
      },
      streamId,
      bytes,
    } satisfies ExecutorClientMessage);
  }

  async #cleanupStreams(requestId: string, pending: Pending): Promise<void> {
    for (const streamId of pending.streamIds) {
      try {
        await this.#options.transport.send({
          t: "cancel",
          version: EXECUTOR_PROTOCOL_VERSION,
          requestId: this.#id(),
          grant: pending.grant,
          fence: {
            rootId: pending.context.rootId,
            sessionId: pending.context.sessionId,
            runId: pending.context.runId,
            generation: pending.context.generation,
            deadlineMs: Date.now() + 30_000,
          },
          target: { requestId, streamId },
          idempotencyKey: `cleanup:${this.#id()}`,
        } satisfies ExecutorClientMessage);
      } catch {
        // The peer's close handler clears all queues when transport is gone.
      }
    }
    pending.streamIds.clear();
  }

  #id(): string {
    return this.#options.createId?.() ?? crypto.randomUUID();
  }
}

function validReceiptProgression(
  pending: Pending,
  wireRequestId: string,
  receipt: ExecutorReceipt,
  requireCurrentRequest: boolean,
): boolean {
  const expectedKey = isMutation(pending.operation)
    ? pending.operation.idempotencyKey
    : undefined;
  if (
    receipt.idempotencyKey !== expectedKey ||
    ((requireCurrentRequest || expectedKey === undefined) &&
      receipt.requestId !== wireRequestId)
  )
    return false;
  const previous = pending.receipt;
  if (!previous) return true;
  const rank = { queued: 0, running: 1, succeeded: 2, failed: 2, cancelled: 2 };
  return (
    receipt.receiptId === previous.receiptId &&
    receipt.requestId === previous.requestId &&
    receipt.idempotencyKey === previous.idempotencyKey &&
    receipt.acceptedAt === previous.acceptedAt &&
    rank[receipt.state] >= rank[previous.state] &&
    !(rank[previous.state] === 2 && receipt.state !== previous.state)
  );
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
function eventBytes(event: ExecutorStreamEvent): number {
  return event.kind === "text"
    ? new TextEncoder().encode(event.data).byteLength
    : event.kind === "binary"
      ? event.metadata.byteLength
      : 0;
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
