import type { SphereProviderId } from "./provider";

export type SphereLifecycle =
  "preparing" | "awake" | "sleeping" | "waking" | "needs_attention";

export interface SphereProjectState {
  revision: string;
  baseCommit: string;
  durableDelta: string;
}

export interface SphereRecord {
  sphereId: string;
  sessionId: string;
  provider: SphereProviderId;
  resourceId?: string;
  executorId?: string;
  workspaceId?: string;
  instanceGeneration: number;
  lifecycle: SphereLifecycle;
  project: SphereProjectState;
  createdAtMs: number;
  updatedAtMs: number;
  error?: string;
}

export interface SphereAuditEntry {
  sphereId: string;
  generation: number;
  action: "force_destroy";
  operatorId: string;
  reason: string;
  atMs: number;
}

/** Persistence boundary. Implementations must make each operation durable and atomic. */
export interface SphereStateStore {
  getBySphereId(sphereId: string): Promise<SphereRecord | undefined>;
  getBySessionId(sessionId: string): Promise<SphereRecord | undefined>;
  insertIntent(record: SphereRecord): Promise<void>;
  compareAndSwap(
    sphereId: string,
    expectedGeneration: number,
    next: SphereRecord,
  ): Promise<void>;
  delete(sphereId: string, expectedGeneration: number): Promise<void>;
  appendAudit(entry: SphereAuditEntry): Promise<void>;
}

export class SphereStateConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SphereStateConflictError";
  }
}

/** Deterministic in-memory store for lifecycle tests. It performs no background work. */
export class InMemorySphereStateStore implements SphereStateStore {
  readonly #bySphere = new Map<string, SphereRecord>();
  readonly #sphereBySession = new Map<string, string>();
  readonly #audit: SphereAuditEntry[] = [];

  async getBySphereId(sphereId: string): Promise<SphereRecord | undefined> {
    return cloneRecord(this.#bySphere.get(sphereId));
  }

  async getBySessionId(sessionId: string): Promise<SphereRecord | undefined> {
    const sphereId = this.#sphereBySession.get(sessionId);
    return sphereId ? cloneRecord(this.#bySphere.get(sphereId)) : undefined;
  }

  async insertIntent(record: SphereRecord): Promise<void> {
    assertRecord(record);
    if (this.#bySphere.has(record.sphereId)) {
      throw new SphereStateConflictError(
        `sphere ${record.sphereId} already exists`,
      );
    }
    if (this.#sphereBySession.has(record.sessionId)) {
      throw new SphereStateConflictError(
        `session ${record.sessionId} already has a sphere`,
      );
    }
    this.#bySphere.set(record.sphereId, cloneRecord(record)!);
    this.#sphereBySession.set(record.sessionId, record.sphereId);
  }

  async compareAndSwap(
    sphereId: string,
    expectedGeneration: number,
    next: SphereRecord,
  ): Promise<void> {
    assertRecord(next);
    const current = this.#bySphere.get(sphereId);
    if (!current || current.instanceGeneration !== expectedGeneration) {
      throw new SphereStateConflictError(
        `sphere ${sphereId} generation is stale (expected ${expectedGeneration})`,
      );
    }
    if (next.sphereId !== sphereId || next.sessionId !== current.sessionId) {
      throw new SphereStateConflictError(
        "sphere and session identity are immutable",
      );
    }
    if (next.instanceGeneration < expectedGeneration) {
      throw new SphereStateConflictError("sphere generation cannot decrease");
    }
    this.#bySphere.set(sphereId, cloneRecord(next)!);
  }

  async delete(sphereId: string, expectedGeneration: number): Promise<void> {
    const current = this.#bySphere.get(sphereId);
    if (!current || current.instanceGeneration !== expectedGeneration) {
      throw new SphereStateConflictError(
        `sphere ${sphereId} generation is stale (expected ${expectedGeneration})`,
      );
    }
    this.#bySphere.delete(sphereId);
    this.#sphereBySession.delete(current.sessionId);
  }

  async appendAudit(entry: SphereAuditEntry): Promise<void> {
    this.#audit.push({ ...entry });
  }

  auditEntries(): readonly SphereAuditEntry[] {
    return this.#audit.map((entry) => ({ ...entry }));
  }
}

function cloneRecord(
  record: SphereRecord | undefined,
): SphereRecord | undefined {
  return record ? { ...record, project: { ...record.project } } : undefined;
}

function assertRecord(record: SphereRecord): void {
  if (
    !record.sphereId ||
    !record.sessionId ||
    !Number.isSafeInteger(record.instanceGeneration) ||
    record.instanceGeneration < 1 ||
    !Number.isSafeInteger(record.createdAtMs) ||
    !Number.isSafeInteger(record.updatedAtMs)
  ) {
    throw new TypeError("invalid sphere record");
  }
}
