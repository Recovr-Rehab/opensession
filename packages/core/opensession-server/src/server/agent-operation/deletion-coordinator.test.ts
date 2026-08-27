import { describe, expect, test } from "bun:test";
import {
  AGENT_DELETION_PHASES,
  AGENT_DELETION_RECEIPT_RETENTION_MS,
  AgentDeletionCoordinator,
  AgentDeletionReceiptError,
  type AgentDeletionDurableStore,
  type AgentDeletionHostReceipt,
  type AgentDeletionHostTarget,
  type AgentDeletionOwners,
  type AgentDeletionRecord,
} from "./deletion-coordinator";

const identity = { sessionId: "os-session", deleteRequestId: "delete-exact-1" };
const digest = `sha256:${"a".repeat(64)}` as const;

class MemoryStore implements AgentDeletionDurableStore {
  record?: AgentDeletionRecord;
  checkpoints = 0;
  failCheckpoint?: number;
  cleanupBefore?: number;
  async claim(input: { sessionId: string; deleteRequestId: string; createdAtMs: number }) {
    return this.record ??= {
      ...input,
      updatedAtMs: input.createdAtMs,
      phase: "stop_and_detach",
      receipts: [],
    };
  }
  async checkpoint(record: AgentDeletionRecord) {
    this.checkpoints++;
    if (this.checkpoints === this.failCheckpoint) throw new Error("crash");
    this.record = structuredClone(record);
    return structuredClone(record);
  }
  async cleanupCompleted(before: number) {
    this.cleanupBefore = before;
    return 1;
  }
}

function fixture(options: { hosts?: AgentDeletionHostTarget[]; fail?: string } = {}) {
  const calls: string[] = [];
  const hosts = options.hosts ?? [];
  const invoke = async (name: string, value: unknown = { owner: name }) => {
    calls.push(name);
    if (options.fail === name) throw new Error(`${name} unavailable`);
    return value;
  };
  const owners: AgentDeletionOwners = {
    stopLiveTurnAndDetachRoute: () => invoke("stop"),
    enumeratePinsAndHosts: () => invoke("enumerate", {
      pins: hosts.map(({ generationId, runGeneration }) => ({ generationId, runGeneration })),
      hosts,
    }) as never,
    deleteFromHost: ({ target, ...request }) => invoke(`host:${target.hostId}`, {
      ...request,
      ...target,
      disposition: "tombstoned",
      tombstoneDigest: digest,
    }) as Promise<AgentDeletionHostReceipt>,
    settleGatewayPrivateRegistries: () => invoke("registries"),
    settleOperationLedger: () => invoke("ledger"),
    verifyHostDeletionAndReleasePins: () => invoke("release"),
    deleteTranscriptAndResetWake: () => invoke("transcript"),
    tombstoneKernelAndFinishArtifacts: () => invoke("kernel"),
  };
  return { calls, owners };
}

for (const state of ["idle", "active", "reconnecting", "recovering"] as const) {
  test(`deletes an ${state} session in owner order and replays exact success`, async () => {
    const store = new MemoryStore();
    const { calls, owners } = fixture();
    const coordinator = new AgentDeletionCoordinator(store, owners, () => 100);
    const first = await coordinator.deleteSession(identity);
    const replay = await coordinator.deleteSession(identity);
    expect(replay).toEqual(first);
    expect(calls).toEqual([
      "stop", "enumerate", "registries", "ledger", "release", "transcript", "kernel",
    ]);
    expect(store.record?.receipts.map((receipt) => receipt.phase)).toEqual([
      "stop_and_detach",
      "enumerate_pins",
      "delete_hosts",
      "settle_gateway",
      "verify_and_release_pins",
      "delete_transcript",
      "finish_kernel",
    ]);
  });
}

test("keeps exact multi-generation and run-generation fences through Host verification", async () => {
  const hosts: AgentDeletionHostTarget[] = [
    { hostId: "host-a", ledgerState: "active", generationId: "gen-2", runGeneration: 9 },
    { hostId: "host-b", ledgerState: "draining", generationId: "gen-1", runGeneration: 3 },
    { hostId: "host-c", ledgerState: "blocked", generationId: "gen-2", runGeneration: 8 },
  ];
  const store = new MemoryStore();
  const { owners } = fixture({ hosts });
  let verified: unknown;
  owners.verifyHostDeletionAndReleasePins = async (input) => (verified = input);
  await new AgentDeletionCoordinator(store, owners, () => 5).deleteSession(identity);
  expect((verified as any).pins).toEqual([
    { generationId: "gen-1", runGeneration: 3 },
    { generationId: "gen-2", runGeneration: 8 },
    { generationId: "gen-2", runGeneration: 9 },
  ]);
  expect((verified as any).hostReceipts).toHaveLength(3);
});

test("rejects a stale Host receipt and leaves red retryable readiness", async () => {
  const target: AgentDeletionHostTarget = {
    hostId: "host-a", ledgerState: "active", generationId: "gen", runGeneration: 2,
  };
  const store = new MemoryStore();
  const { owners } = fixture({ hosts: [target] });
  owners.deleteFromHost = async ({ target }) => ({
    ...target,
    sessionId: identity.sessionId,
    deleteRequestId: "stale-request",
    disposition: "tombstoned",
    tombstoneDigest: digest,
  });
  const coordinator = new AgentDeletionCoordinator(store, owners, () => 10);
  await expect(coordinator.deleteSession(identity)).rejects.toBeInstanceOf(AgentDeletionReceiptError);
  expect(coordinator.readiness(store.record!)).toEqual({
    ready: false, retryable: true, failedPhase: "delete_hosts",
  });
  expect(store.record?.phase).toBe("delete_hosts");
});

test("all-settles gateway owners and resumes without repeating completed phases", async () => {
  const store = new MemoryStore();
  const first = fixture({ fail: "registries" });
  await expect(new AgentDeletionCoordinator(store, first.owners, () => 1).deleteSession(identity)).rejects.toThrow();
  expect(first.calls).toContain("ledger");
  expect(store.record?.phase).toBe("settle_gateway");
  const recovery = fixture();
  await new AgentDeletionCoordinator(store, recovery.owners, () => 2).deleteSession(identity);
  expect(recovery.calls).toEqual(["registries", "ledger", "release", "transcript", "kernel"]);
});

test("crash after every durable phase resumes from its checkpoint without owner fallback", async () => {
  for (let crash = 1; crash <= 7; crash++) {
    const store = new MemoryStore();
    store.failCheckpoint = crash;
    const before = fixture();
    await expect(new AgentDeletionCoordinator(store, before.owners, () => crash).deleteSession(identity)).rejects.toThrow("crash");
    store.failCheckpoint = undefined;
    const recovery = fixture();
    const result = await new AgentDeletionCoordinator(store, recovery.owners, () => 100 + crash).deleteSession(identity);
    expect(result.ok).toBe(true);
    expect(recovery.calls.every((call) => !call.includes("fallback"))).toBe(true);
  }
});

test("recovers a durable pre-kernel ghost and applies seven-day cleanup policy", async () => {
  const store = new MemoryStore();
  store.record = {
    ...identity,
    createdAtMs: 1,
    updatedAtMs: 2,
    phase: "finish_kernel",
    receipts: AGENT_DELETION_PHASES.slice(0, -2).map((phase) => ({
      phase: phase as Exclude<(typeof AGENT_DELETION_PHASES)[number], "completed">,
      completedAtMs: 2,
      evidence: {},
    })),
    enumeration: { pins: [], hosts: [] },
    hostReceipts: [],
  };
  const { calls, owners } = fixture();
  const now = 20 * 24 * 60 * 60 * 1_000;
  const coordinator = new AgentDeletionCoordinator(store, owners, () => now);
  await coordinator.deleteSession(identity);
  expect(calls).toEqual(["kernel"]);
  await coordinator.cleanupExpiredSuccesses();
  expect(store.cleanupBefore).toBe(now - AGENT_DELETION_RECEIPT_RETENTION_MS);
});

test("never accepts a different delete request for an existing durable record", async () => {
  const store = new MemoryStore();
  const { owners } = fixture();
  await new AgentDeletionCoordinator(store, owners, () => 1).deleteSession(identity);
  await expect(new AgentDeletionCoordinator(store, owners, () => 2).deleteSession({
    ...identity, deleteRequestId: "different",
  })).rejects.toBeInstanceOf(AgentDeletionReceiptError);
});
