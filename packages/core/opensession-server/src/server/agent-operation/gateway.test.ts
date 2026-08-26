import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  hashAgentModelPayloadV1,
  hashAgentOperationDescriptorV1,
  type AgentOperationRequestV1,
} from "@tellahq/opensession-protocol/agent-operation";
import type { AgentHostSupervisionAuthorityV2 } from "@tellahq/opensession-protocol/agent-host";
import {
  AgentGatewayGrantRegistry,
  encodeAgentGatewayPolicyHandle,
} from "./grants";
import { AgentOperationGateway, type AgentGatewayFailpoint } from "./gateway";
import { SQLiteAgentOperationLedger } from "./sqlite-ledger";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});
const d = (c: string) => `sha256:${c.repeat(64)}` as const;
const bytes = new TextEncoder().encode("payload");
const authority: AgentHostSupervisionAuthorityV2 = {
  version: 2,
  fence: {
    sessionId: "session-1",
    runId: "run-1",
    turnId: "turn-1",
    generation: 1,
  },
  planHash: d("a"),
  hostId: "host-000000000001",
  hostGeneration: 1,
  hostIncarnation: "incarnation-0001",
  supervisorEpoch: 1,
  kernelServiceEpoch: "kernel-epoch-0001",
  hostChallenge: "challenge-00000001",
  audience: "opensession-agent-host",
  purpose: "agent-host-supervision",
  issuedAtMs: 1,
  expiresAtMs: 1_000_000,
  nonce: "nonce-000000000001",
  keyId: "key-0000000000001",
};
const envelope = {
  version: 1,
  algorithm: "Ed25519",
  domain: "opensession.agent-host.supervision.v2",
  authorityBytes: "AQ",
  signature: Buffer.alloc(64).toString("base64url"),
} as const;

async function fixture(
  failAt?: AgentGatewayFailpoint,
  beforeAdapterCompletes?: () => Promise<void>,
) {
  const root = mkdtempSync(join(tmpdir(), "agent-gateway-"));
  roots.push(root);
  const ledger = new SQLiteAgentOperationLedger({
    dbPath: join(root, "ledger.sqlite"),
  });
  let now = 10;
  const grants = new AgentGatewayGrantRegistry({
    now: () => now,
    entropy: () => "x".repeat(43),
  });
  const descriptor = {
    version: 1,
    kind: "model",
    stepId: "step-1",
    transcript: { throughChangeSeq: 2, entryIds: ["entry-1"], digest: d("c") },
    modelPolicyHash: d("d"),
    adapterRequestVersion: "v1",
  } as const;
  const descriptorDigest = await hashAgentOperationDescriptorV1(descriptor);
  const payloadDigest = await hashAgentModelPayloadV1(bytes);
  const grant = grants.issue({
    operationId: "operation-1",
    kind: "model",
    fence: authority.fence,
    planHash: d("a"),
    authorityHash: d("b"),
    supervisorEpoch: 1,
    hostId: authority.hostId,
    hostGeneration: 1,
    hostIncarnation: authority.hostIncarnation,
    descriptorDigest,
    payloadDigest,
    transcriptAnchor: descriptor.transcript,
    adapterId: "adapter-1",
    adapterVersion: "1.0",
    deadlineMs: 500,
    authorityExpiresAtMs: 600,
    policyHandle: encodeAgentGatewayPolicyHandle("policy00000000001"),
  });
  const request: AgentOperationRequestV1 = {
    version: 1,
    operationId: "operation-1",
    kind: "model",
    fence: authority.fence,
    supervisionEnvelope: envelope,
    dispatchGrant: grant,
    descriptor,
    descriptorDigest,
  };
  const actor = {
    admits: 0,
    terminals: 0,
    async admit() {
      this.admits++;
      return { accepted: true };
    },
    async settle() {
      this.terminals++;
    },
    async indeterminate() {
      this.terminals++;
    },
  };
  let executions = 0;
  let terminalAppends = 0;
  let notices = 0;
  let tripped = false;
  const gateway = new AgentOperationGateway({
    ledger,
    grants,
    now: () => ++now,
    verifySupervision: async () => ({ authority, authorityHash: d("b") }),
    admission: actor,
    adapterFor: () => ({
      id: "adapter-1",
      version: "1.0",
      async execute() {
        executions++;
        await beforeAdapterCompletes?.();
        return {
          outcome: { status: "succeeded", outputDigest: d("e") },
          transcript: { text: "ephemeral" },
        };
      },
    }),
    encodePayload: (_kind, payload) => {
      if (payload !== "payload") throw new Error();
      return bytes;
    },
    appendTerminal: async () => {
      terminalAppends++;
      return terminal("append-terminal", d("e"), "ok");
    },
    appendIndeterminateNotice: async (_record, appendId) => {
      notices++;
      return terminal(appendId, d("f"), "reconciliation_unsupported")
        .kernelTerminal;
    },
    failpoint: async (point) => {
      if (point === failAt && !tripped) {
        tripped = true;
        throw new Error(`fail:${point}`);
      }
    },
  });
  return {
    gateway,
    ledger,
    request,
    actor,
    counts: () => ({ executions, terminalAppends, notices }),
  };
}
function terminal(
  appendId: string,
  outputDigest: `sha256:${string}`,
  outcomeCode: string,
) {
  const refs = [
    {
      appendId,
      entryIds: [`entry-${appendId}`],
      firstSeq: 3,
      lastSeq: 3,
      throughChangeSeq: 3,
      requestDigest: d("1"),
    },
  ];
  return {
    refs,
    kernelTerminal: {
      outputDigest,
      outcomeCode,
      transcriptRefs: refs,
      pendingToolUseEntryIds: [],
    },
  };
}

const points: AgentGatewayFailpoint[] = [
  "after_admission",
  "after_prepared",
  "after_executing",
  "after_transcript_append",
  "after_ledger_settlement",
  "after_schema_settlement",
];
describe("Agent operation gateway durable choreography", () => {
  for (const point of points)
    test(`failpoint ${point} never repeats physical work`, async () => {
      const f = await fixture(point);
      await expect(f.gateway.dispatch(f.request, "payload")).rejects.toThrow(
        `fail:${point}`,
      );
      const active = await f.ledger.scanActive();
      if (active.some((record) => record.receipt.state === "executing"))
        await f.gateway.recoverActive();
      else await f.gateway.dispatch(f.request, "payload");
      const records = await f.ledger.scanActive();
      expect(records).toHaveLength(0);
      expect(f.counts().executions).toBeLessThanOrEqual(1);
      if (["after_executing", "after_transcript_append"].includes(point)) {
        expect(f.counts().executions).toBe(point === "after_executing" ? 0 : 1);
        expect(f.counts().notices).toBe(1);
      }
      await f.ledger.close();
    });

  test("concurrent duplicate replay invokes the adapter exactly once", async () => {
    const f = await fixture();
    const [a, b] = await Promise.all([
      f.gateway.dispatch(f.request, "payload"),
      f.gateway.dispatch(f.request, "payload"),
    ]);
    expect(a.receipt.state).toBe("settled");
    expect(b.receipt.state).toBe("settled");
    expect(f.counts()).toMatchObject({ executions: 1, terminalAppends: 1 });
    await f.ledger.close();
  });

  test("prepared recovery is inert and requires a fresh authorized dispatch", async () => {
    const f = await fixture("after_prepared");
    await expect(f.gateway.dispatch(f.request, "payload")).rejects.toThrow();
    const recovered = await f.gateway.recoverActive();
    expect(recovered.prepared).toHaveLength(1);
    expect(f.counts().executions).toBe(0);
    await f.gateway.dispatch(f.request, "payload");
    expect(f.counts().executions).toBe(1);
    await f.ledger.close();
  });

  test("does not hold the actor while physical work is blocked", async () => {
    let release!: () => void;
    let started!: () => void;
    const adapterStarted = new Promise<void>((resolve) => (started = resolve));
    const adapterRelease = new Promise<void>((resolve) => (release = resolve));
    const f = await fixture(undefined, async () => {
      started();
      await adapterRelease;
    });
    const dispatch = f.gateway.dispatch(f.request, "payload");
    await adapterStarted;
    await expect(f.actor.admit()).resolves.toEqual({ accepted: true });
    release();
    await dispatch;
    expect(f.counts().executions).toBe(1);
    await f.ledger.close();
  });

  test("forged request and stale grant fail before admission or physical work", async () => {
    const f = await fixture();
    await expect(
      f.gateway.dispatch({ ...f.request, descriptorDigest: d("9") }, "payload"),
    ).rejects.toThrow();
    await expect(
      f.gateway.dispatch(
        { ...f.request, dispatchGrant: "osag_dispatch_v1." + "z".repeat(43) },
        "payload",
      ),
    ).rejects.toThrow();
    expect(f.actor.admits).toBe(0);
    expect(f.counts().executions).toBe(0);
    await f.ledger.close();
  });
});
