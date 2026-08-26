import {
  hashAgentMcpPayloadV1,
  hashAgentModelPayloadV1,
  hashAgentOperationDescriptorV1,
  type AgentOperationDescriptorV1,
  type AgentOperationDigest,
  type AgentOperationReceiptV1,
  type AgentTranscriptAnchorV1,
} from "@tellahq/opensession-protocol/agent-operation";
import type { AgentTurnFence } from "@tellahq/opensession-protocol/agent-host";
import type { SignedAgentHostSupervisionEnvelopeV1 } from "@tellahq/opensession-protocol/agent-host-supervision";
import type {
  AgentHostCancelIntent,
  AgentHostCancelResult,
  AgentHostDispatchIntent,
  AgentHostOperationResult,
  AgentHostOperationStreamAckIntent,
  AgentHostQueryIntent,
  AgentHostQueryResult,
} from "../agent-host-client";
import {
  AgentOperationGateway,
  type AgentOperationGatewayOptions,
  type VerifiedAgentSupervision,
} from "./gateway";
import {
  type AgentGatewayPolicyHandle,
  type AgentGatewayGrantRegistry,
} from "./grants";
import type { AgentOperationIdentity, AgentOperationRecord } from "./ledger";
import {
  AgentOperationStreamJournal,
  AgentOperationStreamRecoveryRequiredError,
} from "./stream-journal";

export interface AgentOperationPlan {
  readonly operationId: string;
  readonly fence: Readonly<AgentTurnFence>;
  readonly kind: "model" | "mcp";
  readonly descriptor: AgentOperationDescriptorV1;
  readonly descriptorDigest: AgentOperationDigest;
  readonly payload: unknown;
  readonly canonicalPayloadBytes: Uint8Array;
  readonly transcriptAnchor: Readonly<AgentTranscriptAnchorV1>;
  readonly toolUseEntryId?: string;
  readonly adapterId: string;
  readonly adapterVersion: string;
  readonly deadlineMs: number;
  readonly policyHandle: AgentGatewayPolicyHandle;
}
export interface AgentOperationCancellationFacade {
  request(
    identity: AgentOperationIdentity,
    cancelId: string,
    reason: AgentHostCancelIntent["reason"],
  ): Promise<"requested" | "too_late">;
}
export interface AgentOperationServiceOptions {
  readonly grants: AgentGatewayGrantRegistry;
  readonly gateway: Omit<
    AgentOperationGatewayOptions,
    "grants" | "beginLiveExecution" | "verifySupervision"
  >;
  readonly verifySupervision: (
    envelope: SignedAgentHostSupervisionEnvelopeV1,
    intent: Readonly<{
      operationId: string;
      fence: AgentTurnFence;
      kind: "model" | "mcp";
      descriptorDigest: AgentOperationDigest;
    }>,
  ) => Promise<VerifiedAgentSupervision | undefined>;
  readonly authorizedReceiptReader: (
    identity: Readonly<AgentOperationIdentity>,
  ) => Promise<AgentOperationRecord | undefined>;
  readonly cancellation: AgentOperationCancellationFacade;
  readonly closeOwners?: readonly (() => void | Promise<void>)[];
  readonly closeTimeoutMs?: number;
}
type Entry = {
  plan: AgentOperationPlan;
  identity?: AgentOperationIdentity;
  journal?: AgentOperationStreamJournal;
  controller?: AbortController;
  started?: {
    resolve: (record: AgentOperationRecord) => void;
    reject: (error: unknown) => void;
  };
  task?: Promise<AgentOperationRecord>;
};

/** Boot-owned, import-inert coordinator. Construction performs no I/O. */
export class AgentOperationService {
  readonly #options: AgentOperationServiceOptions;
  readonly #entries = new Map<string, Entry>();
  readonly #gateway: AgentOperationGateway;
  #ready = false;
  #recovering = false;
  #failed = false;
  #closing = false;
  constructor(options: AgentOperationServiceOptions) {
    this.#options = options;
    this.#gateway = new AgentOperationGateway({
      ...options.gateway,
      grants: options.grants,
      verifySupervision: async (envelope, request) =>
        options.verifySupervision(envelope, request),
      beginLiveExecution: async (record) => {
        const entry = this.#entries.get(key(record.fence, record.operationId));
        if (!entry) throw new Error("operation plan unavailable");
        const journal = (entry.journal ??= new AgentOperationStreamJournal());
        entry.identity = record;
        entry.started?.resolve(record);
        return journal;
      },
    });
  }
  async start(): Promise<void> {
    if (this.#ready) return;
    if (this.#closing) throw new Error("agent operation service is closing");
    this.#recovering = true;
    try {
      await this.#gateway.recoverActive();
      this.#ready = true;
    } catch (error) {
      this.#failed = true;
      throw error;
    } finally {
      this.#recovering = false;
    }
  }
  async registerPlan(input: Readonly<AgentOperationPlan>): Promise<void> {
    this.#admit();
    const plan = snapshotPlan(input);
    const descriptorDigest = await hashAgentOperationDescriptorV1(
      plan.descriptor,
    );
    if (
      descriptorDigest !== plan.descriptorDigest ||
      plan.kind !== plan.descriptor.kind
    )
      throw new Error("operation plan digest mismatch");
    const payloadDigest = await payloadHash(
      plan.kind,
      plan.canonicalPayloadBytes,
    );
    const planWithDigest = Object.freeze({
      ...plan,
      payloadDigest,
    }) as AgentOperationPlan & { payloadDigest: AgentOperationDigest };
    const id = key(plan.fence, plan.operationId);
    if (this.#entries.has(id))
      throw new Error("operation plan already registered");
    this.#entries.set(id, { plan: planWithDigest });
  }
  dispatchOperation = async (
    intent: Readonly<AgentHostDispatchIntent>,
    signal: AbortSignal,
  ): Promise<AgentHostOperationResult> => {
    this.#admit();
    const entry = this.#exact(intent);
    const verified = await this.#verify(intent);
    if (!verified) throw new Error("invalid supervision");
    const plan = entry.plan as AgentOperationPlan & {
      payloadDigest: AgentOperationDigest;
    };
    if (intent.deadlineMs !== plan.deadlineMs)
      throw new Error("operation deadline mismatch");
    const grant = this.#options.grants.issue({
      operationId: plan.operationId,
      kind: plan.kind,
      fence: plan.fence,
      planHash: verified.authority.planHash as AgentOperationDigest,
      authorityHash: verified.authorityHash,
      supervisorEpoch: verified.authority.supervisorEpoch,
      hostId: verified.authority.hostId,
      hostGeneration: verified.authority.hostGeneration,
      hostIncarnation: verified.authority.hostIncarnation,
      descriptorDigest: plan.descriptorDigest,
      payloadDigest: plan.payloadDigest,
      transcriptAnchor: plan.transcriptAnchor,
      ...(plan.toolUseEntryId ? { toolUseEntryId: plan.toolUseEntryId } : {}),
      adapterId: plan.adapterId,
      adapterVersion: plan.adapterVersion,
      deadlineMs: plan.deadlineMs,
      authorityExpiresAtMs: verified.authority.expiresAtMs,
      policyHandle: plan.policyHandle,
    });
    entry.controller = new AbortController();
    signal.addEventListener("abort", () => entry.controller?.abort(), {
      once: true,
    });
    const started = new Promise<AgentOperationRecord>((resolve, reject) => {
      entry.started = { resolve, reject };
    });
    entry.task = this.#gateway.dispatch(
      {
        version: 1,
        operationId: plan.operationId,
        kind: plan.kind,
        fence: plan.fence,
        supervisionEnvelope: intent.supervisionEnvelope,
        dispatchGrant: grant,
        descriptor: plan.descriptor,
        descriptorDigest: plan.descriptorDigest,
      },
      plan.payload,
      entry.controller.signal,
    );
    void entry.task.catch((error) => entry.started?.reject(error));
    const first = await Promise.race([
      started.then((record) => ({ live: record })),
      entry.task.then((record) => ({ terminal: record })),
    ]);
    const record = "live" in first ? first.live : first.terminal;
    entry.identity = record;
    return {
      receipt: record.receipt,
      ...(entry.journal ? { chunks: entry.journal.replay(0) } : {}),
    };
  };
  queryOperation = async (
    intent: Readonly<AgentHostQueryIntent>,
    _signal: AbortSignal,
  ): Promise<AgentHostQueryResult> => {
    this.#admit();
    const entry = this.#exact(intent);
    const verified = await this.#verify(intent);
    if (!verified) throw new Error("invalid supervision");
    entry.identity ??= identityFrom(
      entry.plan as AgentOperationPlan & {
        payloadDigest: AgentOperationDigest;
      },
      verified,
    );
    const record = await this.#options.authorizedReceiptReader(entry.identity);
    if (!record) throw new Error("operation not found");
    return {
      receipt: record.receipt,
      fromStreamSeq: intent.afterStreamSeq + 1,
      ...(entry.journal
        ? { chunks: entry.journal.replay(intent.afterStreamSeq) }
        : {}),
    };
  };
  cancelOperation = async (
    intent: Readonly<AgentHostCancelIntent>,
    _signal: AbortSignal,
  ): Promise<AgentHostCancelResult> => {
    this.#admit();
    const entry = this.#exact(intent);
    const verified = await this.#verify(intent);
    if (!verified) throw new Error("invalid supervision");
    const prephysical = !entry.task;
    entry.identity ??= identityFrom(
      entry.plan as AgentOperationPlan & {
        payloadDigest: AgentOperationDigest;
      },
      verified,
    );
    const durable = await this.#options.cancellation.request(
      entry.identity,
      intent.cancelId,
      intent.reason,
    );
    if (durable === "too_late") {
      const record = await this.#options.authorizedReceiptReader(
        entry.identity,
      );
      if (!record) throw new Error("operation not found");
      return { disposition: "too_late", receipt: record.receipt };
    }
    entry.controller?.abort();
    const record = await this.#options.authorizedReceiptReader(entry.identity);
    if (!record) throw new Error("operation not found");
    return {
      disposition: prephysical ? "not_started" : "indeterminate",
      receipt: record.receipt,
    };
  };
  acknowledgeOperationStream = async (
    intent: Readonly<AgentHostOperationStreamAckIntent>,
  ): Promise<void> => {
    this.#admit();
    const entry = this.#exact(intent);
    if (!entry.journal) throw new AgentOperationStreamRecoveryRequiredError();
    entry.journal.acknowledge(intent.throughStreamSeq);
  };
  healthSnapshot() {
    let replayBytes = 0,
      streams = 0,
      active = 0;
    for (const e of this.#entries.values()) {
      if (e.task) active++;
      if (e.journal) {
        streams++;
        replayBytes += e.journal.bytes;
      }
    }
    return Object.freeze({
      ready: this.#ready,
      recovering: this.#recovering,
      failed: this.#failed,
      activeOperations: active,
      activeStreams: streams,
      replayBytes,
      infrastructureFallback: false,
    });
  }
  async deleteSession(sessionId: string): Promise<number> {
    let count = 0;
    for (const [id, entry] of this.#entries)
      if (entry.plan.fence.sessionId === sessionId) {
        await entry.journal?.fail(new Error("session deleted"));
        entry.controller?.abort();
        this.#entries.delete(id);
        count++;
      }
    this.#options.grants.revokeSession(sessionId);
    return count;
  }
  async close(): Promise<void> {
    if (this.#closing) return;
    this.#closing = true;
    this.#ready = false;
    for (const e of this.#entries.values()) {
      e.controller?.abort();
      await e.journal?.fail(new Error("service closed"));
    }
    const tasks = [...this.#entries.values()].flatMap((e) =>
      e.task ? [e.task.catch(() => undefined)] : [],
    );
    const timeout = this.#options.closeTimeoutMs ?? 5_000;
    await Promise.race([
      Promise.all(tasks),
      new Promise<void>((resolve) => setTimeout(resolve, timeout)),
    ]);
    for (const close of this.#options.closeOwners ?? []) await close();
    this.#options.grants.clear();
    this.#entries.clear();
  }
  #admit() {
    if (!this.#ready || this.#closing || this.#failed)
      throw new Error("agent operation service is not ready");
  }
  #exact(intent: {
    operationId: string;
    fence: AgentTurnFence;
    kind: string;
    descriptorDigest: string;
  }) {
    const entry = this.#entries.get(key(intent.fence, intent.operationId));
    if (
      !entry ||
      entry.plan.kind !== intent.kind ||
      entry.plan.descriptorDigest !== intent.descriptorDigest ||
      !sameFence(entry.plan.fence, intent.fence)
    )
      throw new Error("operation plan mismatch");
    return entry;
  }
  #verify(
    intent:
      AgentHostDispatchIntent | AgentHostQueryIntent | AgentHostCancelIntent,
  ) {
    return this.#options.verifySupervision(intent.supervisionEnvelope, intent);
  }
}
function key(f: Readonly<AgentTurnFence>, operationId: string) {
  return `${f.sessionId}\0${f.runId}\0${f.turnId}\0${f.generation}\0${operationId}`;
}
function sameFence(a: Readonly<AgentTurnFence>, b: Readonly<AgentTurnFence>) {
  return (
    a.sessionId === b.sessionId &&
    a.runId === b.runId &&
    a.turnId === b.turnId &&
    a.generation === b.generation
  );
}
function payloadHash(kind: "model" | "mcp", bytes: Uint8Array) {
  return kind === "model"
    ? hashAgentModelPayloadV1(bytes)
    : hashAgentMcpPayloadV1(bytes);
}
function snapshotPlan(input: Readonly<AgentOperationPlan>): AgentOperationPlan {
  if (
    !(input.canonicalPayloadBytes instanceof Uint8Array) ||
    input.canonicalPayloadBytes.byteLength > 16 * 1024 * 1024
  )
    throw new TypeError("invalid canonical payload");
  return Object.freeze({
    ...input,
    fence: Object.freeze(structuredClone(input.fence)),
    descriptor: Object.freeze(structuredClone(input.descriptor)),
    payload: input.payload,
    canonicalPayloadBytes: input.canonicalPayloadBytes.slice(),
    transcriptAnchor: Object.freeze(structuredClone(input.transcriptAnchor)),
  });
}

function identityFrom(
  plan: AgentOperationPlan & { payloadDigest: AgentOperationDigest },
  verified: VerifiedAgentSupervision,
): AgentOperationIdentity {
  return {
    operationId: plan.operationId,
    kind: plan.kind,
    fence: plan.fence,
    planHash: verified.authority.planHash as AgentOperationDigest,
    authorityHash: verified.authorityHash,
    supervisorEpoch: verified.authority.supervisorEpoch,
    hostId: verified.authority.hostId,
    hostGeneration: verified.authority.hostGeneration,
    hostIncarnation: verified.authority.hostIncarnation,
    transcriptAnchor: plan.transcriptAnchor,
    ...(plan.toolUseEntryId ? { toolUseEntryId: plan.toolUseEntryId } : {}),
    descriptor: plan.descriptor,
    descriptorDigest: plan.descriptorDigest,
    payloadDigest: plan.payloadDigest,
    adapterId: plan.adapterId,
    adapterVersion: plan.adapterVersion,
  };
}
