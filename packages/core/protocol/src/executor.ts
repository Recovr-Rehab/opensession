/**
 * Versioned control-plane ↔ Executor wire contract.
 *
 * An Executor is a tool/workspace boundary. It can manipulate files, processes,
 * terminals, services, and portals inside a granted execution root. It never
 * receives model-loop state: prompts, model/account configuration, MCP policy,
 * transcript state, and provider credentials belong to the control plane.
 */

export const EXECUTOR_PROTOCOL_VERSION = 2 as const;
export const EXECUTOR_PROTOCOL_MIN_VERSION = EXECUTOR_PROTOCOL_VERSION;

export function executorSocketPath(sessionsDir: string): string {
  return `${sessionsDir}/executor.sock`;
}

/** An authorization capability whose contents are deliberately unspecified. */
declare const executorGrantBrand: unique symbol;
export type ExecutorGrant = string & {
  readonly [executorGrantBrand]: "ExecutorGrant";
};

/** Every operation is scoped to one root and one generation of one run. */
export interface ExecutorFence {
  rootId: string;
  sessionId: string;
  runId: string;
  generation: number;
  /** Epoch milliseconds. Executors reject work once this time has passed. */
  deadlineMs: number;
}

const MAX_GRANT_BYTES = 16 * 1024;
const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/;
const textEncoder = new TextEncoder();

/** Validate an opaque grant without inspecting or depending on its format. */
export function decodeExecutorGrant(value: unknown): ExecutorGrant | undefined {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    textEncoder.encode(value).byteLength > MAX_GRANT_BYTES
  ) {
    return undefined;
  }
  return value as ExecutorGrant;
}

/** A small pure fence decoder for both transports and provider adapters. */
export function decodeExecutorFence(
  value: unknown,
  nowMs = Date.now(),
): ExecutorFence | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return undefined;
  const fence = value as Record<string, unknown>;
  if (
    Object.keys(fence).some(
      (key) =>
        !["rootId", "sessionId", "runId", "generation", "deadlineMs"].includes(
          key,
        ),
    ) ||
    typeof fence.rootId !== "string" ||
    !ID_RE.test(fence.rootId) ||
    typeof fence.sessionId !== "string" ||
    !ID_RE.test(fence.sessionId) ||
    typeof fence.runId !== "string" ||
    !ID_RE.test(fence.runId) ||
    !Number.isSafeInteger(fence.generation) ||
    (fence.generation as number) < 0 ||
    !Number.isSafeInteger(fence.deadlineMs) ||
    (fence.deadlineMs as number) <= nowMs
  ) {
    return undefined;
  }
  return {
    rootId: fence.rootId,
    sessionId: fence.sessionId,
    runId: fence.runId,
    generation: fence.generation as number,
    deadlineMs: fence.deadlineMs as number,
  };
}

interface ExecutorMessageBase {
  version: typeof EXECUTOR_PROTOCOL_VERSION;
  requestId: string;
}

export type ExecutorCapability =
  "fs" | "process" | "terminal" | "service" | "portal";

/** Public incarnation metadata. Authentication happens before this frame is accepted. */
export interface ExecutorConnectionIdentity {
  executorId: string;
  instanceId: string;
  generation: number;
  capabilities: ExecutorCapability[];
}

interface ExecutorAuthorizedMessage extends ExecutorMessageBase {
  grant: ExecutorGrant;
  fence: ExecutorFence;
}

interface ExecutorMutation {
  /** Stable across retries of the same mutation. */
  idempotencyKey: string;
}

export interface ExecutorBinaryStreamMetadata {
  encoding: "base64";
  byteLength: number;
  mediaType?: string;
  sha256?: string;
}

export type ExecutorFsOperation =
  | { kind: "fs.read"; path: string; offset?: number; length?: number }
  | { kind: "fs.list"; path: string; recursive?: boolean }
  | { kind: "fs.stat"; path: string }
  | ({
      kind: "fs.write";
      path: string;
      data: string;
      encoding: "utf8" | "base64";
      create?: boolean;
    } & ExecutorMutation)
  | ({ kind: "fs.mkdir"; path: string; recursive?: boolean } & ExecutorMutation)
  | ({
      kind: "fs.remove";
      path: string;
      recursive?: boolean;
    } & ExecutorMutation)
  | ({
      kind: "fs.move";
      from: string;
      to: string;
      replace?: boolean;
    } & ExecutorMutation);

export type ExecutorProcessOperation =
  | ({
      kind: "process.spawn";
      executable: string;
      args: string[];
      cwd?: string;
      stdin?: "pipe" | "closed";
    } & ExecutorMutation)
  | { kind: "process.status"; processId: string }
  | ({
      kind: "process.signal";
      processId: string;
      signal: "interrupt" | "terminate" | "kill";
    } & ExecutorMutation);

export type ExecutorTerminalOperation =
  | ({
      kind: "terminal.open";
      executable?: string;
      args?: string[];
      cwd?: string;
      columns: number;
      rows: number;
    } & ExecutorMutation)
  | ({
      kind: "terminal.write";
      terminalId: string;
      data: string;
    } & ExecutorMutation)
  | ({
      kind: "terminal.resize";
      terminalId: string;
      columns: number;
      rows: number;
    } & ExecutorMutation)
  | ({ kind: "terminal.close"; terminalId: string } & ExecutorMutation);

export type ExecutorServiceOperation =
  | ({
      kind: "service.start";
      name: string;
      executable: string;
      args: string[];
      cwd?: string;
    } & ExecutorMutation)
  | { kind: "service.status"; serviceId: string }
  | ({ kind: "service.stop"; serviceId: string } & ExecutorMutation);

export type ExecutorPortalOperation =
  | ({ kind: "portal.open"; name: string; port: number } & ExecutorMutation)
  | { kind: "portal.status"; portalId: string }
  | ({ kind: "portal.close"; portalId: string } & ExecutorMutation);

export type ExecutorOperation =
  | ExecutorFsOperation
  | ExecutorProcessOperation
  | ExecutorTerminalOperation
  | ExecutorServiceOperation
  | ExecutorPortalOperation;

export type ExecutorReceiptState =
  "queued" | "running" | "succeeded" | "failed" | "cancelled";

export interface ExecutorReceipt {
  receiptId: string;
  requestId: string;
  state: ExecutorReceiptState;
  acceptedAt: string;
  idempotencyKey?: string;
  completedAt?: string;
}

export type ExecutorOperationOutcome =
  | { kind: "fs.read"; streamId: string; size: number; binary: boolean }
  | {
      kind: "fs.list";
      entries: Array<{
        path: string;
        type: "file" | "directory" | "symlink";
        size?: number;
      }>;
    }
  | {
      kind: "fs.stat";
      entry: {
        path: string;
        type: "file" | "directory" | "symlink";
        size: number;
        modifiedAt?: string;
      };
    }
  | { kind: "fs.changed"; path: string }
  | {
      kind: "process";
      processId: string;
      state: "starting" | "running" | "exited";
      exitCode?: number;
      streamId?: string;
    }
  | {
      kind: "terminal";
      terminalId: string;
      state: "open" | "closed";
      streamId?: string;
    }
  | {
      kind: "service";
      serviceId: string;
      state: "starting" | "running" | "stopped" | "failed";
      streamId?: string;
    }
  | {
      kind: "portal";
      portalId: string;
      state: "opening" | "open" | "closed" | "failed";
    };

export type ExecutorStreamEvent =
  | {
      kind: "text";
      streamId: string;
      sequence: number;
      channel: "stdout" | "stderr" | "terminal" | "file";
      data: string;
      eof?: boolean;
    }
  | {
      kind: "binary";
      streamId: string;
      sequence: number;
      offset: number;
      data: string;
      metadata: ExecutorBinaryStreamMetadata;
      eof?: boolean;
    }
  | {
      kind: "exit";
      streamId: string;
      sequence: number;
      exitCode: number | null;
      signal?: string;
    };

/** Exact-version handshake followed by fenced, capability-authorized work. */
export type ExecutorClientMessage =
  | (ExecutorMessageBase & ExecutorConnectionIdentity & { t: "hello" })
  | (ExecutorAuthorizedMessage & { t: "execute"; operation: ExecutorOperation })
  | (ExecutorAuthorizedMessage & { t: "receipt_status"; receiptId: string })
  | (ExecutorAuthorizedMessage & {
      t: "cancel";
      target:
        { requestId: string } | { receiptId: string } | { streamId: string };
      idempotencyKey: string;
    })
  | (ExecutorAuthorizedMessage & {
      t: "stream_credit";
      streamId: string;
      bytes: number;
    });

export type ExecutorErrorCode =
  | "unsupported_version"
  | "invalid_request"
  | "invalid_grant"
  | "stale_generation"
  | "deadline_exceeded"
  | "not_found"
  | "conflict"
  | "cancelled"
  | "operation_failed"
  | "executor_busy";

export type ExecutorServerMessage =
  | (ExecutorMessageBase &
      ExecutorConnectionIdentity & { t: "hello"; accepted: true })
  | (ExecutorMessageBase & { t: "receipt"; receipt: ExecutorReceipt })
  | (ExecutorMessageBase & {
      t: "receipt_status";
      receipt: ExecutorReceipt;
      outcome?: ExecutorOperationOutcome;
      eventsComplete?: true;
    })
  | (ExecutorMessageBase & { t: "event"; event: ExecutorStreamEvent })
  | (ExecutorMessageBase & {
      t: "error";
      code: ExecutorErrorCode;
      message: string;
      receipt?: ExecutorReceipt;
    });

/** Decode only the handshake because version negotiation must fail before work. */
export function decodeExecutorHello(
  value: unknown,
): Extract<ExecutorClientMessage, { t: "hello" }> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return undefined;
  const message = value as Record<string, unknown>;
  const allowed = [
    "t",
    "version",
    "requestId",
    "executorId",
    "instanceId",
    "generation",
    "capabilities",
  ];
  if (
    Object.keys(message).some((key) => !allowed.includes(key)) ||
    message.t !== "hello" ||
    message.version !== EXECUTOR_PROTOCOL_VERSION ||
    typeof message.requestId !== "string" ||
    !ID_RE.test(message.requestId) ||
    typeof message.executorId !== "string" ||
    !ID_RE.test(message.executorId) ||
    typeof message.instanceId !== "string" ||
    !ID_RE.test(message.instanceId) ||
    !Number.isSafeInteger(message.generation) ||
    (message.generation as number) < 0 ||
    !Array.isArray(message.capabilities) ||
    message.capabilities.some(
      (capability) =>
        !["fs", "process", "terminal", "service", "portal"].includes(
          capability as string,
        ),
    ) ||
    new Set(message.capabilities).size !== message.capabilities.length
  ) {
    return undefined;
  }
  return {
    t: "hello",
    version: EXECUTOR_PROTOCOL_VERSION,
    requestId: message.requestId,
    executorId: message.executorId,
    instanceId: message.instanceId,
    generation: message.generation as number,
    capabilities: message.capabilities as ExecutorCapability[],
  };
}

/*
 * Transitional local host-launch contract. The current local coordinator uses
 * these names until its runtime cutover to ExecutorClientMessage. New Executor
 * implementations must use the contract above.
 */

/** @deprecated Transitional local run-host launch state. */
export type ExecutorLaunchState =
  "starting" | "started" | "stopped" | "failed" | "uncertain" | "unknown";

/** @deprecated Transitional local run-host launch status. */
export interface ExecutorHostStatus {
  hostId: string;
  specHash?: string;
  unit: string;
  state: ExecutorLaunchState;
  ready: boolean;
  pid?: number;
  error?: string;
}

interface LegacyExecutorRequestBase {
  requestId: string;
  /** @deprecated Replaced by an opaque, operation-scoped ExecutorGrant. */
  token: string;
}

/** @deprecated Use ExecutorClientMessage after the local runtime cutover. */
export type ExecutorRequest =
  | (LegacyExecutorRequestBase & {
      t: "hello";
      minVersion: number;
      maxVersion: number;
    })
  | (LegacyExecutorRequestBase & {
      t: "launch_host";
      version: number;
      hostId: string;
      specHash: string;
    })
  | (LegacyExecutorRequestBase & {
      t: "host_status";
      version: number;
      hostId: string;
      specHash?: string;
    })
  | (LegacyExecutorRequestBase & {
      t: "stop_host";
      version: number;
      hostId: string;
      specHash: string;
    });

/** @deprecated Use ExecutorServerMessage after the local runtime cutover. */
export type ExecutorResponse =
  | {
      requestId: string;
      ok: true;
      version: number;
      compatible?: boolean;
      status?: ExecutorHostStatus;
    }
  | {
      requestId: string;
      ok: false;
      version: number;
      code:
        | "unsupported_version"
        | "invalid_request"
        | "invalid_host"
        | "spec_not_found"
        | "spec_hash_mismatch"
        | "launch_failed"
        | "launch_uncertain"
        | "executor_busy"
        | "stop_failed";
      error: string;
    };
