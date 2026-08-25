import {
  EXECUTOR_PROTOCOL_VERSION,
  decodeExecutorFence,
  decodeExecutorGrant,
  decodeExecutorId,
  decodeExecutorOperation,
  type ExecutorClientMessage,
  type ExecutorConnectionIdentity,
  type ExecutorErrorCode,
  type ExecutorFence,
  type ExecutorReceipt,
  type ExecutorServerMessage,
  type ExecutorStreamEvent,
} from "@tellahq/opensession-protocol/executor";
import {
  ExecutorFailure,
  isMutation,
  type Executor,
} from "../server/executors/contract";
import {
  LedgerFullError,
  operationDigest,
  type DurableCommandLedger,
  type LedgerRecord,
  type LedgerScope,
} from "./ledger";

export interface DuplexJsonTransport {
  send(message: unknown): void | Promise<void>;
  onMessage(handler: (message: unknown) => void | Promise<void>): () => void;
  onClose(handler: (reason?: unknown) => void): () => void;
  close?(reason?: string): void | Promise<void>;
}

export interface RunnerExecutorAgentOptions extends ExecutorConnectionIdentity {
  rootId: string;
  transport: DuplexJsonTransport;
  executor: Executor;
  ledger: DurableCommandLedger;
  now?: () => number;
  createId?: () => string;
  validateGrant: (
    grant: string,
    fence: ExecutorFence,
  ) => boolean | Promise<boolean>;
  maxQueuedEventBytes?: number;
}

/** Provider-neutral remote daemon core. Calling start is the only effectful entrypoint. */
export class RunnerExecutorAgent {
  readonly #options: RunnerExecutorAgentOptions;
  readonly #credits = new Map<string, number>();
  readonly #events = new Map<
    string,
    Array<{ requestId: string; event: ExecutorStreamEvent; bytes: number }>
  >();
  readonly #streamWaiters = new Map<string, Array<() => void>>();
  #queuedBytes = 0;
  #accepted = false;
  #stopped = false;
  #off: Array<() => void> = [];

  constructor(options: RunnerExecutorAgentOptions) {
    this.#options = options;
  }

  async start(): Promise<void> {
    if (this.#off.length) throw new Error("agent already started");
    // No frame may be accepted until inherited active claims are durably failed.
    await this.#options.ledger.recover();
    this.#off = [
      this.#options.transport.onMessage((message) => this.#receive(message)),
      this.#options.transport.onClose(() => this.stop()),
    ];
    await this.#send({
      t: "hello",
      version: EXECUTOR_PROTOCOL_VERSION,
      requestId: this.#id(),
      executorId: this.#options.executorId,
      instanceId: this.#options.instanceId,
      generation: this.#options.generation,
      capabilities: [...this.#options.capabilities],
    });
  }

  stop(): void {
    if (this.#stopped) return;
    this.#stopped = true;
    for (const off of this.#off.splice(0)) off();
    this.#credits.clear();
    this.#events.clear();
    this.#streamWaiters.clear();
    this.#queuedBytes = 0;
  }

  async #receive(value: unknown): Promise<void> {
    if (this.#stopped || !isObject(value)) return;
    if (value.t === "hello") {
      if (isAcceptedHello(value, this.#options)) this.#accepted = true;
      else await this.#options.transport.close?.("invalid hello acceptance");
      return;
    }
    if (!this.#accepted) {
      await this.#options.transport.close?.(
        "work received before hello acceptance",
      );
      return;
    }
    const message = decodeWorkMessage(
      value,
      this.#options.now?.() ?? Date.now(),
    );
    if (
      !message ||
      message.fence.generation !== this.#options.generation ||
      message.fence.rootId !== this.#options.rootId
    ) {
      await this.#error(
        value.requestId,
        "invalid_request",
        "invalid or stale executor frame",
      );
      return;
    }
    let grantAccepted = false;
    try {
      grantAccepted = await this.#options.validateGrant(
        message.grant as string,
        message.fence,
      );
    } catch {
      grantAccepted = false;
    }
    if (!grantAccepted) {
      await this.#error(
        message.requestId,
        "invalid_grant",
        "grant was rejected",
      );
      return;
    }
    switch (message.t) {
      case "execute":
        await this.#execute(message);
        break;
      case "receipt_status":
        await this.#query(message.requestId, message.receiptId, message.fence);
        break;
      case "cancel":
        await this.#cancel(message);
        break;
      case "stream_credit":
        await this.#credit(message.requestId, message.streamId, message.bytes);
        break;
    }
  }

  async #execute(
    message: Extract<ExecutorClientMessage, { t: "execute" }>,
  ): Promise<void> {
    const key = isMutation(message.operation)
      ? message.operation.idempotencyKey
      : undefined;
    const scope = this.#scope(message.fence);
    const receipt: ExecutorReceipt = {
      receiptId: this.#id(),
      requestId: message.requestId,
      state: "queued",
      acceptedAt: new Date(this.#options.now?.() ?? Date.now()).toISOString(),
      ...(key ? { idempotencyKey: key } : {}),
    };
    let claim;
    try {
      claim = await this.#options.ledger.claim(
        {
          ...scope,
          requestId: message.requestId,
          ...(key ? { idempotencyKey: key } : {}),
          operationDigest: operationDigest(message.operation),
          operation: message.operation,
        },
        receipt,
      );
    } catch (cause) {
      await this.#error(
        message.requestId,
        cause instanceof LedgerFullError ? "executor_busy" : "conflict",
        cause instanceof Error ? cause.message : String(cause),
      );
      return;
    }
    if (!claim.claimed) {
      await this.#replayState(message.requestId, claim.record);
      return;
    }
    await this.#send({
      t: "receipt",
      version: EXECUTOR_PROTOCOL_VERSION,
      requestId: message.requestId,
      receipt,
    });
    await this.#options.ledger.transition(scope, receipt.receiptId, "queued", {
      state: "running",
    });
    let result;
    try {
      result = await this.#options.executor.execute(
        {
          rootId: message.fence.rootId,
          sessionId: message.fence.sessionId,
          runId: message.fence.runId,
          generation: message.fence.generation,
          requestId: message.requestId,
        },
        message.operation,
      );
    } catch (cause) {
      const failure =
        cause instanceof ExecutorFailure
          ? cause
          : new ExecutorFailure(
              "operation_failed",
              cause instanceof Error ? cause.message : String(cause),
            );
      const failed = await this.#options.ledger.transition(
        scope,
        receipt.receiptId,
        "running",
        {
          state: "failed",
          completedAt: new Date(
            this.#options.now?.() ?? Date.now(),
          ).toISOString(),
          error: { code: failure.code, message: failure.message },
        },
      );
      await this.#error(
        message.requestId,
        wireCode(failure.code),
        failure.message,
        failed.receipt,
      );
      return;
    }
    const completedAt = new Date(
      this.#options.now?.() ?? Date.now(),
    ).toISOString();
    const completed = await this.#options.ledger.transition(
      scope,
      receipt.receiptId,
      "running",
      {
        state: "succeeded",
        completedAt,
        outcome: result.outcome,
        events: result.events,
      },
    );
    // Sending is deliberately outside the execute/commit catch. A transport
    // failure after this point must never rewrite a committed success.
    await this.#replayState(message.requestId, completed);
  }

  async #query(
    requestId: string,
    receiptId: string,
    fence: ExecutorFence,
  ): Promise<void> {
    const record = await this.#options.ledger.get(
      this.#scope(fence),
      receiptId,
    );
    if (!record)
      return this.#error(requestId, "not_found", "receipt was not found");
    await this.#replayState(requestId, record);
  }

  async #cancel(
    message: Extract<ExecutorClientMessage, { t: "cancel" }>,
  ): Promise<void> {
    if ("streamId" in message.target)
      this.#clearStream(message.target.streamId);
    const record =
      "receiptId" in message.target
        ? await this.#options.ledger.get(
            this.#scope(message.fence),
            message.target.receiptId,
          )
        : undefined;
    if (record) await this.#replayState(message.requestId, record);
    else
      await this.#error(
        message.requestId,
        "cancelled",
        "cancellation requested; the operation may continue until abort support is available",
      );
  }

  async #queueEvents(
    requestId: string,
    events: ExecutorStreamEvent[],
  ): Promise<boolean> {
    const max = this.#options.maxQueuedEventBytes ?? 4 * 1024 * 1024;
    const additions = events.map((event) => ({
      event,
      bytes: eventBytes(event),
    }));
    if (
      additions.reduce((total, item) => total + item.bytes, this.#queuedBytes) >
      max
    ) {
      await this.#error(
        requestId,
        "executor_busy",
        "stream event queue is full",
      );
      return false;
    }
    for (const { event, bytes } of additions) {
      const queue = this.#events.get(event.streamId) ?? [];
      queue.push({ requestId, event, bytes });
      this.#events.set(event.streamId, queue);
      this.#queuedBytes += bytes;
    }
    const streams = [...new Set(events.map((event) => event.streamId))];
    await Promise.all(
      streams.map(
        (streamId) =>
          new Promise<void>((resolve) => {
            const queue = this.#streamWaiters.get(streamId) ?? [];
            queue.push(resolve);
            this.#streamWaiters.set(streamId, queue);
            void this.#flush(streamId);
          }),
      ),
    );
    return true;
  }

  async #credit(
    requestId: string,
    streamId: string,
    bytes: number,
  ): Promise<void> {
    if (!Number.isSafeInteger(bytes) || bytes <= 0)
      return this.#error(
        requestId,
        "invalid_request",
        "credit must be positive",
      );
    this.#credits.set(
      streamId,
      Math.min(
        Number.MAX_SAFE_INTEGER,
        (this.#credits.get(streamId) ?? 0) + bytes,
      ),
    );
    await this.#flush(streamId);
  }

  async #flush(streamId: string): Promise<void> {
    const queue = this.#events.get(streamId);
    if (!queue) return;
    let credit = this.#credits.get(streamId) ?? 0;
    while (queue.length && queue[0]!.bytes <= credit) {
      const item = queue.shift()!;
      credit -= item.bytes;
      this.#queuedBytes -= item.bytes;
      await this.#send({
        t: "event",
        version: EXECUTOR_PROTOCOL_VERSION,
        requestId: item.requestId,
        event: item.event,
      });
    }
    this.#credits.set(streamId, credit);
    if (!queue.length) {
      this.#events.delete(streamId);
      this.#credits.delete(streamId);
      for (const resolve of this.#streamWaiters.get(streamId) ?? []) resolve();
      this.#streamWaiters.delete(streamId);
    }
  }

  #clearStream(streamId: string): void {
    for (const item of this.#events.get(streamId) ?? [])
      this.#queuedBytes -= item.bytes;
    this.#events.delete(streamId);
    this.#credits.delete(streamId);
    for (const resolve of this.#streamWaiters.get(streamId) ?? []) resolve();
    this.#streamWaiters.delete(streamId);
  }

  async #replayState(requestId: string, record: LedgerRecord): Promise<void> {
    await this.#send({
      t: "receipt_status",
      version: EXECUTOR_PROTOCOL_VERSION,
      requestId,
      receipt: record.receipt,
      ...(record.outcome ? { outcome: record.outcome } : {}),
      ...(record.error ? { error: record.error } : {}),
      ...(record.events?.length ? {} : { eventsComplete: true as const }),
    });
    if (record.events?.length) {
      if (!(await this.#queueEvents(requestId, record.events))) return;
      await this.#send({
        t: "receipt_status",
        version: EXECUTOR_PROTOCOL_VERSION,
        requestId,
        receipt: record.receipt,
        ...(record.outcome ? { outcome: record.outcome } : {}),
        ...(record.error ? { error: record.error } : {}),
        eventsComplete: true,
      });
    }
  }

  async #error(
    requestId: unknown,
    code: ExecutorErrorCode,
    message: string,
    receipt?: ExecutorReceipt,
  ): Promise<void> {
    await this.#send({
      t: "error",
      version: EXECUTOR_PROTOCOL_VERSION,
      requestId: decodeExecutorId(requestId) ?? "invalid",
      code,
      message,
      ...(receipt ? { receipt } : {}),
    });
  }

  async #send(
    message: ExecutorClientMessage | ExecutorServerMessage,
  ): Promise<void> {
    await this.#options.transport.send(message);
  }

  #scope(fence: ExecutorFence): LedgerScope {
    return {
      executorId: this.#options.executorId,
      rootId: fence.rootId,
      sessionId: fence.sessionId,
      runId: fence.runId,
      generation: fence.generation,
    };
  }

  #id(): string {
    return this.#options.createId?.() ?? crypto.randomUUID();
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
function isAcceptedHello(
  value: Record<string, unknown>,
  identity: ExecutorConnectionIdentity,
): boolean {
  const allowed = [
    "t",
    "version",
    "requestId",
    "accepted",
    "executorId",
    "instanceId",
    "generation",
    "capabilities",
  ];
  return (
    Object.keys(value).every((key) => allowed.includes(key)) &&
    value.t === "hello" &&
    value.accepted === true &&
    value.version === EXECUTOR_PROTOCOL_VERSION &&
    value.executorId === identity.executorId &&
    value.instanceId === identity.instanceId &&
    value.generation === identity.generation &&
    Array.isArray(value.capabilities) &&
    value.capabilities.join("\0") === identity.capabilities.join("\0")
  );
}
function decodeWorkMessage(
  value: Record<string, unknown>,
  now: number,
): Exclude<ExecutorClientMessage, { t: "hello" }> | undefined {
  if (containsForbiddenField(value)) return undefined;
  const common = ["t", "version", "requestId", "grant", "fence"];
  const extras: Record<string, string[]> = {
    execute: ["operation"],
    receipt_status: ["receiptId"],
    cancel: ["target", "idempotencyKey"],
    stream_credit: ["streamId", "bytes"],
  };
  const messageType = typeof value.t === "string" ? value.t : "";
  if (
    !extras[messageType] ||
    Object.keys(value).some(
      (key) => !common.includes(key) && !extras[messageType]!.includes(key),
    ) ||
    value.version !== EXECUTOR_PROTOCOL_VERSION ||
    !decodeExecutorId(value.requestId)
  )
    return undefined;
  const grant = decodeExecutorGrant(value.grant);
  const fence = decodeExecutorFence(value.fence, now);
  if (!grant || !fence) return undefined;
  if (value.t === "execute") {
    const operation = decodeExecutorOperation(value.operation);
    if (operation) {
      return { ...value, grant, fence, operation } as Exclude<
        ExecutorClientMessage,
        { t: "hello" }
      >;
    }
  }
  if (value.t === "receipt_status" && decodeExecutorId(value.receiptId))
    return { ...value, grant, fence } as Exclude<
      ExecutorClientMessage,
      { t: "hello" }
    >;
  if (
    value.t === "cancel" &&
    validCancelTarget(value.target) &&
    typeof value.idempotencyKey === "string"
  )
    return { ...value, grant, fence } as Exclude<
      ExecutorClientMessage,
      { t: "hello" }
    >;
  if (
    value.t === "stream_credit" &&
    decodeExecutorId(value.streamId) &&
    typeof value.bytes === "number"
  )
    return { ...value, grant, fence } as Exclude<
      ExecutorClientMessage,
      { t: "hello" }
    >;
  return undefined;
}
function validCancelTarget(value: unknown): boolean {
  if (!isObject(value) || Object.keys(value).length !== 1) return false;
  return ["requestId", "receiptId", "streamId"].some(
    (key) => decodeExecutorId(value[key]) !== undefined,
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
  if (!isObject(value)) return false;
  return Object.entries(value).some(
    ([key, nested]) =>
      FORBIDDEN_FIELDS.has(key) || containsForbiddenField(nested),
  );
}
function eventBytes(event: ExecutorStreamEvent): number {
  return event.kind === "text"
    ? new TextEncoder().encode(event.data).byteLength
    : event.kind === "binary"
      ? event.metadata.byteLength
      : 0;
}
function wireCode(code: ExecutorFailure["code"]): ExecutorErrorCode {
  return code === "unsupported" ? "operation_failed" : code;
}
