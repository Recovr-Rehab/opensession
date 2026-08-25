import { describe, expect, test } from "bun:test";
import { SphereManager } from "./manager";
import type {
  CreateSphereResourceInput,
  CreatedSphereResource,
  EnsuredSphereExecutor,
  SphereProvider,
  SphereProviderId,
  SphereResourceRef,
} from "./provider";
import { SphereProviderRegistry } from "./registry";
import {
  InMemorySphereStateStore,
  type SphereRecord,
  type SphereStateStore,
} from "./state";

class FakeProvider implements SphereProvider {
  readonly id: SphereProviderId;
  readonly events: string[];
  managed: SphereResourceRef[] = [];
  createError?: Error;
  beforeCreate?: () => Promise<void> | void;
  beforeEnsure?: () => Promise<void> | void;
  beforeStart?: () => Promise<void> | void;

  constructor(id: SphereProviderId = "box", events: string[] = []) {
    this.id = id;
    this.events = events;
  }

  async create(
    input: CreateSphereResourceInput,
  ): Promise<CreatedSphereResource> {
    this.events.push(`create:${input.generation}`);
    await this.beforeCreate?.();
    if (this.createError) throw this.createError;
    return { resourceId: `resource-${this.id}`, workspaceId: "workspace-1" };
  }

  async inspect(): Promise<{ state: "awake" }> {
    return { state: "awake" };
  }

  async start(): Promise<void> {
    this.events.push("start");
    await this.beforeStart?.();
  }

  async stop(): Promise<void> {
    this.events.push("stop");
  }

  async destroy(): Promise<void> {
    this.events.push("destroy");
  }

  async ensureExecutor(): Promise<EnsuredSphereExecutor> {
    this.events.push("ensure");
    await this.beforeEnsure?.();
    return { executorId: "executor-1", workspaceId: "workspace-1" };
  }

  async listManaged(): Promise<readonly SphereResourceRef[]> {
    return this.managed;
  }
}

const project = {
  revision: "revision-1",
  baseCommit: "abc123",
  durableDelta: "delta-1",
};

function setup(
  options: {
    provider?: FakeProvider;
    store?: SphereStateStore;
    events?: string[];
    checkpoint?: () => Promise<any>;
  } = {},
) {
  const events = options.events ?? [];
  const provider = options.provider ?? new FakeProvider("box", events);
  const store = options.store ?? new InMemorySphereStateStore();
  const registry = new SphereProviderRegistry();
  registry.register(provider);
  const manager = new SphereManager({
    store,
    providers: registry,
    now: () => 1_000,
    revokeExecutionAuthority: async () => {
      events.push("revoke");
    },
    checkpointWorkspace:
      options.checkpoint ??
      (async () => ({ ...project, revision: "revision-2", durable: true })),
  });
  return { events, manager, provider, registry, store };
}

async function create(manager: SphereManager): Promise<SphereRecord> {
  return manager.create({
    sphereId: "sphere-1",
    sessionId: "session-1",
    provider: "box",
    project,
  });
}

describe("SphereManager", () => {
  test("writes durable intent before create and records the resource before executor setup", async () => {
    const backing = new InMemorySphereStateStore();
    const events: string[] = [];
    const store: SphereStateStore = {
      getBySphereId: (id) => backing.getBySphereId(id),
      getBySessionId: (id) => backing.getBySessionId(id),
      insertIntent: async (record) => {
        events.push("intent");
        await backing.insertIntent(record);
      },
      compareAndSwap: async (...args) => {
        events.push(args[2].resourceId ? "resource-recorded" : "cas");
        await backing.compareAndSwap(...args);
      },
      delete: (...args) => backing.delete(...args),
      appendAudit: (entry) => backing.appendAudit(entry),
    };
    const provider = new FakeProvider("box", events);
    provider.beforeCreate = async () => {
      expect((await backing.getBySphereId("sphere-1"))?.lifecycle).toBe(
        "preparing",
      );
    };
    provider.beforeEnsure = async () => {
      expect((await backing.getBySphereId("sphere-1"))?.resourceId).toBe(
        "resource-box",
      );
    };
    const { manager } = setup({ events, provider, store });

    const record = await create(manager);
    expect(record.lifecycle).toBe("awake");
    expect(events.slice(0, 5)).toEqual([
      "intent",
      "create:1",
      "resource-recorded",
      "ensure",
      "resource-recorded",
    ]);
  });

  test("retains a failed durable intent without inventing a resource", async () => {
    const provider = new FakeProvider();
    provider.createError = new Error("provider unavailable");
    const { manager, store } = setup({ provider });

    await expect(create(manager)).rejects.toThrow("provider unavailable");
    expect(await store.getBySphereId("sphere-1")).toMatchObject({
      lifecycle: "needs_attention",
      error: "provider unavailable",
      instanceGeneration: 1,
    });
    expect((await store.getBySphereId("sphere-1"))?.resourceId).toBeUndefined();
  });

  test("serializes concurrent wake and destroy and fences the stale request", async () => {
    let releaseStart!: () => void;
    let started!: () => void;
    const startEntered = new Promise<void>((resolve) => {
      started = resolve;
    });
    const startGate = new Promise<void>((resolve) => {
      releaseStart = resolve;
    });
    const provider = new FakeProvider();
    provider.beforeStart = async () => {
      started();
      await startGate;
    };
    const { manager, events } = setup({ provider });
    const awake = await create(manager);
    const sleeping = await manager.pause({
      sphereId: awake.sphereId,
      expectedGeneration: awake.instanceGeneration,
    });

    const wake = manager.wake({
      sphereId: sleeping.sphereId,
      expectedGeneration: sleeping.instanceGeneration,
    });
    await startEntered;
    const destroy = manager.destroy({
      sphereId: sleeping.sphereId,
      expectedGeneration: sleeping.instanceGeneration,
    });
    releaseStart();

    expect((await wake).lifecycle).toBe("awake");
    await expect(destroy).rejects.toThrow("stale Sphere generation");
    expect(events.filter((event) => event === "destroy")).toHaveLength(0);
  });

  test("rejects stale generations before provider effects", async () => {
    const { manager, events } = setup();
    const awake = await create(manager);
    const before = [...events];
    await expect(
      manager.pause({ sphereId: awake.sphereId, expectedGeneration: 99 }),
    ).rejects.toThrow("stale Sphere generation");
    expect(events).toEqual(before);
  });

  test("revokes execution authority before stop and destroy", async () => {
    const { manager, events } = setup();
    const awake = await create(manager);
    const sleeping = await manager.pause({
      sphereId: awake.sphereId,
      expectedGeneration: awake.instanceGeneration,
    });
    expect(events.indexOf("revoke")).toBeLessThan(events.indexOf("stop"));

    events.length = 0;
    await manager.destroy({
      sphereId: sleeping.sphereId,
      expectedGeneration: sleeping.instanceGeneration,
    });
    expect(events).toEqual(["revoke", "destroy"]);
  });

  test("blocks destructive rebuild without a durable checkpoint", async () => {
    const { manager, events } = setup({
      checkpoint: async () => ({ ...project, durable: false }),
    });
    const awake = await create(manager);
    events.length = 0;

    await expect(
      manager.rebuild({
        sphereId: awake.sphereId,
        expectedGeneration: awake.instanceGeneration,
      }),
    ).rejects.toThrow("durable workspace checkpoint");
    expect(events).toEqual([]);
  });

  test("records an operator audit marker for force destroy", async () => {
    const store = new InMemorySphereStateStore();
    const { manager } = setup({ store });
    const awake = await create(manager);

    await manager.forceDestroy({
      sphereId: awake.sphereId,
      expectedGeneration: awake.instanceGeneration,
      operatorId: "operator-1",
      reason: "remove orphaned billing resource",
    });
    expect(store.auditEntries()).toEqual([
      {
        sphereId: "sphere-1",
        generation: 2,
        action: "force_destroy",
        operatorId: "operator-1",
        reason: "remove orphaned billing resource",
        atMs: 1_000,
      },
    ]);
  });

  test("rejects unknown providers and never adopts legacy resources", async () => {
    const { manager, provider, registry } = setup();
    expect(() => registry.get("local-microvm")).toThrow("unknown");
    expect(() => registry.get("modal")).toThrow("unconfigured");

    provider.managed = [
      { sphereId: "legacy", resourceId: "legacy-resource", generation: 1 },
    ];
    await expect(
      manager.assertNoUnknownManagedResources("box"),
    ).rejects.toThrow("refusing to adopt unknown managed resource");
  });
});
