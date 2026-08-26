import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  AGENT_HOST_SUPERVISION_AUDIENCE,
  AGENT_HOST_SUPERVISION_PURPOSE,
  MAX_AGENT_HOST_SUPERVISION_CLOCK_SKEW_MS,
} from "@tellahq/opensession-protocol/agent-host";
import { SessionKernelStore } from "./store";
import type {
  AgentHostPlanRegistration,
  AgentHostSupervisionClaim,
} from "./agent-host-supervision-protocol";

const planHash = `sha256:${"a".repeat(64)}`;
function plan(
  overrides: Partial<AgentHostPlanRegistration> = {},
): AgentHostPlanRegistration {
  return {
    op: "register_plan",
    registrationId: "plan-registration-0001",
    sessionId: "session-1",
    runId: "run-1",
    turnId: "turn-1",
    generation: 1,
    planHash,
    ...overrides,
  };
}
function claim(
  overrides: Partial<AgentHostSupervisionClaim> = {},
): AgentHostSupervisionClaim {
  const issuedAtMs = Date.now();
  return {
    op: "claim",
    claimId: "claim-000000000001",
    sessionId: "session-1",
    runId: "run-1",
    turnId: "turn-1",
    generation: 1,
    planHash,
    hostId: "host-1",
    hostGeneration: 1,
    hostIncarnation: "incarnation-00000001",
    hostChallenge: "challenge-000000000001",
    audience: AGENT_HOST_SUPERVISION_AUDIENCE,
    purpose: AGENT_HOST_SUPERVISION_PURPOSE,
    issuedAtMs,
    expiresAtMs: issuedAtMs + 60_000,
    nonce: "nonce-000000000000001",
    keyId: "future-ed25519-key-1",
    kernelServiceEpoch: "kernel-service-epoch-1",
    ...overrides,
  };
}
function runningStore(path = ":memory:"): SessionKernelStore {
  const store = new SessionKernelStore(path);
  expect(
    store.applyRunEvent({
      sessionId: "session-1",
      event: "prompt",
      runKey: "run-1",
    }).accepted,
  ).toBe(true);
  return store;
}
function register(store: SessionKernelStore, input = plan()): void {
  expect(store.registerAgentHostPlan(input).accepted).toBe(true);
}

describe("Agent Host supervision actor state", () => {
  test("migrates live schema 24 additively and raises the rollback floor", () => {
    const directory = mkdtempSync(join(tmpdir(), "agent-host-schema24-"));
    const path = join(directory, "kernel.sqlite");
    const legacy = new Database(path);
    legacy.exec(`
      CREATE TABLE session_kernel_agent_host_supervision (
        session_id TEXT NOT NULL,
        supervisor_epoch INTEGER NOT NULL,
        claim_id TEXT NOT NULL,
        request_hash TEXT NOT NULL,
        run_id TEXT NOT NULL,
        run_generation INTEGER NOT NULL,
        host_id TEXT NOT NULL,
        host_generation INTEGER NOT NULL,
        host_incarnation TEXT NOT NULL,
        kernel_service_epoch TEXT NOT NULL,
        challenge TEXT NOT NULL,
        nonce TEXT NOT NULL,
        status TEXT NOT NULL,
        authority TEXT NOT NULL,
        authority_bytes TEXT NOT NULL,
        authority_hash TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        PRIMARY KEY (session_id, supervisor_epoch)
      );
      PRAGMA user_version = 24;
    `);
    legacy.close();
    const store = new SessionKernelStore(path);
    store.close();
    const migrated = new Database(path, { readonly: true });
    expect(
      (migrated.query("PRAGMA user_version").get() as { user_version: number })
        .user_version,
    ).toBe(25);
    expect(
      migrated
        .query(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'session_kernel_agent_host_plan'",
        )
        .get(),
    ).toBeDefined();
    expect(
      (
        migrated
          .query("PRAGMA table_info(session_kernel_agent_host_supervision)")
          .all() as Array<{ name: string }>
      ).some((column) => column.name === "expires_at"),
    ).toBe(true);
    migrated.close();
    rmSync(directory, { recursive: true, force: true });
  });

  test("requires actor-owned plan registration before a claim", () => {
    const store = runningStore();
    expect(store.claimAgentHostSupervision(claim())).toEqual({
      accepted: false,
      reason: "plan_unregistered",
    });
    expect(store.registerAgentHostPlan(plan())).toEqual({
      accepted: true,
      replayed: false,
    });
    expect(store.registerAgentHostPlan(plan())).toEqual({
      accepted: true,
      replayed: true,
    });
    expect(store.registerAgentHostPlan(plan({ turnId: "other-turn" }))).toEqual(
      {
        accepted: false,
        reason: "plan_mismatch",
      },
    );
    expect(store.claimAgentHostSupervision(claim()).accepted).toBe(true);
    store.close();
  });

  test("serializes concurrent exact plan registration", async () => {
    const store = runningStore();
    const results = await Promise.all([
      Promise.resolve().then(() => store.registerAgentHostPlan(plan())),
      Promise.resolve().then(() => store.registerAgentHostPlan(plan())),
    ]);
    expect(results).toEqual([
      { accepted: true, replayed: false },
      { accepted: true, replayed: true },
    ]);
    store.close();
  });

  test("persists plan registration across restart", () => {
    const directory = mkdtempSync(join(tmpdir(), "agent-host-plan-"));
    const path = join(directory, "kernel.sqlite");
    let store = runningStore(path);
    register(store);
    store.close();
    store = new SessionKernelStore(path);
    expect(store.registerAgentHostPlan(plan())).toEqual({
      accepted: true,
      replayed: true,
    });
    expect(store.claimAgentHostSupervision(claim()).accepted).toBe(true);
    store.close();
    rmSync(directory, { recursive: true, force: true });
  });

  test("requires the exact current run, generation, turn, and plan hash", () => {
    const store = runningStore();
    register(store);
    for (const [overrides, reason] of [
      [{ runId: "run-old" }, "stale_run"],
      [{ generation: 0 }, "stale_run"],
      [{ turnId: "turn-old" }, "plan_mismatch"],
      [{ planHash: `sha256:${"b".repeat(64)}` }, "plan_mismatch"],
    ] as const) {
      expect(
        store.claimAgentHostSupervision(
          claim({
            ...overrides,
            claimId: `claim-${reason}-${String(Math.random()).slice(2)}`,
            hostChallenge: `challenge-${reason}-0001`,
            nonce: `nonce-${reason}-00000001`,
          }),
        ),
      ).toEqual({ accepted: false, reason });
    }
    store.close();
  });

  test("replays only an identical claim and consumes challenge and nonce once", () => {
    const store = runningStore();
    register(store);
    const input = claim();
    const first = store.claimAgentHostSupervision(input);
    expect(first.accepted).toBe(true);
    if (!first.accepted) throw new Error("claim rejected");
    expect(store.claimAgentHostSupervision(input)).toEqual({
      ...first,
      replayed: true as const,
    });
    expect(
      store.claimAgentHostSupervision({
        ...input,
        hostIncarnation: "changed-incarnation-01",
      }),
    ).toEqual({ accepted: false, reason: "claim_mismatch" });
    expect(
      store.claimAgentHostSupervision(
        claim({
          claimId: "claim-challenge-reuse",
          nonce: "nonce-other-000000001",
        }),
      ),
    ).toEqual({ accepted: false, reason: "challenge_reused" });
    expect(
      store.claimAgentHostSupervision(
        claim({
          claimId: "claim-nonce-reuse-001",
          hostChallenge: "challenge-other-000001",
        }),
      ),
    ).toEqual({ accepted: false, reason: "nonce_reused" });
    store.close();
  });

  test("allows a surviving Host to recover after a kernel service restart", () => {
    const store = runningStore();
    register(store);
    expect(store.claimAgentHostSupervision(claim()).accepted).toBe(true);
    const recovered = store.claimAgentHostSupervision(
      claim({
        claimId: "claim-kernel-restart-1",
        kernelServiceEpoch: "kernel-service-epoch-2",
        hostChallenge: "challenge-kernel-restart",
        nonce: "nonce-kernel-restart-01",
      }),
    );
    expect(
      recovered.accepted && recovered.receipt.authority.supervisorEpoch,
    ).toBe(2);
    store.close();
  });

  test("allows same-generation Host process restart and rejects identity rollback", () => {
    const store = runningStore();
    register(store);
    expect(
      store.claimAgentHostSupervision(
        claim({
          hostGeneration: 2,
        }),
      ).accepted,
    ).toBe(true);
    const restarted = store.claimAgentHostSupervision(
      claim({
        claimId: "claim-host-restart-001",
        hostGeneration: 2,
        hostIncarnation: "incarnation-00000002",
        hostChallenge: "challenge-host-restart-01",
        nonce: "nonce-host-restart-0001",
      }),
    );
    expect(
      restarted.accepted && restarted.receipt.authority.supervisorEpoch,
    ).toBe(2);
    expect(
      store.claimAgentHostSupervision(
        claim({
          claimId: "claim-lower-host-gen",
          hostGeneration: 1,
          hostChallenge: "challenge-lower-host-gen",
          nonce: "nonce-lower-host-gen-01",
        }),
      ),
    ).toEqual({ accepted: false, reason: "stale_host" });
    expect(
      store.claimAgentHostSupervision(
        claim({
          claimId: "claim-changed-host-id",
          hostId: "host-2",
          hostChallenge: "challenge-changed-host-id",
          nonce: "nonce-changed-host-id-01",
        }),
      ),
    ).toEqual({ accepted: false, reason: "stale_host" });
    store.close();
  });

  test("retains monotonic epoch after pruning 64 expired terminal receipts and restart", () => {
    const realNow = Date.now;
    let now = 1_000_000;
    Date.now = () => now;
    const directory = mkdtempSync(join(tmpdir(), "agent-host-prune-"));
    const path = join(directory, "kernel.sqlite");
    try {
      let store = runningStore(path);
      register(store);
      for (let index = 0; index < 64; index += 1) {
        const result = store.claimAgentHostSupervision(
          claim({
            claimId: `claim-capacity-${index}`,
            hostChallenge: `challenge-capacity-${index}`.padEnd(20, "x"),
            nonce: `nonce-capacity-${index}`.padEnd(20, "x"),
            expiresAtMs: now + 100,
          }),
        );
        expect(result.accepted).toBe(true);
      }
      expect(
        store.applyRunEvent({
          sessionId: "session-1",
          event: "run_failed",
          runKey: "run-1",
        }).accepted,
      ).toBe(true);
      store.close();
      now += 101 + MAX_AGENT_HOST_SUPERVISION_CLOCK_SKEW_MS;
      store = new SessionKernelStore(path);
      expect(
        store.applyRunEvent({
          sessionId: "session-1",
          event: "prompt",
          runKey: "run-2",
        }).accepted,
      ).toBe(true);
      register(
        store,
        plan({
          registrationId: "plan-registration-0002",
          runId: "run-2",
          turnId: "turn-2",
          generation: 2,
          planHash: `sha256:${"b".repeat(64)}`,
        }),
      );
      const recovered = store.claimAgentHostSupervision(
        claim({
          claimId: "claim-after-prune-001",
          runId: "run-2",
          turnId: "turn-2",
          generation: 2,
          planHash: `sha256:${"b".repeat(64)}`,
          hostGeneration: 2,
          hostIncarnation: "incarnation-00000002",
          hostChallenge: "challenge-after-prune-01",
          nonce: "nonce-after-prune-0001",
        }),
      );
      expect(
        recovered.accepted && recovered.receipt.authority.supervisorEpoch,
      ).toBe(65);
      store.close();
    } finally {
      Date.now = realNow;
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
