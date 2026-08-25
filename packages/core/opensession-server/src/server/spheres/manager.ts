import { beginTransition, settleTransition } from "./lifecycle";
import type {
  CreatedSphereResource,
  SphereProvider,
  SphereProviderId,
  SphereResourceRef,
} from "./provider";
import { SphereProviderRegistry } from "./registry";
import {
  type SphereProjectState,
  type SphereRecord,
  type SphereStateStore,
} from "./state";

export interface RevokeSphereAuthorityInput {
  sphereId: string;
  executorId?: string;
  throughGeneration: number;
}

export interface DurableWorkspaceCheckpoint extends SphereProjectState {
  durable: true;
}

export interface SphereManagerDependencies {
  store: SphereStateStore;
  providers: SphereProviderRegistry;
  revokeExecutionAuthority(input: RevokeSphereAuthorityInput): Promise<void>;
  checkpointWorkspace(
    record: SphereRecord,
  ): Promise<DurableWorkspaceCheckpoint>;
  now?: () => number;
}

export interface CreateSphereInput {
  sphereId: string;
  sessionId: string;
  provider: SphereProviderId;
  project: SphereProjectState;
}

export interface SphereTransitionInput {
  sphereId: string;
  expectedGeneration: number;
}

export interface RebuildSphereInput extends SphereTransitionInput {
  provider?: SphereProviderId;
}

export interface ForceDestroySphereInput extends SphereTransitionInput {
  operatorId: string;
  reason: string;
}

export class UnknownManagedSphereResourceError extends Error {
  constructor(resourceId: string) {
    super(`refusing to adopt unknown managed resource: ${resourceId}`);
    this.name = "UnknownManagedSphereResourceError";
  }
}

/** Provider-neutral lifecycle coordinator. It is inert until constructed and called. */
export class SphereManager {
  readonly #store: SphereStateStore;
  readonly #providers: SphereProviderRegistry;
  readonly #revokeExecutionAuthority: SphereManagerDependencies["revokeExecutionAuthority"];
  readonly #checkpointWorkspace: SphereManagerDependencies["checkpointWorkspace"];
  readonly #now: () => number;
  readonly #queues = new Map<string, Promise<void>>();

  constructor(dependencies: SphereManagerDependencies) {
    this.#store = dependencies.store;
    this.#providers = dependencies.providers;
    this.#revokeExecutionAuthority = dependencies.revokeExecutionAuthority;
    this.#checkpointWorkspace = dependencies.checkpointWorkspace;
    this.#now = dependencies.now ?? Date.now;
  }

  create(input: CreateSphereInput): Promise<SphereRecord> {
    return this.#serialized(input.sphereId, async () => {
      assertIdentity(input.sphereId, "sphereId");
      assertIdentity(input.sessionId, "sessionId");
      const provider = this.#providers.get(input.provider);
      const now = this.#now();
      const intent: SphereRecord = {
        sphereId: input.sphereId,
        sessionId: input.sessionId,
        provider: input.provider,
        instanceGeneration: 1,
        lifecycle: "preparing",
        project: { ...input.project },
        createdAtMs: now,
        updatedAtMs: now,
      };
      // This durable write is intentionally before the provider call.
      await this.#store.insertIntent(intent);
      try {
        const created = await provider.create({
          sphereId: intent.sphereId,
          sessionId: intent.sessionId,
          generation: intent.instanceGeneration,
        });
        const attached = await this.#recordCreatedResource(intent, created);
        return await this.#ensureAndSettle(provider, attached);
      } catch (error) {
        await this.#recordFailureIfCurrent(
          intent.sphereId,
          intent.instanceGeneration,
          error,
        );
        throw error;
      }
    });
  }

  wake(input: SphereTransitionInput): Promise<SphereRecord> {
    return this.#serialized(input.sphereId, async () => {
      const current = await this.#expect(input);
      if (current.lifecycle !== "sleeping" || !current.resourceId) {
        throw new Error("only a sleeping Sphere with a resource can wake");
      }
      const provider = this.#providers.get(current.provider);
      const transition = beginTransition(current, "waking", this.#now());
      await this.#store.compareAndSwap(
        current.sphereId,
        current.instanceGeneration,
        transition,
      );
      try {
        await provider.start(resourceRef(transition));
        return await this.#ensureAndSettle(provider, transition);
      } catch (error) {
        await this.#recordFailureIfCurrent(
          transition.sphereId,
          transition.instanceGeneration,
          error,
        );
        throw error;
      }
    });
  }

  pause(input: SphereTransitionInput): Promise<SphereRecord> {
    return this.#serialized(input.sphereId, async () => {
      const current = await this.#expect(input);
      if (current.lifecycle !== "awake" || !current.resourceId) {
        throw new Error("only an awake Sphere with a resource can pause");
      }
      const provider = this.#providers.get(current.provider);
      const transition = beginTransition(current, "preparing", this.#now());
      await this.#store.compareAndSwap(
        current.sphereId,
        current.instanceGeneration,
        transition,
      );
      try {
        await this.#revoke(transition);
        await provider.stop(resourceRef(transition));
        const sleeping = settleTransition(transition, "sleeping", this.#now());
        await this.#store.compareAndSwap(
          transition.sphereId,
          transition.instanceGeneration,
          sleeping,
        );
        return sleeping;
      } catch (error) {
        await this.#recordFailureIfCurrent(
          transition.sphereId,
          transition.instanceGeneration,
          error,
        );
        throw error;
      }
    });
  }

  destroy(input: SphereTransitionInput): Promise<void> {
    return this.#destroy(input, undefined);
  }

  forceDestroy(input: ForceDestroySphereInput): Promise<void> {
    if (!input.operatorId.trim() || !input.reason.trim()) {
      return Promise.reject(
        new Error("forceDestroy requires an operator and reason"),
      );
    }
    return this.#destroy(input, {
      operatorId: input.operatorId,
      reason: input.reason,
    });
  }

  rebuild(input: RebuildSphereInput): Promise<SphereRecord> {
    return this.#serialized(input.sphereId, async () => {
      const current = await this.#expect(input);
      const replacement = this.#providers.get(
        input.provider ?? current.provider,
      );
      const checkpoint = await this.#checkpointWorkspace(current);
      assertDurableCheckpoint(checkpoint);

      const transition: SphereRecord = {
        ...beginTransition(current, "preparing", this.#now()),
        provider: replacement.id,
        project: {
          revision: checkpoint.revision,
          baseCommit: checkpoint.baseCommit,
          durableDelta: checkpoint.durableDelta,
        },
      };
      await this.#store.compareAndSwap(
        current.sphereId,
        current.instanceGeneration,
        transition,
      );
      try {
        await this.#revoke(transition);
        if (current.resourceId) {
          const oldProvider = this.#providers.get(current.provider);
          await oldProvider.destroy(resourceRef(transition));
        }
        // Persist the replacement intent with no old provider resource before create.
        const replacementIntent: SphereRecord = {
          ...transition,
          resourceId: undefined,
          executorId: undefined,
          workspaceId: undefined,
          updatedAtMs: this.#now(),
        };
        await this.#store.compareAndSwap(
          transition.sphereId,
          transition.instanceGeneration,
          replacementIntent,
        );
        const created = await replacement.create({
          sphereId: replacementIntent.sphereId,
          sessionId: replacementIntent.sessionId,
          generation: replacementIntent.instanceGeneration,
        });
        const attached = await this.#recordCreatedResource(
          replacementIntent,
          created,
        );
        return await this.#ensureAndSettle(replacement, attached);
      } catch (error) {
        await this.#recordFailureIfCurrent(
          transition.sphereId,
          transition.instanceGeneration,
          error,
        );
        throw error;
      }
    });
  }

  async assertNoUnknownManagedResources(
    providerId: SphereProviderId,
  ): Promise<void> {
    const provider = this.#providers.get(providerId);
    for (const resource of await provider.listManaged()) {
      const record = await this.#store.getBySphereId(resource.sphereId);
      if (
        !record ||
        record.provider !== providerId ||
        record.resourceId !== resource.resourceId
      ) {
        throw new UnknownManagedSphereResourceError(resource.resourceId);
      }
    }
  }

  #destroy(
    input: SphereTransitionInput,
    force: { operatorId: string; reason: string } | undefined,
  ): Promise<void> {
    return this.#serialized(input.sphereId, async () => {
      const current = await this.#expect(input);
      const provider = this.#providers.get(current.provider);
      const transition = beginTransition(current, "preparing", this.#now());
      await this.#store.compareAndSwap(
        current.sphereId,
        current.instanceGeneration,
        transition,
      );
      if (force) {
        await this.#store.appendAudit({
          sphereId: transition.sphereId,
          generation: transition.instanceGeneration,
          action: "force_destroy",
          operatorId: force.operatorId,
          reason: force.reason,
          atMs: this.#now(),
        });
      }
      try {
        await this.#revoke(transition);
        if (transition.resourceId) {
          await provider.destroy(resourceRef(transition));
        }
        await this.#store.delete(
          transition.sphereId,
          transition.instanceGeneration,
        );
      } catch (error) {
        await this.#recordFailureIfCurrent(
          transition.sphereId,
          transition.instanceGeneration,
          error,
        );
        throw error;
      }
    });
  }

  async #expect(input: SphereTransitionInput): Promise<SphereRecord> {
    const record = await this.#store.getBySphereId(input.sphereId);
    if (!record) throw new Error(`Sphere ${input.sphereId} does not exist`);
    if (record.instanceGeneration !== input.expectedGeneration) {
      throw new Error(
        `stale Sphere generation: expected ${input.expectedGeneration}, current ${record.instanceGeneration}`,
      );
    }
    return record;
  }

  async #recordCreatedResource(
    record: SphereRecord,
    created: CreatedSphereResource,
  ): Promise<SphereRecord> {
    if (!created.resourceId || !created.workspaceId) {
      throw new Error("provider returned an invalid Sphere resource");
    }
    const attached: SphereRecord = {
      ...record,
      resourceId: created.resourceId,
      workspaceId: created.workspaceId,
      updatedAtMs: this.#now(),
    };
    await this.#store.compareAndSwap(
      record.sphereId,
      record.instanceGeneration,
      attached,
    );
    return attached;
  }

  async #ensureAndSettle(
    provider: SphereProvider,
    record: SphereRecord,
  ): Promise<SphereRecord> {
    const executor = await provider.ensureExecutor(resourceRef(record));
    const awake = settleTransition(
      {
        ...record,
        executorId: executor.executorId,
        workspaceId: executor.workspaceId,
      },
      "awake",
      this.#now(),
    );
    await this.#store.compareAndSwap(
      record.sphereId,
      record.instanceGeneration,
      awake,
    );
    return awake;
  }

  async #revoke(record: SphereRecord): Promise<void> {
    await this.#revokeExecutionAuthority({
      sphereId: record.sphereId,
      executorId: record.executorId,
      throughGeneration: record.instanceGeneration,
    });
  }

  async #recordFailureIfCurrent(
    sphereId: string,
    generation: number,
    error: unknown,
  ): Promise<void> {
    const current = await this.#store.getBySphereId(sphereId);
    if (!current || current.instanceGeneration !== generation) return;
    const failed = settleTransition(
      current,
      "needs_attention",
      this.#now(),
      errorMessage(error),
    );
    await this.#store.compareAndSwap(sphereId, generation, failed);
  }

  #serialized<T>(sphereId: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.#queues.get(sphereId) ?? Promise.resolve();
    const result = previous.catch(() => undefined).then(operation);
    const tail = result.then(
      () => undefined,
      () => undefined,
    );
    this.#queues.set(sphereId, tail);
    void tail.finally(() => {
      if (this.#queues.get(sphereId) === tail) this.#queues.delete(sphereId);
    });
    return result;
  }
}

function resourceRef(record: SphereRecord): SphereResourceRef {
  if (!record.resourceId) throw new Error("Sphere has no provider resource");
  return {
    resourceId: record.resourceId,
    sphereId: record.sphereId,
    generation: record.instanceGeneration,
  };
}

function assertDurableCheckpoint(checkpoint: DurableWorkspaceCheckpoint): void {
  if (
    checkpoint?.durable !== true ||
    !checkpoint.revision ||
    !checkpoint.baseCommit ||
    !checkpoint.durableDelta
  ) {
    throw new Error(
      "destructive rebuild requires a durable workspace checkpoint",
    );
  }
}

function assertIdentity(value: string, name: string): void {
  if (!value.trim()) throw new TypeError(`${name} is required`);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
