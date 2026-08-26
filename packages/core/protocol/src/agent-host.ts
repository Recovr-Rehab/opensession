/**
 * Local Unix-socket contract between the control plane and an Agent Host.
 *
 * The Agent Host owns one model turn loop. It receives bounded, serializable
 * policy and a turn-scoped control-plane dispatch capability, but never an
 * Executor operation grant and never provisions or destroys an Executor.
 */

import type { ImageInput, StreamEvent } from "./events";
import type { GitIdentity } from "./identity";
import { decodeExecutorId } from "./executor";
import type { AskResult } from "./runner";
import type { TranscriptEntry } from "./session";

export const AGENT_HOST_PROTOCOL_VERSION = 1 as const;

const MAX_CAPABILITY_BYTES = 16 * 1024;
const MAX_SHORT_TEXT_BYTES = 16 * 1024;
const MAX_PROMPT_BYTES = 768 * 1024;
const MAX_REPOSITORIES_NOTE_BYTES = 256 * 1024;
const MAX_IMAGE_BYTES = 768 * 1024;
const MAX_IMAGES = 32;
const MAX_MCP_SERVERS = 1_024;
const MAX_TOOL_RULES = 4_096;
export const MAX_AGENT_TRANSCRIPT_APPEND_BYTES = 768 * 1024;
export const MAX_AGENT_TURN_DURATION_MS = 24 * 60 * 60_000;
const CONTROL_CHARACTER_RE = /[\u0000-\u001f\u007f]/;
const NUL_RE = /\u0000/;
const textEncoder = new TextEncoder();
const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
const exact = (value: Record<string, unknown>, keys: readonly string[]) =>
  Object.keys(value).every((key) => keys.includes(key));
const boundedString = (
  value: unknown,
  maxBytes: number,
  allowEmpty = false,
): value is string =>
  typeof value === "string" &&
  (allowEmpty || value.length > 0) &&
  textEncoder.encode(value).byteLength <= maxBytes;
const boundedName = (
  value: unknown,
  maxBytes = MAX_SHORT_TEXT_BYTES,
): value is string =>
  boundedString(value, maxBytes) && !CONTROL_CHARACTER_RE.test(value);

/**
 * Opaque Agent Host capability for bounded control-plane dispatch requests.
 * It is branded separately from ExecutorGrant on purpose: it is never valid at
 * ExecutorBroker or an Executor daemon and cannot authorize an operation.
 * A future durable v2 contract must persist a descriptor and reacquire this
 * short-lived IPC capability instead of persisting the token.
 */
declare const agentExecutorAccessGrantBrand: unique symbol;
export type AgentExecutorAccessGrant = string & {
  readonly [agentExecutorAccessGrantBrand]: "AgentExecutorAccessGrant";
};

export function decodeAgentExecutorAccessGrant(
  value: unknown,
): AgentExecutorAccessGrant | undefined {
  return boundedString(value, MAX_CAPABILITY_BYTES)
    ? (value as AgentExecutorAccessGrant)
    : undefined;
}

export interface AgentTurnFence {
  sessionId: string;
  runId: string;
  turnId: string;
  generation: number;
}

/** Non-secret model selection. Access is reacquired through supervised gateway RPC. */
export interface AgentModelPolicy {
  model: string;
  effort?: string;
  fastMode?: boolean;
  fallbackModel?: string;
}

/** Non-secret MCP selection. Access is reacquired through supervised gateway RPC. */
export interface AgentMcpPolicy {
  /** Explicitly broad or explicitly enumerated. An empty list means none. */
  servers: "all" | string[];
}

export interface AgentTranscriptPolicy {
  /** Last durable mutation observed before this turn starts. */
  afterChangeSeq?: number;
  /** Maximum bytes an individual proposed append may contain. */
  maxAppendBytes: number;
  /** Host proposals require a control-plane acknowledgement before advancing. */
  requireAck: true;
}

/** Engine lineage that Pi can resume without carrying provider configuration. */
export interface AgentEnginePolicy {
  engineSessionId?: string;
}

/** Trust and tool registration policy, using the existing runner semantics. */
export interface AgentRunPolicy {
  trustProfile: "interactive" | "automation";
  runKind: string;
  deniedTools?: Record<string, string>;
  confirmTools?: Record<string, string>;
}

/** Prompt and MCP grant identities are separate existing runner identities. */
export interface AgentIdentityPolicy {
  user?: string;
  mcpGrantUser?: string;
}

/** Serializable environment choices only. No credential values belong here. */
export interface AgentEnvironmentPolicy {
  author?: GitIdentity | null;
  aws?: boolean;
  claudeCliEnv?: boolean;
  codexCliEnv?: boolean;
}

export interface AgentWorkspacePolicy {
  /** Control-plane-selected path corresponding to executorPolicy.rootId. */
  executionRoot: string;
  /** Existing model-visible note for the primary and attached repositories. */
  repositoriesNote?: string;
}

/** Immutable binding for dispatch through one selected Executor incarnation. */
export interface AgentExecutorPolicy {
  readonly executorId: string;
  readonly rootId: string;
  readonly generation: number;
  /** Turn-scoped authority to request exact per-operation grants. */
  readonly accessGrant: AgentExecutorAccessGrant;
  /** Absolute epoch-ms ceiling for this turn's execution authority. */
  readonly deadlineMs: number;
}

/** Everything the local Agent Host needs for one model turn. */
export interface AgentTurnSpec {
  fence: AgentTurnFence;
  input: {
    prompt: string;
    promptEntryId?: string;
    images?: ImageInput[];
  };
  mode: "ask" | "code" | "scratch";
  modelPolicy: AgentModelPolicy;
  enginePolicy: AgentEnginePolicy;
  mcpPolicy: AgentMcpPolicy;
  transcriptPolicy: AgentTranscriptPolicy;
  runPolicy: AgentRunPolicy;
  identityPolicy: AgentIdentityPolicy;
  environmentPolicy: AgentEnvironmentPolicy;
  workspacePolicy: AgentWorkspacePolicy;
  executorPolicy: AgentExecutorPolicy;
}

interface AgentHostMessageBase {
  version: typeof AGENT_HOST_PROTOCOL_VERSION;
  requestId: string;
}

interface FencedAgentHostMessage extends AgentHostMessageBase {
  fence: AgentTurnFence;
}

/** Control plane → Agent Host. */
export type AgentHostClientMessage =
  | (AgentHostMessageBase & { t: "hello" })
  | (AgentHostMessageBase & { t: "start_turn"; spec: AgentTurnSpec })
  | (FencedAgentHostMessage & {
      t: "steer";
      text: string;
      images?: ImageInput[];
      steerId: string;
    })
  | (FencedAgentHostMessage & { t: "answer"; askId: string; result: AskResult })
  | (FencedAgentHostMessage & { t: "cancel" })
  | (FencedAgentHostMessage & {
      t: "transcript_ack";
      appendId: string;
      changeSeq: number;
    })
  | (FencedAgentHostMessage & { t: "shutdown" });

/** Agent Host → control plane. Transcript entries are proposals; authority to
 * persist, order, rewrite, and compact them remains in the control plane. */
export type AgentHostServerMessage =
  | (AgentHostMessageBase & { t: "hello"; accepted: true })
  | (FencedAgentHostMessage & { t: "turn_started" })
  | (FencedAgentHostMessage & { t: "event"; event: StreamEvent })
  | (FencedAgentHostMessage & {
      t: "transcript_proposal";
      appendId: string;
      entries: TranscriptEntry[];
    })
  | (FencedAgentHostMessage & {
      t: "ask";
      askId: string;
      input: Record<string, unknown>;
    })
  | (FencedAgentHostMessage & {
      t: "turn_finished";
      status: "completed" | "cancelled" | "failed";
      error?: string;
    })
  | (AgentHostMessageBase & {
      t: "error";
      code:
        | "unsupported_version"
        | "invalid_request"
        | "stale_generation"
        | "host_busy"
        | "turn_failed";
      message: string;
      fence?: AgentTurnFence;
    });

export function isAgentTurnFence(value: unknown): value is AgentTurnFence {
  if (
    !record(value) ||
    !exact(value, ["sessionId", "runId", "turnId", "generation"])
  )
    return false;
  return (
    !!decodeExecutorId(value.sessionId) &&
    !!decodeExecutorId(value.runId) &&
    !!decodeExecutorId(value.turnId) &&
    Number.isSafeInteger(value.generation) &&
    (value.generation as number) >= 0
  );
}

function decodeImage(value: unknown): ImageInput | undefined {
  if (!record(value) || !exact(value, ["mediaType", "data"])) return undefined;
  return boundedName(value.mediaType) &&
    boundedString(value.data, MAX_IMAGE_BYTES)
    ? { mediaType: value.mediaType, data: value.data }
    : undefined;
}

function decodeToolRules(value: unknown): Record<string, string> | undefined {
  if (!record(value) || Object.keys(value).length > MAX_TOOL_RULES)
    return undefined;
  for (const [key, reason] of Object.entries(value)) {
    if (
      !boundedName(key) ||
      !boundedString(reason, MAX_SHORT_TEXT_BYTES, true) ||
      NUL_RE.test(reason)
    )
      return undefined;
  }
  return value;
}

function decodeGitIdentity(value: unknown): GitIdentity | null | undefined {
  if (value === null) return null;
  if (!record(value) || !exact(value, ["name", "email"])) return undefined;
  return boundedName(value.name) && boundedName(value.email)
    ? { name: value.name, email: value.email }
    : undefined;
}

export function decodeAgentTurnSpec(
  value: unknown,
  nowMs = Date.now(),
): AgentTurnSpec | undefined {
  if (
    !record(value) ||
    !exact(value, [
      "fence",
      "input",
      "mode",
      "modelPolicy",
      "enginePolicy",
      "mcpPolicy",
      "transcriptPolicy",
      "runPolicy",
      "identityPolicy",
      "environmentPolicy",
      "workspacePolicy",
      "executorPolicy",
    ]) ||
    !isAgentTurnFence(value.fence)
  )
    return undefined;

  const input = value.input;
  if (!record(input) || !exact(input, ["prompt", "promptEntryId", "images"]))
    return undefined;
  const images = input.images;
  if (
    !boundedString(input.prompt, MAX_PROMPT_BYTES, true) ||
    (input.promptEntryId !== undefined &&
      !decodeExecutorId(input.promptEntryId)) ||
    (images !== undefined &&
      (!Array.isArray(images) ||
        images.length > MAX_IMAGES ||
        images.some((image) => !decodeImage(image))))
  )
    return undefined;

  if (!(
    value.mode === "ask" ||
    value.mode === "code" ||
    value.mode === "scratch"
  ))
    return undefined;

  const modelPolicy = value.modelPolicy;
  if (
    !record(modelPolicy) ||
    !exact(modelPolicy, ["model", "effort", "fastMode", "fallbackModel"]) ||
    !boundedName(modelPolicy.model) ||
    (modelPolicy.effort !== undefined && !boundedName(modelPolicy.effort)) ||
    (modelPolicy.fastMode !== undefined &&
      typeof modelPolicy.fastMode !== "boolean") ||
    (modelPolicy.fallbackModel !== undefined &&
      !boundedName(modelPolicy.fallbackModel))
  )
    return undefined;

  const enginePolicy = value.enginePolicy;
  if (
    !record(enginePolicy) ||
    !exact(enginePolicy, ["engineSessionId"]) ||
    (enginePolicy.engineSessionId !== undefined &&
      !boundedName(enginePolicy.engineSessionId))
  )
    return undefined;

  const mcpPolicy = value.mcpPolicy;
  if (!record(mcpPolicy) || !exact(mcpPolicy, ["servers"])) return undefined;
  const servers = mcpPolicy.servers;
  if (!(
    servers === "all" ||
    (Array.isArray(servers) &&
      servers.length <= MAX_MCP_SERVERS &&
      servers.every((server) => boundedName(server)))
  ))
    return undefined;

  const transcriptPolicy = value.transcriptPolicy;
  if (
    !record(transcriptPolicy) ||
    !exact(transcriptPolicy, [
      "afterChangeSeq",
      "maxAppendBytes",
      "requireAck",
    ]) ||
    (transcriptPolicy.afterChangeSeq !== undefined &&
      (!Number.isSafeInteger(transcriptPolicy.afterChangeSeq) ||
        (transcriptPolicy.afterChangeSeq as number) < 0)) ||
    !Number.isSafeInteger(transcriptPolicy.maxAppendBytes) ||
    (transcriptPolicy.maxAppendBytes as number) < 1 ||
    (transcriptPolicy.maxAppendBytes as number) >
      MAX_AGENT_TRANSCRIPT_APPEND_BYTES ||
    transcriptPolicy.requireAck !== true
  )
    return undefined;

  const runPolicy = value.runPolicy;
  if (
    !record(runPolicy) ||
    !exact(runPolicy, [
      "trustProfile",
      "runKind",
      "deniedTools",
      "confirmTools",
    ]) ||
    !(
      runPolicy.trustProfile === "interactive" ||
      runPolicy.trustProfile === "automation"
    ) ||
    !decodeExecutorId(runPolicy.runKind)
  )
    return undefined;
  const deniedTools =
    runPolicy.deniedTools === undefined
      ? undefined
      : decodeToolRules(runPolicy.deniedTools);
  const confirmTools =
    runPolicy.confirmTools === undefined
      ? undefined
      : decodeToolRules(runPolicy.confirmTools);
  if (
    (runPolicy.deniedTools !== undefined && deniedTools === undefined) ||
    (runPolicy.confirmTools !== undefined && confirmTools === undefined)
  )
    return undefined;

  const identityPolicy = value.identityPolicy;
  if (
    !record(identityPolicy) ||
    !exact(identityPolicy, ["user", "mcpGrantUser"]) ||
    (identityPolicy.user !== undefined && !boundedName(identityPolicy.user)) ||
    (identityPolicy.mcpGrantUser !== undefined &&
      !boundedName(identityPolicy.mcpGrantUser))
  )
    return undefined;

  const environmentPolicy = value.environmentPolicy;
  if (
    !record(environmentPolicy) ||
    !exact(environmentPolicy, [
      "author",
      "aws",
      "claudeCliEnv",
      "codexCliEnv",
    ]) ||
    (environmentPolicy.author !== undefined &&
      decodeGitIdentity(environmentPolicy.author) === undefined) ||
    [
      environmentPolicy.aws,
      environmentPolicy.claudeCliEnv,
      environmentPolicy.codexCliEnv,
    ].some((flag) => flag !== undefined && typeof flag !== "boolean")
  )
    return undefined;

  const workspacePolicy = value.workspacePolicy;
  if (
    !record(workspacePolicy) ||
    !exact(workspacePolicy, ["executionRoot", "repositoriesNote"]) ||
    !boundedName(workspacePolicy.executionRoot) ||
    (workspacePolicy.repositoriesNote !== undefined &&
      (!boundedString(
        workspacePolicy.repositoriesNote,
        MAX_REPOSITORIES_NOTE_BYTES,
        true,
      ) ||
        NUL_RE.test(workspacePolicy.repositoriesNote)))
  )
    return undefined;

  const executorPolicy = value.executorPolicy;
  if (
    !record(executorPolicy) ||
    !exact(executorPolicy, [
      "executorId",
      "rootId",
      "generation",
      "accessGrant",
      "deadlineMs",
    ]) ||
    !decodeExecutorId(executorPolicy.executorId) ||
    !decodeExecutorId(executorPolicy.rootId) ||
    executorPolicy.generation !== value.fence.generation ||
    !decodeAgentExecutorAccessGrant(executorPolicy.accessGrant) ||
    !Number.isSafeInteger(executorPolicy.deadlineMs) ||
    (executorPolicy.deadlineMs as number) <= nowMs ||
    (executorPolicy.deadlineMs as number) > nowMs + MAX_AGENT_TURN_DURATION_MS
  )
    return undefined;

  return value as unknown as AgentTurnSpec;
}

export function decodeAgentHostStartTurn(
  value: unknown,
  nowMs = Date.now(),
): Extract<AgentHostClientMessage, { t: "start_turn" }> | undefined {
  if (
    !record(value) ||
    !exact(value, ["t", "version", "requestId", "spec"]) ||
    value.t !== "start_turn" ||
    value.version !== AGENT_HOST_PROTOCOL_VERSION ||
    !decodeExecutorId(value.requestId) ||
    !decodeAgentTurnSpec(value.spec, nowMs)
  )
    return undefined;
  return value as unknown as Extract<
    AgentHostClientMessage,
    { t: "start_turn" }
  >;
}

export function decodeAgentHostHello(
  value: unknown,
): Extract<AgentHostClientMessage, { t: "hello" }> | undefined {
  if (!record(value)) return undefined;
  const requestId = decodeExecutorId(value.requestId);
  if (
    !exact(value, ["t", "version", "requestId"]) ||
    value.t !== "hello" ||
    value.version !== AGENT_HOST_PROTOCOL_VERSION ||
    !requestId
  )
    return undefined;
  return {
    t: "hello",
    version: AGENT_HOST_PROTOCOL_VERSION,
    requestId,
  };
}
