import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  AGENT_HOST_SUPERVISION_AUDIENCE,
  AGENT_HOST_SUPERVISION_PURPOSE,
} from "@tellahq/opensession-protocol/agent-host";
import { SessionKernelStore } from "./store";
import type { AgentHostSupervisionClaim } from "./agent-host-supervision-protocol";

const planHash = `sha256:${"a".repeat(64)}`;
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

describe("Agent Host supervision actor state", () => {
  test("requires the exact current nonterminal run and generation", () => {
    const store = runningStore();
    expect(store.claimAgentHostSupervision(claim()).accepted).toBe(true);
    expect(
      store.claimAgentHostSupervision(
        claim({
          claimId: "claim-stale-run-0001",
          runId: "run-old",
          hostChallenge: "challenge-stale-run-01",
          nonce: "nonce-stale-run-00001",
        }),
      ),
    ).toEqual({ accepted: false, reason: "stale_run" });
    expect(
      store.claimAgentHostSupervision(
        claim({
          claimId: "claim-stale-gen-0001",
          generation: 0,
          hostChallenge: "challenge-stale-gen-01",
          nonce: "nonce-stale-gen-00001",
        }),
      ),
    ).toEqual({ accepted: false, reason: "stale_run" });
    store.close();
  });

  test("pins the exact plan and replays only an identical claim", () => {
    const store = runningStore();
    const input = claim();
    const first = store.claimAgentHostSupervision(input);
    const replay = store.claimAgentHostSupervision(input);
    expect(first.accepted).toBe(true);
    if (!first.accepted) throw new Error("claim rejected");
    expect(first.receipt.authority.planHash).toBe(planHash);
    expect(replay).toEqual({ ...first, replayed: true as const });
    expect(
      store.claimAgentHostSupervision({
        ...input,
        planHash: `sha256:${"b".repeat(64)}`,
      }),
    ).toEqual({ accepted: false, reason: "claim_mismatch" });
    expect(
      store.claimAgentHostSupervision(
        claim({
          claimId: "claim-plan-mismatch-1",
          planHash: `sha256:${"b".repeat(64)}`,
          hostChallenge: "challenge-plan-other-01",
          nonce: "nonce-plan-other-00001",
        }),
      ),
    ).toEqual({ accepted: false, reason: "invalid_claim" });
    store.close();
  });

  test("consumes challenge and nonce once and advances takeover epochs", () => {
    const store = runningStore();
    const first = store.claimAgentHostSupervision(claim());
    expect(first.accepted && first.receipt.authority.supervisorEpoch).toBe(1);
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
    const takeover = store.claimAgentHostSupervision(
      claim({
        claimId: "claim-takeover-00001",
        hostChallenge: "challenge-takeover-001",
        nonce: "nonce-takeover-000001",
      }),
    );
    expect(
      takeover.accepted && takeover.receipt.authority.supervisorEpoch,
    ).toBe(2);
    store.close();
  });

  test("rejects old host incarnations and service epochs", () => {
    const store = runningStore();
    expect(store.claimAgentHostSupervision(claim()).accepted).toBe(true);
    expect(
      store.claimAgentHostSupervision(
        claim({
          claimId: "claim-old-service-001",
          kernelServiceEpoch: "kernel-service-epoch-2",
          hostChallenge: "challenge-old-service-1",
          nonce: "nonce-old-service-0001",
        }),
      ),
    ).toEqual({ accepted: false, reason: "stale_service_epoch" });
    expect(
      store.claimAgentHostSupervision(
        claim({
          claimId: "claim-new-host-00001",
          hostGeneration: 2,
          hostIncarnation: "incarnation-00000002",
          kernelServiceEpoch: "kernel-service-epoch-2",
          hostChallenge: "challenge-new-host-0001",
          nonce: "nonce-new-host-000001",
        }),
      ).accepted,
    ).toBe(true);
    expect(
      store.claimAgentHostSupervision(
        claim({
          claimId: "claim-old-host-00001",
          hostChallenge: "challenge-old-host-0001",
          nonce: "nonce-old-host-000001",
        }),
      ),
    ).toEqual({ accepted: false, reason: "stale_host" });
    store.close();
  });

  test("settles terminal authority without purging and keeps epochs monotonic", () => {
    const store = runningStore();
    const first = claim();
    expect(store.claimAgentHostSupervision(first).accepted).toBe(true);
    expect(
      store.applyRunEvent({
        sessionId: "session-1",
        event: "run_failed",
        runKey: "run-1",
      }).accepted,
    ).toBe(true);
    expect(store.claimAgentHostSupervision(first)).toMatchObject({
      accepted: true,
      replayed: true,
    });
    expect(
      store.applyRunEvent({
        sessionId: "session-1",
        event: "prompt",
        runKey: "run-2",
      }).accepted,
    ).toBe(true);
    const next = store.claimAgentHostSupervision(
      claim({
        claimId: "claim-next-run-00001",
        runId: "run-2",
        turnId: "turn-2",
        generation: 2,
        planHash: `sha256:${"b".repeat(64)}`,
        hostGeneration: 2,
        hostIncarnation: "incarnation-00000002",
        hostChallenge: "challenge-next-run-0001",
        nonce: "nonce-next-run-000001",
      }),
    );
    expect(next.accepted && next.receipt.authority.supervisorEpoch).toBe(2);
    store.close();
  });

  test("persists exact unsigned receipts across restart", () => {
    const directory = mkdtempSync(join(tmpdir(), "agent-host-supervision-"));
    const path = join(directory, "kernel.sqlite");
    let store = runningStore(path);
    const input = claim();
    const first = store.claimAgentHostSupervision(input);
    expect(first.accepted).toBe(true);
    if (!first.accepted) throw new Error("claim rejected");
    store.close();
    store = new SessionKernelStore(path);
    expect(store.claimAgentHostSupervision(input)).toEqual({
      ...first,
      replayed: true as const,
    });
    store.close();
    rmSync(directory, { recursive: true, force: true });
  });

  test("serializes concurrent claims into monotonic epochs", async () => {
    const store = runningStore();
    const results = await Promise.all([
      Promise.resolve().then(() => store.claimAgentHostSupervision(claim())),
      Promise.resolve().then(() =>
        store.claimAgentHostSupervision(
          claim({
            claimId: "claim-concurrent-0002",
            hostChallenge: "challenge-concurrent-02",
            nonce: "nonce-concurrent-000002",
          }),
        ),
      ),
    ]);
    expect(
      results.map(
        (result) => result.accepted && result.receipt.authority.supervisorEpoch,
      ),
    ).toEqual([1, 2]);
    store.close();
  });
});
