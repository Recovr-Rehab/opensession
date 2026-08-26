import {
  AGENT_HOST_SUPERVISION_AUDIENCE,
  AGENT_HOST_SUPERVISION_PURPOSE,
  AGENT_HOST_SUPERVISION_VERSION,
  decodeAgentHostSupervisionAuthorityV2,
  type AgentHostSupervisionAuthorityV2,
} from "@tellahq/opensession-protocol/agent-host";
import { decodeExecutorId } from "@tellahq/opensession-protocol/executor";

export type AgentHostSupervisionClaim = {
  op: "claim";
  claimId: string;
  sessionId: string;
  runId: string;
  turnId: string;
  generation: number;
  planHash: string;
  hostId: string;
  hostGeneration: number;
  hostIncarnation: string;
  hostChallenge: string;
  audience: typeof AGENT_HOST_SUPERVISION_AUDIENCE;
  purpose: typeof AGENT_HOST_SUPERVISION_PURPOSE;
  issuedAtMs: number;
  expiresAtMs: number;
  nonce: string;
  keyId: string;
  /** Overwritten by the authenticated actor service before mailbox admission. */
  kernelServiceEpoch: string;
};

export type AgentHostSupervisionRequest = AgentHostSupervisionClaim;
export type AgentHostSupervisionReceipt = {
  authority: AgentHostSupervisionAuthorityV2;
  /** Canonical unsigned UTF-8 bytes encoded as base64. */
  authorityBytes: string;
  authorityHash: string;
};
export type AgentHostSupervisionResult =
  | { accepted: true; replayed: boolean; receipt: AgentHostSupervisionReceipt }
  | {
      accepted: false;
      reason:
        | "stale_run"
        | "terminal_run"
        | "invalid_claim"
        | "claim_mismatch"
        | "challenge_reused"
        | "nonce_reused"
        | "stale_host"
        | "stale_service_epoch"
        | "receipt_capacity";
    };

const CLAIM_KEYS = [
  "op",
  "claimId",
  "sessionId",
  "runId",
  "turnId",
  "generation",
  "planHash",
  "hostId",
  "hostGeneration",
  "hostIncarnation",
  "hostChallenge",
  "audience",
  "purpose",
  "issuedAtMs",
  "expiresAtMs",
  "nonce",
  "keyId",
  "kernelServiceEpoch",
] as const;

export function decodeAgentHostSupervisionClaim(
  value: unknown,
  nowMs?: number,
): AgentHostSupervisionClaim | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return undefined;
  const claim = value as Record<string, unknown>;
  if (
    Object.keys(claim).length !== CLAIM_KEYS.length ||
    Object.keys(claim).some((key) => !CLAIM_KEYS.includes(key as never)) ||
    claim.op !== "claim" ||
    !decodeExecutorId(claim.claimId)
  )
    return undefined;
  const typed = claim as AgentHostSupervisionClaim;
  return authorityFromAgentHostSupervisionClaim(typed, 1, nowMs)
    ? typed
    : undefined;
}

export function authorityFromAgentHostSupervisionClaim(
  claim: AgentHostSupervisionClaim,
  supervisorEpoch: number,
  nowMs?: number,
): AgentHostSupervisionAuthorityV2 | undefined {
  return decodeAgentHostSupervisionAuthorityV2(
    {
      version: AGENT_HOST_SUPERVISION_VERSION,
      fence: {
        sessionId: claim.sessionId,
        runId: claim.runId,
        turnId: claim.turnId,
        generation: claim.generation,
      },
      planHash: claim.planHash,
      hostId: claim.hostId,
      hostGeneration: claim.hostGeneration,
      hostIncarnation: claim.hostIncarnation,
      supervisorEpoch,
      kernelServiceEpoch: claim.kernelServiceEpoch,
      hostChallenge: claim.hostChallenge,
      audience: claim.audience,
      purpose: claim.purpose,
      issuedAtMs: claim.issuedAtMs,
      expiresAtMs: claim.expiresAtMs,
      nonce: claim.nonce,
      keyId: claim.keyId,
    },
    nowMs,
  );
}
