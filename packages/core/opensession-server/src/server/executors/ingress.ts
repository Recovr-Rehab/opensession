import {
  decodeExecutorHello,
  type ExecutorCapability,
  type ExecutorGrant,
  type ExecutorOperation,
} from "@tellahq/opensession-protocol/executor";
import type { ExecutorContext } from "./contract";
import type { RemoteExecutorConnection } from "./remote";
import {
  RemoteExecutorRegistrationError,
  type RemoteExecutorRegistry,
} from "./remote-registry";
import {
  ExecutorWebSocketTransport,
  type ExecutorWebSocket,
  type WebSocketTransportOptions,
} from "./websocket-transport";

export const EXECUTOR_CONNECT_PATH = "/executor/connect";
export const EXECUTOR_SOURCE_HEADER = "x-opensession-executor-source";
export const EXECUTOR_ID_HEADER = "x-opensession-executor-id";
export const EXECUTOR_GENERATION_HEADER = "x-opensession-executor-generation";

export type ExecutorSource = "runner" | "managed";
export interface ExecutorUpgradeData {
  source: ExecutorSource;
  executorId: string;
  generation: number;
  connectionId: string;
}

export interface ExecutorAuthority {
  executorId: string;
  generation: number;
  capabilities: readonly ExecutorCapability[];
  claimInstance: (claim: {
    executorId: string;
    generation: number;
    instanceId: string;
  }) => boolean | Promise<boolean>;
  resolveGrant: (
    context: ExecutorContext,
    operation: ExecutorOperation,
  ) => ExecutorGrant | Promise<ExecutorGrant>;
  resolveCleanupGrant?: (
    context: ExecutorContext,
    streamId: string,
  ) => ExecutorGrant | Promise<ExecutorGrant>;
}

export type ExecutorAuthenticationResult =
  { ok: true; authority: ExecutorAuthority } | { ok: false; status: 401 | 403 };

export interface ExecutorIngressOptions {
  authenticateRunner: (input: {
    runnerId: string;
    token: string;
    remoteAddress?: string;
  }) => ExecutorAuthenticationResult | Promise<ExecutorAuthenticationResult>;
  consumeManagedEnrollment: (
    token: string,
    fence: { executorId: string; generation: number },
  ) =>
    | { executorId: string; generation: number; expiresAtMs: number }
    | Promise<{ executorId: string; generation: number; expiresAtMs: number }>;
  authorizeManaged: (fence: {
    executorId: string;
    generation: number;
  }) => ExecutorAuthority | undefined | Promise<ExecutorAuthority | undefined>;
  registry: RemoteExecutorRegistry;
  createId: () => string;
  now: () => number;
  rateLimit: (input: {
    source: ExecutorSource;
    executorId: string;
    nowMs: number;
    remoteAddress?: string;
  }) => boolean | Promise<boolean>;
  connectionPolicy?: WebSocketTransportOptions & {
    helloTimeoutMs?: number;
    maxHeaders?: number;
    maxHeaderBytes?: number;
  };
  timers: {
    setTimeout: (callback: () => void, milliseconds: number) => unknown;
    clearTimeout: (timer: unknown) => void;
  };
}

export interface ExecutorUpgradeServer {
  upgrade(request: Request, options: { data: ExecutorUpgradeData }): boolean;
}

interface PendingUpgrade {
  data: ExecutorUpgradeData;
  authority: ExecutorAuthority;
}

interface SocketState {
  data: ExecutorUpgradeData;
  transport: ExecutorWebSocketTransport;
  phase: "hello" | "claiming" | "ready" | "closed";
  helloTimer: unknown;
  helloOff?: () => void;
  remote?: RemoteExecutorConnection;
}

type BunExecutorSocket = ExecutorWebSocket & { data: ExecutorUpgradeData };

/** Injected, inert Executor WebSocket ingress. Boot must explicitly wire its handlers. */
export class ExecutorIngress {
  readonly #options: ExecutorIngressOptions;
  readonly #pending = new Map<string, PendingUpgrade>();
  readonly #sockets = new Map<string, SocketState>();
  readonly #timers: ExecutorIngressOptions["timers"];
  #shuttingDown = false;

  constructor(options: ExecutorIngressOptions) {
    this.#options = options;
    this.#timers = options.timers;
  }

  async handleUpgrade(
    request: Request,
    server: ExecutorUpgradeServer,
    remoteAddress?: string,
  ): Promise<Response | undefined> {
    if (this.#shuttingDown)
      return response(403, "executor ingress is shutting down");
    const malformed = validateRequest(request, this.#options.connectionPolicy);
    if (malformed) return malformed;
    const source = request.headers.get(
      EXECUTOR_SOURCE_HEADER,
    ) as ExecutorSource;
    const executorId = request.headers.get(EXECUTOR_ID_HEADER)!;
    const generation = Number(request.headers.get(EXECUTOR_GENERATION_HEADER));
    if (
      !(await this.#options.rateLimit({
        source,
        executorId,
        nowMs: this.#options.now(),
        remoteAddress,
      }))
    )
      return response(429, "too many executor connection attempts");
    const token = bearer(request.headers.get("authorization"));
    if (!token) return response(401, "unauthorized");

    let authority: ExecutorAuthority | undefined;
    if (source === "runner") {
      const result = await this.#options.authenticateRunner({
        runnerId: executorId,
        token,
        remoteAddress,
      });
      if (!result.ok)
        return response(
          result.status,
          result.status === 401 ? "unauthorized" : "forbidden",
        );
      authority = result.authority;
    } else {
      let enrollment: {
        executorId: string;
        generation: number;
        expiresAtMs: number;
      };
      try {
        enrollment = await this.#options.consumeManagedEnrollment(token, {
          executorId,
          generation,
        });
      } catch {
        return response(401, "unauthorized");
      }
      // Consumption intentionally precedes all durable-state checks. Accepted grants burn once.
      if (enrollment.expiresAtMs <= this.#options.now())
        return response(401, "unauthorized");
      if (
        enrollment.executorId !== executorId ||
        enrollment.generation !== generation
      )
        return response(403, "executor enrollment does not match");
      authority = await this.#options.authorizeManaged({
        executorId,
        generation,
      });
      if (!authority) return response(403, "executor is not connectable");
    }
    if (
      authority.executorId !== executorId ||
      authority.generation !== generation
    )
      return response(403, "executor authorization does not match");

    const data: ExecutorUpgradeData = {
      source,
      executorId,
      generation,
      connectionId: this.#options.createId(),
    };
    this.#pending.set(data.connectionId, { data, authority });
    if (!server.upgrade(request, { data })) {
      this.#pending.delete(data.connectionId);
      return response(400, "executor upgrade failed");
    }
    return undefined;
  }

  readonly websocket = {
    open: (socket: BunExecutorSocket) => this.#open(socket),
    message: (
      socket: BunExecutorSocket,
      data: string | ArrayBuffer | ArrayBufferView,
    ) => this.#message(socket, data),
    close: (socket: BunExecutorSocket, code: number, reason: string) =>
      this.#close(socket, `${code}: ${reason}`),
  };

  shutdown(): void {
    if (this.#shuttingDown) return;
    this.#shuttingDown = true;
    this.#pending.clear();
    for (const state of [...this.#sockets.values()])
      state.transport.close("executor ingress shut down");
    this.#sockets.clear();
  }

  get size(): number {
    return this.#sockets.size;
  }

  #open(socket: BunExecutorSocket): void {
    const pending = this.#pending.get(socket.data.connectionId);
    if (
      this.#shuttingDown ||
      !pending ||
      !sameUpgradeData(pending.data, socket.data)
    ) {
      socket.close(1008, "executor upgrade is not authorized");
      return;
    }
    this.#pending.delete(socket.data.connectionId);
    const transport = new ExecutorWebSocketTransport(
      socket,
      this.#options.connectionPolicy,
    );
    const state: SocketState = {
      data: socket.data,
      transport,
      phase: "hello",
      helloTimer: this.#timers.setTimeout(
        () => transport.close("executor hello timed out"),
        this.#options.connectionPolicy?.helloTimeoutMs ?? 10_000,
      ),
    };
    this.#sockets.set(socket.data.connectionId, state);
    transport.onClose((reason) => this.#finish(state, reason));
    state.helloOff = transport.onMessage((message) =>
      this.#hello(state, pending.authority, message),
    );
  }

  #message(
    socket: BunExecutorSocket,
    data: string | ArrayBuffer | ArrayBufferView,
  ): void {
    this.#sockets.get(socket.data.connectionId)?.transport.receive(data);
  }

  #close(socket: BunExecutorSocket, reason?: unknown): void {
    this.#sockets.get(socket.data.connectionId)?.transport.socketClosed(reason);
  }

  async #hello(
    state: SocketState,
    authority: ExecutorAuthority,
    value: unknown,
  ): Promise<void> {
    if (state.phase !== "hello") {
      state.transport.close(
        "work is not allowed before executor hello completes",
      );
      return;
    }
    state.phase = "claiming";
    const hello = decodeExecutorHello(value);
    if (
      !hello ||
      hello.executorId !== state.data.executorId ||
      hello.generation !== state.data.generation ||
      hello.capabilities.some(
        (capability) => !authority.capabilities.includes(capability),
      )
    ) {
      state.transport.close("executor hello was rejected");
      return;
    }
    let claimed = false;
    try {
      claimed = await authority.claimInstance({
        executorId: hello.executorId,
        generation: hello.generation,
        instanceId: hello.instanceId,
      });
    } catch {
      // Durable claim failures fail closed.
    }
    if (!claimed || !this.#sockets.has(state.data.connectionId)) {
      state.transport.close("executor instance claim was rejected");
      return;
    }
    state.helloOff?.();
    state.helloOff = undefined;
    try {
      const remote = this.#options.registry.register({
        executorId: hello.executorId,
        instanceId: hello.instanceId,
        generation: hello.generation,
        capabilities: hello.capabilities,
        transport: state.transport,
        grant: authority.resolveGrant,
        cleanupGrant: authority.resolveCleanupGrant,
        helloTimeoutMs: this.#options.connectionPolicy?.helloTimeoutMs,
        createId: this.#options.createId,
      });
      state.remote = remote;
      state.transport.receive(JSON.stringify(hello));
      await remote.ready();
      if (this.#sockets.has(state.data.connectionId)) state.phase = "ready";
    } catch (error) {
      state.transport.close(
        error instanceof RemoteExecutorRegistrationError
          ? error.code
          : "executor registration failed",
      );
    }
  }

  #finish(state: SocketState, reason?: unknown): void {
    if (state.phase === "closed") return;
    state.phase = "closed";
    this.#timers.clearTimeout(state.helloTimer);
    state.helloOff?.();
    this.#sockets.delete(state.data.connectionId);
    if (state.remote) this.#options.registry.unregisterConnection(state.remote);
    void reason;
  }
}

function validateRequest(
  request: Request,
  policy: ExecutorIngressOptions["connectionPolicy"],
): Response | undefined {
  const url = new URL(request.url);
  if (
    request.method !== "GET" ||
    url.pathname !== EXECUTOR_CONNECT_PATH ||
    url.search
  )
    return response(400, "invalid executor upgrade request");
  let count = 0;
  let bytes = 0;
  for (const [name, value] of request.headers) {
    count++;
    bytes += name.length + value.length;
  }
  if (
    count > (policy?.maxHeaders ?? 64) ||
    bytes > (policy?.maxHeaderBytes ?? 16_384)
  )
    return response(400, "executor headers are too large");
  if (
    request.headers.get("upgrade")?.toLowerCase() !== "websocket" ||
    !request.headers
      .get("connection")
      ?.split(",")
      .some((value) => value.trim().toLowerCase() === "upgrade")
  )
    return response(400, "invalid executor WebSocket upgrade");
  const source = request.headers.get(EXECUTOR_SOURCE_HEADER);
  const id = request.headers.get(EXECUTOR_ID_HEADER);
  const generation = request.headers.get(EXECUTOR_GENERATION_HEADER);
  if (
    (source !== "runner" && source !== "managed") ||
    !id ||
    id.length > 256 ||
    !generation ||
    !/^[1-9]\d{0,14}$/.test(generation) ||
    !Number.isSafeInteger(Number(generation))
  )
    return response(400, "invalid executor connection metadata");
  return undefined;
}

function bearer(value: string | null): string | undefined {
  if (!value || !/^Bearer [\x21-\x7e]{1,4096}$/.test(value)) return undefined;
  return value.slice(7);
}

function sameUpgradeData(
  a: ExecutorUpgradeData,
  b: ExecutorUpgradeData,
): boolean {
  return (
    a.source === b.source &&
    a.executorId === b.executorId &&
    a.generation === b.generation &&
    a.connectionId === b.connectionId
  );
}

function response(status: 400 | 401 | 403 | 429, message: string): Response {
  return new Response(message, { status });
}
