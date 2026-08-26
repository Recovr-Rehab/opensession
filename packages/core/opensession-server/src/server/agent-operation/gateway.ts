import {
  decodeAgentOperationRequestV1,
  hashAgentMcpPayloadV1,
  hashAgentModelPayloadV1,
  hashAgentOperationDescriptorV1,
  hashAgentOperationReceiptV1,
  type AgentOperationDigest,
  type AgentOperationKernelTerminalV1,
  type AgentOperationOutcomeV1,
  type AgentOperationRequestV1,
  type AgentTranscriptReceiptRefV1,
} from "@tellahq/opensession-protocol/agent-operation";
import type { AgentHostSupervisionAuthorityV2 } from "@tellahq/opensession-protocol/agent-host";
import type { SignedAgentHostSupervisionEnvelopeV1 } from "@tellahq/opensession-protocol/agent-host-supervision";
import {
  type AgentGatewayGrantExpectation,
  type AgentGatewayGrantRegistry,
} from "./grants";
import {
  AgentOperationConflictError,
  type AgentOperationIdentity,
  type AgentOperationLedger,
  type AgentOperationRecord,
  type AgentOperationSettlement,
  type ExecutingOperationReconciler,
  reconcileExecutingOperation,
} from "./ledger";

export type AgentGatewayFailpoint =
  | "after_admission"
  | "after_prepared"
  | "after_executing"
  | "after_transcript_append"
  | "after_ledger_settlement"
  | "after_schema_settlement";

export interface VerifiedAgentSupervision {
  readonly authority: AgentHostSupervisionAuthorityV2;
  readonly authorityHash: AgentOperationDigest;
}
export interface AgentGatewayAdmissionFacade {
  admit(identity: AgentOperationIdentity): Promise<{ accepted: boolean }>;
  settle(
    identity: AgentOperationIdentity,
    gatewayReceiptDigest: AgentOperationDigest,
    terminal: Readonly<AgentOperationKernelTerminalV1>,
  ): Promise<void>;
  indeterminate(
    identity: AgentOperationIdentity,
    gatewayReceiptDigest: AgentOperationDigest,
    terminal: Readonly<AgentOperationKernelTerminalV1>,
  ): Promise<void>;
}
export interface AgentGatewayAdapterResult {
  readonly outcome: AgentOperationOutcomeV1;
  /** Ephemeral material consumed by the transcript appender, never persisted. */
  readonly transcript: unknown;
  readonly providerRequestRef?: string;
  readonly providerResponseRef?: string;
}
export interface AgentGatewayAdapter {
  readonly id: string;
  readonly version: string;
  execute(
    request: Readonly<{
      descriptor: AgentOperationIdentity["descriptor"];
      payload: unknown;
    }>,
    signal: AbortSignal,
  ): Promise<AgentGatewayAdapterResult>;
}
export interface AgentGatewayTranscriptTerminal {
  readonly refs: readonly AgentTranscriptReceiptRefV1[];
  readonly kernelTerminal: Readonly<AgentOperationKernelTerminalV1>;
}
export interface AgentOperationGatewayOptions {
  readonly ledger: AgentOperationLedger;
  readonly grants: AgentGatewayGrantRegistry;
  readonly verifySupervision: (
    envelope: SignedAgentHostSupervisionEnvelopeV1,
    request: AgentOperationRequestV1,
  ) => Promise<VerifiedAgentSupervision | undefined>;
  readonly admission: AgentGatewayAdmissionFacade;
  readonly adapterFor: (
    request: AgentOperationRequestV1,
  ) => AgentGatewayAdapter | undefined;
  readonly encodePayload: (
    kind: "model" | "mcp",
    payload: unknown,
  ) => Uint8Array;
  /** Required for MCP, whose descriptor intentionally does not carry a transcript anchor. */
  readonly resolveTranscriptAnchor?: (
    request: AgentOperationRequestV1,
    payload: unknown,
  ) => AgentOperationIdentity["transcriptAnchor"];
  readonly appendTerminal: (
    identity: AgentOperationIdentity,
    result: AgentGatewayAdapterResult,
  ) => Promise<AgentGatewayTranscriptTerminal>;
  readonly appendIndeterminateNotice: (
    record: AgentOperationRecord,
    appendId: string,
  ) => Promise<AgentOperationKernelTerminalV1>;
  readonly reconcilerFor?: (
    record: AgentOperationRecord,
  ) => ExecutingOperationReconciler | undefined;
  readonly now?: () => number;
  readonly failpoint?: (
    point: AgentGatewayFailpoint,
    record: AgentOperationRecord,
  ) => void | Promise<void>;
}

/** Import-inert coordinator. It owns no sockets, timers, listeners, or credentials. */
export class AgentOperationGateway {
  readonly #options: AgentOperationGatewayOptions;
  readonly #mailboxes = new Map<string, Promise<unknown>>();
  constructor(options: AgentOperationGatewayOptions) {
    this.#options = options;
  }

  dispatch(
    rawRequest: unknown,
    payload: unknown,
    signal = new AbortController().signal,
  ) {
    const request = decodeAgentOperationRequestV1(rawRequest);
    if (!request)
      return Promise.reject(new AgentGatewayRequestError("invalid request"));
    return this.#serialize(keyForRequest(request), () =>
      this.#dispatch(request, payload, signal),
    );
  }

  async recoverActive(): Promise<{
    prepared: AgentOperationRecord[];
    recovered: AgentOperationRecord[];
  }> {
    const active = await this.#options.ledger.scanActive();
    const prepared: AgentOperationRecord[] = [];
    const recovered: AgentOperationRecord[] = [];
    await Promise.all(
      active.map((record) =>
        this.#serialize(keyFor(record), async () => {
          if (record.receipt.state === "prepared") {
            // Payloads and bearer grants are intentionally not durable. A fresh dispatch
            // must reauthorize this record before it can become executing.
            prepared.push(record);
            return;
          }
          if (record.receipt.state !== "executing") return;
          const terminal = await reconcileExecutingOperation(
            this.#options.ledger,
            record,
            this.#options.reconcilerFor?.(record),
            async (authenticated, reservation) =>
              this.#options.appendIndeterminateNotice(
                authenticated,
                indeterminateAppendId(
                  authenticated.operationId,
                  reservation.reservationId,
                ),
              ),
            this.#now(),
          );
          if (
            terminal.receipt.state !== "settled" &&
            terminal.receipt.state !== "indeterminate"
          )
            throw new AgentOperationConflictError(
              "recovery did not reach terminal state",
            );
          await this.#settleActor(terminal);
          recovered.push(terminal);
        }),
      ),
    );
    return { prepared, recovered };
  }

  async #dispatch(
    request: AgentOperationRequestV1,
    payload: unknown,
    signal: AbortSignal,
  ) {
    const verified = await this.#options.verifySupervision(
      request.supervisionEnvelope,
      request,
    );
    if (!verified)
      throw new AgentGatewayAuthorizationError("invalid supervision");
    const descriptorDigest = await hashAgentOperationDescriptorV1(
      request.descriptor,
    );
    if (descriptorDigest !== request.descriptorDigest)
      throw new AgentGatewayAuthorizationError("descriptor digest mismatch");
    let payloadBytes: Uint8Array;
    try {
      payloadBytes = this.#options.encodePayload(request.kind, payload);
    } catch {
      throw new AgentGatewayRequestError("invalid payload");
    }
    if (!(payloadBytes instanceof Uint8Array))
      throw new AgentGatewayRequestError("invalid payload encoding");
    const payloadDigest =
      request.kind === "model"
        ? await hashAgentModelPayloadV1(payloadBytes)
        : await hashAgentMcpPayloadV1(payloadBytes);
    const authority = verified.authority;
    if (!sameFence(request.fence, authority.fence))
      throw new AgentGatewayAuthorizationError("supervision fence mismatch");
    const adapter = this.#options.adapterFor(request);
    if (!adapter)
      throw new AgentGatewayAuthorizationError("adapter unavailable");
    const transcriptAnchor =
      request.kind === "model"
        ? request.descriptor.transcript
        : this.#options.resolveTranscriptAnchor?.(request, payload);
    if (!transcriptAnchor)
      throw new AgentGatewayRequestError("missing transcript anchor");
    const identity = this.#provisionalIdentity(
      request,
      verified,
      payloadDigest,
      transcriptAnchor,
      adapter.id,
      adapter.version,
    );
    const authorization = this.#options.grants.authorize(
      request.dispatchGrant,
      grantExpectation(identity),
    );
    if (!authorization.authorized)
      throw new AgentGatewayAuthorizationError(authorization.reason);

    const existing = await this.#options.ledger.getExact(identity);
    if (
      existing?.receipt.state === "settled" ||
      existing?.receipt.state === "indeterminate"
    ) {
      await this.#settleActor(existing);
      return existing;
    }
    const admitted = await this.#options.admission.admit(identity);
    if (!admitted.accepted) throw new AgentGatewayAdmissionError();
    await this.#hit("after_admission", existing ?? synthetic(identity));
    const claim = await this.#options.ledger.claimPrepared(
      identity,
      this.#now(),
    );
    await this.#hit("after_prepared", claim.record);
    if (claim.record.receipt.state !== "prepared") {
      if (claim.record.receipt.state === "executing")
        throw new AgentGatewayInheritedExecutionError();
      await this.#settleActor(claim.record);
      return claim.record;
    }
    const executing = await this.#options.ledger.markExecuting(
      identity,
      this.#now(),
    );
    await this.#hit("after_executing", executing);
    const result = await adapter.execute(
      { descriptor: identity.descriptor, payload },
      signal,
    );
    const appended = await this.#options.appendTerminal(identity, result);
    await this.#hit("after_transcript_append", executing);
    const settlement: AgentOperationSettlement = {
      completedAtMs: this.#now(),
      outcome: result.outcome,
      transcriptRefs: appended.refs,
      kernelTerminal: appended.kernelTerminal,
      ...(result.providerRequestRef === undefined
        ? {}
        : { providerRequestRef: result.providerRequestRef }),
      ...(result.providerResponseRef === undefined
        ? {}
        : { providerResponseRef: result.providerResponseRef }),
    };
    const settled = await this.#options.ledger.settle(identity, settlement);
    await this.#hit("after_ledger_settlement", settled);
    await this.#settleActor(settled);
    await this.#hit("after_schema_settlement", settled);
    return settled;
  }

  #provisionalIdentity(
    request: AgentOperationRequestV1,
    verified: VerifiedAgentSupervision,
    payloadDigest: AgentOperationDigest,
    transcriptAnchor: AgentOperationIdentity["transcriptAnchor"],
    adapterId: string,
    adapterVersion: string,
  ): AgentOperationIdentity {
    const authority = verified.authority;
    return {
      operationId: request.operationId,
      kind: request.kind,
      fence: request.fence,
      planHash: authority.planHash as AgentOperationDigest,
      authorityHash: verified.authorityHash,
      supervisorEpoch: authority.supervisorEpoch,
      hostId: authority.hostId,
      hostGeneration: authority.hostGeneration,
      hostIncarnation: authority.hostIncarnation,
      transcriptAnchor,
      ...(request.kind === "mcp"
        ? { toolUseEntryId: request.descriptor.toolUseEntryId }
        : {}),
      descriptor: request.descriptor,
      descriptorDigest: request.descriptorDigest,
      payloadDigest,
      adapterId,
      adapterVersion,
    };
  }

  async #settleActor(record: AgentOperationRecord) {
    const terminal = record.receipt.kernelTerminal;
    if (!terminal)
      throw new AgentOperationConflictError("terminal actor evidence missing");
    const digest = await hashAgentOperationReceiptV1(record.receipt);
    if (record.receipt.state === "settled")
      await this.#options.admission.settle(record, digest, terminal);
    else if (record.receipt.state === "indeterminate")
      await this.#options.admission.indeterminate(record, digest, terminal);
  }
  #now() {
    const now = (this.#options.now ?? Date.now)();
    if (!Number.isSafeInteger(now) || now < 0)
      throw new TypeError("invalid gateway clock");
    return now;
  }
  async #hit(point: AgentGatewayFailpoint, record: AgentOperationRecord) {
    await this.#options.failpoint?.(point, record);
  }
  #serialize<T>(key: string, work: () => Promise<T>): Promise<T> {
    const prior = this.#mailboxes.get(key) ?? Promise.resolve();
    const next = prior.catch(() => undefined).then(work);
    this.#mailboxes.set(key, next);
    void next
      .finally(() => {
        if (this.#mailboxes.get(key) === next) this.#mailboxes.delete(key);
      })
      .catch(() => undefined);
    return next;
  }
}

function grantExpectation(
  identity: AgentOperationIdentity,
): AgentGatewayGrantExpectation {
  return {
    operationId: identity.operationId,
    kind: identity.kind,
    fence: identity.fence,
    planHash: identity.planHash,
    authorityHash: identity.authorityHash,
    supervisorEpoch: identity.supervisorEpoch,
    hostId: identity.hostId,
    hostGeneration: identity.hostGeneration,
    hostIncarnation: identity.hostIncarnation,
    descriptorDigest: identity.descriptorDigest,
    payloadDigest: identity.payloadDigest,
    transcriptAnchor: identity.transcriptAnchor,
    ...(identity.kind === "mcp"
      ? { toolUseEntryId: identity.toolUseEntryId! }
      : {}),
    adapterId: identity.adapterId,
    adapterVersion: identity.adapterVersion,
  };
}
function sameFence(
  a: AgentOperationRequestV1["fence"],
  b: AgentOperationRequestV1["fence"],
) {
  return (
    a.sessionId === b.sessionId &&
    a.runId === b.runId &&
    a.turnId === b.turnId &&
    a.generation === b.generation
  );
}
function keyForRequest(request: AgentOperationRequestV1) {
  return `${request.fence.sessionId}\0${request.operationId}`;
}
function keyFor(record: AgentOperationRecord) {
  return `${record.fence.sessionId}\0${record.operationId}`;
}
function indeterminateAppendId(operationId: string, reservationId: string) {
  return `agent-indeterminate:${operationId}:${reservationId}`;
}
function synthetic(identity: AgentOperationIdentity): AgentOperationRecord {
  return {
    ...identity,
    receipt: {
      version: 1,
      operationId: identity.operationId,
      kind: identity.kind,
      fence: identity.fence,
      planHash: identity.planHash,
      authorityHash: identity.authorityHash,
      descriptorDigest: identity.descriptorDigest,
      payloadDigest: identity.payloadDigest,
      actorIdentity: {
        supervisorEpoch: identity.supervisorEpoch,
        hostId: identity.hostId,
        hostGeneration: identity.hostGeneration,
        hostIncarnation: identity.hostIncarnation,
        transcriptAnchor: identity.transcriptAnchor,
        ...(identity.kind === "mcp"
          ? { toolUseEntryId: identity.toolUseEntryId }
          : {}),
      },
      state: "prepared",
      acceptedAtMs: 0,
      providerRef: {
        adapterId: identity.adapterId,
        adapterVersion: identity.adapterVersion,
      },
    },
  };
}
export class AgentGatewayRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AgentGatewayRequestError";
  }
}
export class AgentGatewayAuthorizationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AgentGatewayAuthorizationError";
  }
}
export class AgentGatewayAdmissionError extends Error {
  constructor() {
    super("agent operation admission rejected");
    this.name = "AgentGatewayAdmissionError";
  }
}
export class AgentGatewayInheritedExecutionError extends Error {
  constructor() {
    super("inherited executing operation requires recovery");
    this.name = "AgentGatewayInheritedExecutionError";
  }
}
