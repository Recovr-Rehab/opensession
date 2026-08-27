/**
 * Production-unwired, cross-owner Agent session deletion coordinator.
 *
 * The coordinator owns no mailbox and performs no I/O at import time. All
 * potentially physical/network work is delegated and awaited by the caller,
 * outside the SessionKernel mailbox. Durable checkpoints make every phase
 * replayable with the same deleteRequestId after a process crash.
 */

export const AGENT_DELETION_RECEIPT_RETENTION_MS = 7 * 24 * 60 * 60 * 1_000;

export const AGENT_DELETION_PHASES = [
  "stop_and_detach",
  "enumerate_pins",
  "delete_hosts",
  "settle_gateway",
  "verify_and_release_pins",
  "delete_transcript",
  "finish_kernel",
  "completed",
] as const;
export type AgentDeletionPhase = (typeof AGENT_DELETION_PHASES)[number];

export interface AgentDeletionFence {
  readonly generationId: string;
  /** The run generation is part of the fence, not merely informational. */
  readonly runGeneration: number;
}

export type AgentDeletionHostLedgerState = "active" | "draining" | "blocked";

export interface AgentDeletionHostTarget extends AgentDeletionFence {
  readonly hostId: string;
  readonly ledgerState: AgentDeletionHostLedgerState;
}

export interface AgentDeletionHostReceipt extends AgentDeletionHostTarget {
  readonly sessionId: string;
  readonly deleteRequestId: string;
  readonly disposition: "tombstoned" | "already_tombstoned";
  /** Canonical digest of the Host's durable tombstone, never prompt data. */
  readonly tombstoneDigest: `sha256:${string}`;
}

export interface AgentDeletionEnumeration {
  readonly pins: readonly AgentDeletionFence[];
  /** Includes every matching active, draining, and blocked durable Host ledger. */
  readonly hosts: readonly AgentDeletionHostTarget[];
}

export interface AgentDeletionPhaseReceipt {
  readonly phase: Exclude<AgentDeletionPhase, "completed">;
  readonly completedAtMs: number;
  /** Canonical, non-secret owner evidence. */
  readonly evidence: unknown;
}

export interface AgentDeletionRecord {
  readonly sessionId: string;
  readonly deleteRequestId: string;
  readonly createdAtMs: number;
  readonly updatedAtMs: number;
  readonly phase: AgentDeletionPhase;
  readonly receipts: readonly AgentDeletionPhaseReceipt[];
  readonly enumeration?: AgentDeletionEnumeration;
  readonly hostReceipts?: readonly AgentDeletionHostReceipt[];
  readonly completedAtMs?: number;
  readonly lastFailure?: Readonly<{
    phase: Exclude<AgentDeletionPhase, "completed">;
    failedAtMs: number;
    retryable: true;
    code: "owner_unavailable" | "invalid_receipt";
  }>;
}

/** Atomic create/checkpoint storage. Implementations must durably commit before returning. */
export interface AgentDeletionDurableStore {
  claim(input: Readonly<{
    sessionId: string;
    deleteRequestId: string;
    createdAtMs: number;
  }>): Promise<AgentDeletionRecord>;
  checkpoint(record: Readonly<AgentDeletionRecord>): Promise<AgentDeletionRecord>;
  /** Retain successful replay receipts for at least seven days. */
  cleanupCompleted(completedBeforeMs: number): Promise<number>;
}

export interface AgentDeletionOwners {
  stopLiveTurnAndDetachRoute(input: AgentDeletionIdentity): Promise<unknown>;
  enumeratePinsAndHosts(input: AgentDeletionIdentity): Promise<AgentDeletionEnumeration>;
  deleteFromHost(
    input: AgentDeletionIdentity & Readonly<{ target: AgentDeletionHostTarget }>,
  ): Promise<AgentDeletionHostReceipt>;
  settleGatewayPrivateRegistries(input: AgentDeletionIdentity): Promise<unknown>;
  settleOperationLedger(input: AgentDeletionIdentity): Promise<unknown>;
  verifyHostDeletionAndReleasePins(
    input: AgentDeletionIdentity &
      Readonly<{
        pins: readonly AgentDeletionFence[];
        hostReceipts: readonly AgentDeletionHostReceipt[];
      }>,
  ): Promise<unknown>;
  /** Actor-authoritative transcript delete plus wake-state reset. */
  deleteTranscriptAndResetWake(input: AgentDeletionIdentity): Promise<unknown>;
  /** Permanent kernel tombstone and remaining artifact cleanup. Always last. */
  tombstoneKernelAndFinishArtifacts(input: AgentDeletionIdentity): Promise<unknown>;
}

export interface AgentDeletionIdentity {
  readonly sessionId: string;
  readonly deleteRequestId: string;
}

export interface AgentDeletionResult {
  readonly ok: true;
  readonly sessionId: string;
  readonly deleteRequestId: string;
  readonly completedAtMs: number;
}

export interface AgentDeletionReadiness {
  readonly ready: boolean;
  readonly retryable: boolean;
  readonly failedPhase?: Exclude<AgentDeletionPhase, "completed">;
}

export class AgentDeletionReceiptError extends Error {
  readonly retryable = true;
  constructor(message: string) {
    super(message);
    this.name = "AgentDeletionReceiptError";
  }
}

export class AgentDeletionCoordinator {
  constructor(
    private readonly store: AgentDeletionDurableStore,
    private readonly owners: AgentDeletionOwners,
    private readonly now: () => number = Date.now,
  ) {}

  async deleteSession(identity: AgentDeletionIdentity): Promise<AgentDeletionResult> {
    validateIdentity(identity);
    let record = await this.store.claim({ ...identity, createdAtMs: this.now() });
    assertRecordIdentity(record, identity);
    if (record.phase === "completed") return success(record);

    try {
      if (record.phase === "stop_and_detach") {
        const evidence = await this.owners.stopLiveTurnAndDetachRoute(identity);
        record = await this.advance(record, "stop_and_detach", evidence, "enumerate_pins");
      }
      if (record.phase === "enumerate_pins") {
        const enumeration = canonicalEnumeration(
          await this.owners.enumeratePinsAndHosts(identity),
        );
        record = await this.advance(
          { ...record, enumeration },
          "enumerate_pins",
          enumeration,
          "delete_hosts",
        );
      }
      if (record.phase === "delete_hosts") {
        const enumeration = requireEnumeration(record);
        const receipts = await Promise.all(
          enumeration.hosts.map((target) =>
            this.owners.deleteFromHost({ ...identity, target }),
          ),
        );
        const canonical = canonicalHostReceipts(identity, enumeration.hosts, receipts);
        record = await this.advance(
          { ...record, hostReceipts: canonical },
          "delete_hosts",
          canonical,
          "settle_gateway",
        );
      }
      if (record.phase === "settle_gateway") {
        // Both owners are attempted even if one fails. A retry uses the same request id.
        const settled = await Promise.allSettled([
          this.owners.settleGatewayPrivateRegistries(identity),
          this.owners.settleOperationLedger(identity),
        ]);
        const rejected = settled.some((item) => item.status === "rejected");
        if (rejected) throw new Error("gateway deletion owners did not all settle");
        record = await this.advance(
          record,
          "settle_gateway",
          { registries: "settled", operationLedger: "settled" },
          "verify_and_release_pins",
        );
      }
      if (record.phase === "verify_and_release_pins") {
        const pins = requireEnumeration(record).pins;
        const hostReceipts = requireHostReceipts(record);
        const evidence = await this.owners.verifyHostDeletionAndReleasePins({
          ...identity,
          pins,
          hostReceipts,
        });
        record = await this.advance(
          record,
          "verify_and_release_pins",
          evidence,
          "delete_transcript",
        );
      }
      if (record.phase === "delete_transcript") {
        const evidence = await this.owners.deleteTranscriptAndResetWake(identity);
        record = await this.advance(
          record,
          "delete_transcript",
          evidence,
          "finish_kernel",
        );
      }
      if (record.phase === "finish_kernel") {
        const evidence = await this.owners.tombstoneKernelAndFinishArtifacts(identity);
        record = await this.advance(record, "finish_kernel", evidence, "completed");
      }
      return success(record);
    } catch (error) {
      const phase = record.phase;
      if (phase !== "completed") {
        const code = error instanceof AgentDeletionReceiptError
          ? "invalid_receipt"
          : "owner_unavailable";
        await this.store.checkpoint({
          ...record,
          updatedAtMs: this.now(),
          lastFailure: { phase, failedAtMs: this.now(), retryable: true, code },
        });
      }
      throw error;
    }
  }

  readiness(record: Readonly<AgentDeletionRecord>): AgentDeletionReadiness {
    return record.lastFailure && record.phase !== "completed"
      ? { ready: false, retryable: true, failedPhase: record.lastFailure.phase }
      : { ready: true, retryable: false };
  }

  cleanupExpiredSuccesses(): Promise<number> {
    return this.store.cleanupCompleted(this.now() - AGENT_DELETION_RECEIPT_RETENTION_MS);
  }

  private async advance(
    record: AgentDeletionRecord,
    phase: Exclude<AgentDeletionPhase, "completed">,
    evidence: unknown,
    next: AgentDeletionPhase,
  ): Promise<AgentDeletionRecord> {
    if (record.phase !== phase)
      throw new AgentDeletionReceiptError(`deletion phase changed before ${phase} checkpoint`);
    const completedAtMs = this.now();
    const updated: AgentDeletionRecord = {
      ...record,
      phase: next,
      updatedAtMs: completedAtMs,
      receipts: [...record.receipts, { phase, completedAtMs, evidence }],
      lastFailure: undefined,
      ...(next === "completed" ? { completedAtMs } : {}),
    };
    const stored = await this.store.checkpoint(updated);
    assertRecordIdentity(stored, record);
    return stored;
  }
}

function validateIdentity(identity: AgentDeletionIdentity): void {
  if (!identity.sessionId || !identity.deleteRequestId)
    throw new TypeError("sessionId and deleteRequestId are required");
}

function assertRecordIdentity(
  record: Pick<AgentDeletionRecord, "sessionId" | "deleteRequestId">,
  identity: AgentDeletionIdentity,
): void {
  if (
    record.sessionId !== identity.sessionId ||
    record.deleteRequestId !== identity.deleteRequestId
  ) throw new AgentDeletionReceiptError("durable deletion identity mismatch");
}

function canonicalEnumeration(value: AgentDeletionEnumeration): AgentDeletionEnumeration {
  const pins = uniqueSorted(value.pins, fenceKey);
  const hosts = uniqueSorted(value.hosts, hostKey);
  for (const fence of [...pins, ...hosts]) assertFence(fence);
  return Object.freeze({ pins: Object.freeze(pins), hosts: Object.freeze(hosts) });
}

function canonicalHostReceipts(
  identity: AgentDeletionIdentity,
  targets: readonly AgentDeletionHostTarget[],
  receipts: readonly AgentDeletionHostReceipt[],
): readonly AgentDeletionHostReceipt[] {
  if (receipts.length !== targets.length)
    throw new AgentDeletionReceiptError("incomplete Host deletion receipts");
  const byTarget = new Map(receipts.map((receipt) => [hostKey(receipt), receipt]));
  const canonical = targets.map((target) => {
    const receipt = byTarget.get(hostKey(target));
    if (
      !receipt ||
      receipt.sessionId !== identity.sessionId ||
      receipt.deleteRequestId !== identity.deleteRequestId ||
      receipt.hostId !== target.hostId ||
      receipt.generationId !== target.generationId ||
      receipt.runGeneration !== target.runGeneration ||
      receipt.ledgerState !== target.ledgerState ||
      !/^sha256:[a-f0-9]{64}$/.test(receipt.tombstoneDigest)
    ) throw new AgentDeletionReceiptError("stale or invalid Host deletion receipt");
    return receipt;
  });
  if (byTarget.size !== targets.length)
    throw new AgentDeletionReceiptError("unexpected Host deletion receipt");
  return Object.freeze(canonical);
}

function requireEnumeration(record: AgentDeletionRecord): AgentDeletionEnumeration {
  if (!record.enumeration)
    throw new AgentDeletionReceiptError("durable deletion enumeration is missing");
  return canonicalEnumeration(record.enumeration);
}

function requireHostReceipts(record: AgentDeletionRecord): readonly AgentDeletionHostReceipt[] {
  if (!record.hostReceipts)
    throw new AgentDeletionReceiptError("durable Host receipts are missing");
  return canonicalHostReceipts(
    record,
    requireEnumeration(record).hosts,
    record.hostReceipts,
  );
}

function assertFence(fence: AgentDeletionFence): void {
  if (!fence.generationId || !Number.isSafeInteger(fence.runGeneration) || fence.runGeneration < 0)
    throw new AgentDeletionReceiptError("invalid Agent deletion generation fence");
}

function fenceKey(value: AgentDeletionFence): string {
  return `${value.generationId}\u0000${value.runGeneration}`;
}
function hostKey(value: AgentDeletionHostTarget): string {
  return `${value.hostId}\u0000${value.ledgerState}\u0000${fenceKey(value)}`;
}
function uniqueSorted<T>(values: readonly T[], key: (value: T) => string): T[] {
  const map = new Map<string, T>();
  for (const value of values) {
    const id = key(value);
    if (map.has(id)) throw new AgentDeletionReceiptError("duplicate deletion owner fence");
    map.set(id, value);
  }
  return [...map.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, value]) => value);
}
function success(record: AgentDeletionRecord): AgentDeletionResult {
  if (record.phase !== "completed" || record.completedAtMs === undefined)
    throw new AgentDeletionReceiptError("deletion is not complete");
  return Object.freeze({
    ok: true,
    sessionId: record.sessionId,
    deleteRequestId: record.deleteRequestId,
    completedAtMs: record.completedAtMs,
  });
}
