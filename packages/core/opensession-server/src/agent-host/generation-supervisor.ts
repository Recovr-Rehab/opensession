const DAY_MS = 24 * 60 * 60 * 1000;
const DIGEST_RE = /^[a-f0-9]{64}$/;
const TOKEN_RE = /^[A-Za-z0-9._:-]{1,128}$/;

export type AgentHostGenerationState =
  "admission-closed" | "eligible" | "active" | "draining" | "expired";

export interface AgentHostGenerationIdentity {
  readonly hostId: string;
  readonly generation: number;
  readonly incarnation: string;
}

export interface AgentHostGenerationManifest extends AgentHostGenerationIdentity {
  readonly releaseDigest: string;
  readonly protocolDigest: string;
  readonly keyringDigest: string;
  readonly recoveryLedgerId: string;
  readonly bornAtMs: number;
  readonly deadlineMs: number;
}

export interface AgentHostGenerationRecord extends AgentHostGenerationManifest {
  readonly state: AgentHostGenerationState;
  readonly healthy: boolean;
}

export interface AgentHostClock {
  nowMs(): number;
}

/** Persistence must implement the compare-and-swap atomically. */
export interface AgentHostAdmissionStorage {
  read(): Promise<unknown>;
  compareAndSwap(
    expectedRevision: number,
    next: PersistedAdmission,
  ): Promise<boolean>;
}

/** An injected controller. Implementations may use systemd; this module never does. */
export interface AgentHostSystemdController {
  startGeneration(manifest: AgentHostGenerationManifest): Promise<void>;
  stopGeneration(identity: AgentHostGenerationIdentity): Promise<void>;
}

export interface PersistedAdmission {
  readonly version: 1;
  readonly revision: number;
  readonly active: AgentHostGenerationManifest | null;
}

interface MutableGeneration {
  manifest: Readonly<AgentHostGenerationManifest>;
  state: AgentHostGenerationState;
  healthy: boolean;
}

const own = (value: object, key: PropertyKey): boolean =>
  Object.prototype.hasOwnProperty.call(value, key);

function isSafeTime(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function validIdentity(value: unknown): value is AgentHostGenerationIdentity {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return (
    Object.keys(candidate).length === 3 &&
    typeof candidate.hostId === "string" &&
    TOKEN_RE.test(candidate.hostId) &&
    Number.isSafeInteger(candidate.generation) &&
    (candidate.generation as number) >= 0 &&
    typeof candidate.incarnation === "string" &&
    TOKEN_RE.test(candidate.incarnation)
  );
}

function decodePersisted(value: unknown): PersistedAdmission | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return undefined;
  const candidate = value as Record<string, unknown>;
  if (
    Object.keys(candidate).length !== 3 ||
    !own(candidate, "version") ||
    !own(candidate, "revision") ||
    !own(candidate, "active") ||
    candidate.version !== 1 ||
    !Number.isSafeInteger(candidate.revision) ||
    (candidate.revision as number) < 0
  )
    return undefined;
  try {
    return Object.freeze({
      version: 1,
      revision: candidate.revision as number,
      active:
        candidate.active === null
          ? null
          : exactManifest(candidate.active as AgentHostGenerationManifest),
    });
  } catch {
    return undefined;
  }
}

function identityKey(identity: AgentHostGenerationIdentity): string {
  return JSON.stringify([
    identity.hostId,
    identity.generation,
    identity.incarnation,
  ]);
}

function sameIdentity(
  left: AgentHostGenerationIdentity,
  right: AgentHostGenerationIdentity,
): boolean {
  return (
    left.hostId === right.hostId &&
    left.generation === right.generation &&
    left.incarnation === right.incarnation
  );
}

const MANIFEST_KEYS = [
  "hostId",
  "generation",
  "incarnation",
  "releaseDigest",
  "protocolDigest",
  "keyringDigest",
  "recoveryLedgerId",
  "bornAtMs",
  "deadlineMs",
] as const;

function exactManifest(
  manifest: AgentHostGenerationManifest,
): Readonly<AgentHostGenerationManifest> {
  if (
    !manifest ||
    typeof manifest !== "object" ||
    Array.isArray(manifest) ||
    Object.keys(manifest).length !== MANIFEST_KEYS.length ||
    !Object.keys(manifest).every((key) =>
      MANIFEST_KEYS.includes(key as (typeof MANIFEST_KEYS)[number]),
    ) ||
    !validIdentity({
      hostId: manifest.hostId,
      generation: manifest.generation,
      incarnation: manifest.incarnation,
    }) ||
    typeof manifest.releaseDigest !== "string" ||
    !DIGEST_RE.test(manifest.releaseDigest) ||
    typeof manifest.protocolDigest !== "string" ||
    !DIGEST_RE.test(manifest.protocolDigest) ||
    typeof manifest.keyringDigest !== "string" ||
    !DIGEST_RE.test(manifest.keyringDigest) ||
    typeof manifest.recoveryLedgerId !== "string" ||
    !TOKEN_RE.test(manifest.recoveryLedgerId) ||
    !isSafeTime(manifest.bornAtMs) ||
    !isSafeTime(manifest.deadlineMs) ||
    manifest.deadlineMs <= manifest.bornAtMs ||
    manifest.deadlineMs - manifest.bornAtMs > DAY_MS
  )
    throw new Error("Invalid Agent Host generation manifest");
  return Object.freeze({ ...manifest });
}

function sameManifest(
  left: AgentHostGenerationManifest,
  right: AgentHostGenerationManifest,
): boolean {
  return MANIFEST_KEYS.every((key) => left[key] === right[key]);
}

/**
 * Import-inert blue/green generation authority. All effects are explicit and
 * injected. A generation's ledger ID is unique, so no two live generations can
 * be writers for the same recovery ledger.
 */
export class AgentHostGenerationSupervisor {
  private readonly generations = new Map<string, MutableGeneration>();
  private readonly ledgerOwners = new Map<string, string>();
  private readonly turnPins = new Map<string, string>();
  private activeKey: string | undefined;
  private persistedRevision: number | undefined;
  private mutationTail: Promise<void> = Promise.resolve();

  constructor(
    private readonly clock: AgentHostClock,
    private readonly storage: AgentHostAdmissionStorage,
    private readonly controller: AgentHostSystemdController,
  ) {}

  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.mutationTail.then(operation, operation);
    this.mutationTail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private expireDue(): void {
    const now = this.clock.nowMs();
    for (const [key, generation] of this.generations) {
      if (
        generation.state !== "expired" &&
        now >= generation.manifest.deadlineMs
      ) {
        generation.state = "expired";
        if (this.activeKey === key) this.activeKey = undefined;
      }
    }
  }

  private getExact(identity: AgentHostGenerationIdentity): MutableGeneration {
    const generation = this.generations.get(identityKey(identity));
    if (!generation || !sameIdentity(generation.manifest, identity))
      throw new Error("Stale Agent Host generation fence");
    this.expireDue();
    if (generation.state === "expired")
      throw new Error("Expired Agent Host generation fence");
    return generation;
  }

  async stage(
    manifestValue: AgentHostGenerationManifest,
  ): Promise<AgentHostGenerationRecord> {
    return this.serialize(async () => {
      const manifest = exactManifest(manifestValue);
      const key = identityKey(manifest);
      if (this.generations.has(key))
        throw new Error("Duplicate Agent Host generation");
      if (
        [...this.generations.values()].some(
          (entry) =>
            entry.manifest.hostId === manifest.hostId &&
            entry.manifest.generation === manifest.generation,
        )
      )
        throw new Error("Agent Host generation incarnation conflict");
      if (this.ledgerOwners.has(manifest.recoveryLedgerId))
        throw new Error("Agent Host recovery ledger already has a writer");
      if (this.clock.nowMs() >= manifest.deadlineMs)
        throw new Error("Cannot stage an expired Agent Host generation");

      await this.controller.startGeneration(manifest);
      this.generations.set(key, {
        manifest,
        state: "admission-closed",
        healthy: false,
      });
      this.ledgerOwners.set(manifest.recoveryLedgerId, key);
      return this.snapshot(key)!;
    });
  }

  markEligible(
    identity: AgentHostGenerationIdentity,
  ): AgentHostGenerationRecord {
    const generation = this.getExact(identity);
    if (
      generation.state !== "admission-closed" &&
      generation.state !== "eligible"
    )
      throw new Error("Agent Host generation cannot become eligible");
    generation.healthy = true;
    generation.state = "eligible";
    return this.snapshot(identityKey(identity))!;
  }

  async closeAdmission(identity: AgentHostGenerationIdentity): Promise<void> {
    return this.serialize(async () => {
      const generation = this.getExact(identity);
      generation.healthy = false;
      const wasActive = generation.state === "active";
      if (generation.state !== "draining")
        generation.state = "admission-closed";
      if (this.activeKey === identityKey(identity)) this.activeKey = undefined;
      if (wasActive) await this.persistActive(null);
    });
  }

  /** Fail closed unless the persisted exact incarnation is locally healthy and eligible. */
  async recoverAdmission(): Promise<AgentHostGenerationRecord | undefined> {
    return this.serialize(async () => {
      this.activeKey = undefined;
      for (const generation of this.generations.values()) {
        if (generation.state === "active")
          generation.state = "admission-closed";
      }
      const persisted = decodePersisted(await this.storage.read());
      if (!persisted) {
        this.persistedRevision = undefined;
        throw new Error("Invalid persisted Agent Host admission generation");
      }
      this.persistedRevision = persisted.revision;
      if (!persisted.active) return undefined;
      const key = identityKey(persisted.active);
      const generation = this.generations.get(key);
      this.expireDue();
      if (
        !generation ||
        !sameManifest(generation.manifest, persisted.active) ||
        generation.state !== "eligible" ||
        !generation.healthy
      ) {
        throw new Error(
          "Persisted Agent Host admission generation is unavailable",
        );
      }
      generation.state = "active";
      this.activeKey = key;
      return this.snapshot(key);
    });
  }

  private async persistActive(
    active: AgentHostGenerationManifest | null,
  ): Promise<void> {
    const persisted = decodePersisted(await this.storage.read());
    if (
      !persisted ||
      (this.persistedRevision !== undefined &&
        persisted.revision !== this.persistedRevision)
    ) {
      this.activeKey = undefined;
      throw new Error("Agent Host admission generation raced persistence");
    }
    const next: PersistedAdmission = Object.freeze({
      version: 1,
      revision: persisted.revision + 1,
      active: active ? exactManifest(active) : null,
    });
    if (!(await this.storage.compareAndSwap(persisted.revision, next))) {
      this.activeKey = undefined;
      throw new Error("Agent Host admission generation raced persistence");
    }
    this.persistedRevision = next.revision;
  }

  async promote(
    identity: AgentHostGenerationIdentity,
    options: { rollback?: boolean } = {},
  ): Promise<AgentHostGenerationRecord> {
    return this.serialize(async () => {
      const candidate = this.getExact(identity);
      const key = identityKey(identity);
      if (
        candidate.state !== "eligible" &&
        !(options.rollback && candidate.state === "draining")
      )
        throw new Error("Agent Host generation is not eligible for promotion");
      if (!candidate.healthy)
        throw new Error("Agent Host generation is unhealthy");
      const current = this.activeKey
        ? this.generations.get(this.activeKey)
        : undefined;
      if (options.rollback) {
        if (!current)
          throw new Error("Rollback requires an active Agent Host generation");
        if (
          candidate.manifest.protocolDigest !==
            current.manifest.protocolDigest ||
          candidate.manifest.keyringDigest !== current.manifest.keyringDigest
        )
          throw new Error("Incompatible Agent Host rollback generation");
      }
      await this.persistActive(candidate.manifest);
      if (current && this.activeKey !== key) current.state = "draining";
      candidate.state = "active";
      this.activeKey = key;
      return this.snapshot(key)!;
    });
  }

  admitNewTurn(turnKey: string): AgentHostGenerationRecord {
    if (!TOKEN_RE.test(turnKey)) throw new Error("Invalid Agent Host turn key");
    this.expireDue();
    if (!this.activeKey) throw new Error("Agent Host admission is closed");
    if (this.turnPins.has(turnKey))
      throw new Error("Agent Host turn is already pinned");
    const generation = this.generations.get(this.activeKey)!;
    if (generation.state !== "active" || !generation.healthy)
      throw new Error("Agent Host admission is closed");
    this.turnPins.set(turnKey, this.activeKey);
    return this.snapshot(this.activeKey)!;
  }

  targetForExistingTurn(
    turnKey: string,
    fence: AgentHostGenerationIdentity,
  ): AgentHostGenerationRecord {
    const pinned = this.turnPins.get(turnKey);
    if (!pinned || pinned !== identityKey(fence))
      throw new Error("Stale Agent Host generation fence");
    this.getExact(fence);
    return this.snapshot(pinned)!;
  }

  releaseTurn(turnKey: string, fence: AgentHostGenerationIdentity): boolean {
    const key = identityKey(fence);
    if (this.turnPins.get(turnKey) !== key) return false;
    this.turnPins.delete(turnKey);
    return true;
  }

  deletionBroadcastTargets(): readonly AgentHostGenerationRecord[] {
    this.expireDue();
    return Object.freeze(
      [...this.generations.entries()]
        .filter(
          ([, generation]) =>
            generation.state === "active" || generation.state === "draining",
        )
        .map(([key]) => this.snapshot(key)!),
    );
  }

  async retire(identity: AgentHostGenerationIdentity): Promise<void> {
    return this.serialize(async () => {
      const key = identityKey(identity);
      const generation = this.generations.get(key);
      if (!generation || !sameIdentity(generation.manifest, identity))
        throw new Error("Stale Agent Host generation fence");
      this.expireDue();
      if (
        generation.state === "active" ||
        [...this.turnPins.values()].includes(key)
      )
        throw new Error("Cannot retire an owned Agent Host generation");
      await this.controller.stopGeneration(identity);
      this.generations.delete(key);
      this.ledgerOwners.delete(generation.manifest.recoveryLedgerId);
    });
  }

  snapshot(
    identityOrKey: AgentHostGenerationIdentity | string,
  ): AgentHostGenerationRecord | undefined {
    this.expireDue();
    const generation = this.generations.get(
      typeof identityOrKey === "string"
        ? identityOrKey
        : identityKey(identityOrKey),
    );
    return generation
      ? Object.freeze({
          ...generation.manifest,
          state: generation.state,
          healthy: generation.healthy,
        })
      : undefined;
  }
}
