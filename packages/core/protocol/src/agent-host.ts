/**
 * Local Unix-socket contract between the control plane and an Agent Host.
 *
 * The Agent Host owns one model turn loop. It receives policy and a single
 * opaque Executor capability, but never provisions or destroys a Sphere.
 * Sphere/provider lifecycle remains outside this protocol.
 */

import type { ImageInput, StreamEvent } from "./events";
import type { ExecutorGrant } from "./executor";
import type { AskResult } from "./runner";
import type { TranscriptEntry } from "./session";

export const AGENT_HOST_PROTOCOL_VERSION = 1 as const;

export interface AgentTurnFence {
  sessionId: string;
  runId: string;
  turnId: string;
  generation: number;
}

export interface AgentModelPolicy {
  model: string;
  effort?: string;
  fastMode?: boolean;
  /** Opaque control-plane capability for obtaining this turn's model access. */
  accessGrant?: string;
  fallbackModel?: string;
}

export interface AgentMcpPolicy {
  /** Explicitly broad or explicitly enumerated. An empty list means none. */
  servers: "all" | string[];
  /** Opaque control-plane capability for the selected MCP surface. */
  accessGrant?: string;
}

export interface AgentTranscriptPolicy {
  /** Last durable mutation observed before this turn starts. */
  afterChangeSeq?: number;
  /** Maximum bytes an individual proposed append may contain. */
  maxAppendBytes: number;
  /** Host proposals require a control-plane acknowledgement before advancing. */
  requireAck: true;
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
  mcpPolicy: AgentMcpPolicy;
  transcriptPolicy: AgentTranscriptPolicy;
  /** The only execution authority carried by a turn. Its format is opaque. */
  executorGrant: ExecutorGrant;
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
      code: "unsupported_version" | "invalid_request" | "stale_generation" | "host_busy" | "turn_failed";
      message: string;
      fence?: AgentTurnFence;
    });

export function isAgentTurnFence(value: unknown): value is AgentTurnFence {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const fence = value as Record<string, unknown>;
  return (
    typeof fence.sessionId === "string" &&
    fence.sessionId.length > 0 &&
    typeof fence.runId === "string" &&
    fence.runId.length > 0 &&
    typeof fence.turnId === "string" &&
    fence.turnId.length > 0 &&
    Number.isSafeInteger(fence.generation) &&
    (fence.generation as number) >= 0
  );
}

export function decodeAgentHostHello(
  value: unknown,
): Extract<AgentHostClientMessage, { t: "hello" }> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const message = value as Record<string, unknown>;
  if (
    Object.keys(message).some((key) => !["t", "version", "requestId"].includes(key)) ||
    message.t !== "hello" ||
    message.version !== AGENT_HOST_PROTOCOL_VERSION ||
    typeof message.requestId !== "string" ||
    !message.requestId
  ) {
    return undefined;
  }
  return {
    t: "hello",
    version: AGENT_HOST_PROTOCOL_VERSION,
    requestId: message.requestId,
  };
}
