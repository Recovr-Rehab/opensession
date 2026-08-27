import { afterEach, describe, expect, test } from "bun:test";
import { generateKeyPairSync } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { connect, type Socket } from "node:net";
import {
  AGENT_HOST_PROTOCOL_VERSION,
  AGENT_HOST_SUPERVISION_AUDIENCE,
  AGENT_HOST_SUPERVISION_PURPOSE,
  AGENT_HOST_SUPERVISION_SIGNATURE_ALGORITHM,
  AGENT_HOST_SUPERVISION_SIGNATURE_DOMAIN,
  hashAgentOperationDescriptorV1,
  hashAgentTurnSpecV2,
  serializeAgentHostSupervisionAuthorityV2,
  type AgentHostChallengeDescriptorV4,
  type AgentHostSupervisionPublicKeyringV2,
  type AgentOperationReceiptV1,
  type AgentTurnFence,
  type AgentTurnSpec,
} from "@tellahq/opensession-protocol";
import { createAgentHostSupervisionSigner } from "../server/session-kernel/agent-host-supervision-signer";
import type {
  AgentHostOperationTransport,
  AgentTurnDriver,
  AgentTurnResult,
} from "./driver";
import {
  createAgentHost,
  type AgentHost,
  type AgentHostFailpoint,
} from "./host";
import { BoundedNdjsonDecoder, encodeNdjsonFrame } from "./socket-framing";

const fence: AgentTurnFence = {
  sessionId: "session-1",
  runId: "run-1",
  turnId: "turn-1",
  generation: 3,
};
const descriptor = {
  version: 1 as const,
  kind: "model" as const,
  stepId: "step-1",
  transcript: {
    throughChangeSeq: 0,
    entryIds: [],
    digest: `sha256:${"a".repeat(64)}` as const,
  },
  modelPolicyHash: `sha256:${"b".repeat(64)}` as const,
  adapterRequestVersion: "model.v1",
};
const descriptorDigest = await hashAgentOperationDescriptorV1(descriptor);
const now = Date.now();
const spec: AgentTurnSpec = {
  fence,
  initialOperation: {
    operationId: "operation-1",
    descriptor,
    descriptorDigest,
    deadlineMs: now + 60_000,
  },
  transcript: { afterChangeSeq: 0, maxAppendBytes: 4096, requireAck: true },
  limits: {
    turnDeadlineMs: now + 120_000,
    maxInFlightOperations: 8,
    maxBufferedStreamBytes: 512 * 1024,
    maxBufferedStreamChunks: 32,
  },
};
const planHash = await hashAgentTurnSpecV2(spec);
class Driver implements AgentTurnDriver {
  transport?: AgentHostOperationTransport;
  delivered: number[] = [];
  cancelled = 0;
  private done!: (r: AgentTurnResult) => void;
  completion = new Promise<AgentTurnResult>((r) => (this.done = r));
  run(_s: AgentTurnSpec, t: AgentHostOperationTransport) {
    this.transport = t;
    return this.completion;
  }
  async deliverOperationStream(s: { streamSeq: number }) {
    this.delivered.push(s.streamSeq);
  }
  async cancel() {
    this.cancelled++;
  }
  async shutdown() {}
  finish() {
    this.done({ status: "completed" });
  }
}
function signing() {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519"),
    now = Date.now(),
    keyId = "supervision-key-01";
  const signer = createAgentHostSupervisionSigner({
    keyId,
    privateKeyPkcs8: Uint8Array.from(
      privateKey.export({ type: "pkcs8", format: "der" }) as Buffer,
    ),
    publicKeySpki: Uint8Array.from(
      publicKey.export({ type: "spki", format: "der" }) as Buffer,
    ),
    signingNotBeforeMs: now - 60_000,
    signingNotAfterMs: now + 3_600_000,
    verifyUntilMs: now + 7_200_000,
    status: "active",
  });
  const keyring: AgentHostSupervisionPublicKeyringV2 = {
    version: 2,
    algorithm: AGENT_HOST_SUPERVISION_SIGNATURE_ALGORITHM,
    domain: AGENT_HOST_SUPERVISION_SIGNATURE_DOMAIN,
    keys: [
      {
        keyId,
        status: "active",
        publicKeySpki: (
          publicKey.export({ type: "spki", format: "der" }) as Buffer
        ).toString("base64url"),
        signingNotBeforeMs: now - 60_000,
        signingNotAfterMs: now + 3_600_000,
        verifyUntilMs: now + 7_200_000,
      },
    ],
  };
  let epoch = 0;
  return {
    keyring,
    receipt: (c: AgentHostChallengeDescriptorV4) => {
      const issuedAtMs = Date.now();
      const expected = {
        fence,
        planHash,
        ...c,
        supervisorEpoch: ++epoch,
        kernelServiceEpoch: `kernel-${epoch}`,
        nonce: `nonce-${crypto.randomUUID()}`,
        audience: AGENT_HOST_SUPERVISION_AUDIENCE,
        purpose: AGENT_HOST_SUPERVISION_PURPOSE,
        keyId,
        issuedAtMs,
        expiresAtMs: issuedAtMs + 60_000,
      };
      return {
        expected,
        envelope: signer.sign(
          serializeAgentHostSupervisionAuthorityV2({ version: 2, ...expected }),
          issuedAtMs,
        ),
      };
    },
  };
}
type Peer = { socket: Socket; messages: any[] };
const resources: { host: AgentHost; dir: string }[] = [];
afterEach(async () => {
  for (const r of resources.splice(0)) {
    await r.host.stop();
    await rm(r.dir, { recursive: true, force: true });
  }
});
async function setup(
  extra: Partial<Parameters<typeof createAgentHost>[0]> = {},
) {
  const dir = await mkdtemp(join(tmpdir(), "host-v4-")),
    socketPath = join(dir, "host.sock"),
    driver = new Driver(),
    sig = signing();
  const host = createAgentHost({
    socketPath,
    createDriver: () => driver,
    hostId: "agent-host-1",
    hostGeneration: 1,
    hostIncarnation: `incarnation-${crypto.randomUUID()}`,
    supervisionKeyring: sig.keyring,
    ...extra,
  });
  resources.push({ host, dir });
  await host.start();
  return { socketPath, driver, ...sig };
}
async function peer(path: string) {
  return new Promise<Peer>((ok) => {
    const socket = connect(path),
      messages: any[] = [],
      d = new BoundedNdjsonDecoder();
    socket.on("data", (b) => messages.push(...d.push(Buffer.from(b))));
    socket.once("connect", () => ok({ socket, messages }));
  });
}
const send = (p: Peer, v: unknown) => p.socket.write(encodeNdjsonFrame(v));
const wait = () => new Promise((r) => setTimeout(r, 15));
async function attach(
  p: Peer,
  receipt: ReturnType<typeof signing>["receipt"],
  resume: null | {
    lastHostSeq: number;
    operations: { operationId: string; throughStreamSeq: number }[];
  } = null,
) {
  send(p, { t: "hello", version: 5, requestId: "hello-1" });
  await wait();
  const h = p.messages.shift();
  send(p, {
    t: "attach",
    version: 5,
    requestId: "attach-1",
    fence,
    planHash,
    receipt: receipt({
      hostId: h.hostId,
      hostGeneration: h.hostGeneration,
      hostIncarnation: h.hostIncarnation,
      hostChallenge: h.hostChallenge,
    }),
    resume,
  });
  await wait();
  return p.messages.shift();
}
function receipt(
  state: AgentOperationReceiptV1["state"],
): AgentOperationReceiptV1 {
  const terminalRef = {
    appendId: "append-host-1",
    entryIds: ["entry-output-host-1"],
    firstSeq: 1,
    lastSeq: 1,
    throughChangeSeq: 1,
    requestDigest: `sha256:${"9".repeat(64)}` as const,
  };
  return {
    version: 1,
    operationId: "operation-1",
    kind: "model",
    fence,
    planHash,
    authorityHash: `sha256:${"c".repeat(64)}`,
    descriptorDigest,
    payloadDigest: `sha256:${"d".repeat(64)}`,
    actorIdentity: {
      supervisorEpoch: 1,
      hostId: "agent-host-1",
      hostGeneration: 1,
      hostIncarnation: "incarnation-test",
      transcriptAnchor: {
        throughChangeSeq: 0,
        entryIds: [],
        digest: `sha256:${"e".repeat(64)}`,
      },
    },
    state,
    acceptedAtMs: now,
    executingAtMs: state !== "prepared" ? now + 1 : undefined,
    completedAtMs: state === "settled" ? now + 2 : undefined,
    outcome:
      state === "settled" ? { status: "succeeded", code: "ok" } : undefined,
    transcriptRefs: state === "settled" ? [terminalRef] : undefined,
    kernelTerminal:
      state === "settled"
        ? {
            outputDigest: `sha256:${"f".repeat(64)}`,
            outcomeCode: "ok",
            transcriptRefs: [terminalRef],
            pendingToolUseEntryIds: [],
          }
        : undefined,
    providerRef: { adapterId: "test", adapterVersion: "1" },
  };
}

describe("Agent Host protocol v5", () => {
  test("strict attach, operation receipts, stream credit and terminal drain", async () => {
    const { socketPath, driver, receipt: sign } = await setup();
    const p = await peer(socketPath);
    expect((await attach(p, sign)).mode).toBe("fresh");
    send(p, {
      t: "start_turn",
      version: 5,
      requestId: "start-1",
      planHash,
      spec,
    });
    await wait();
    expect(p.messages.shift().t).toBe("turn_started");
    await driver.transport!.requestOperation(spec.initialOperation);
    await wait();
    const request = p.messages.find((x) => x.t === "operation_request"),
      credit = p.messages.find((x) => x.t === "operation_stream_ack");
    expect(credit.creditBytes).toBe(256 * 1024);
    send(p, {
      t: "operation_receipt",
      version: 5,
      requestId: "r1",
      fence,
      ackHostSeq: request.hostSeq,
      operationId: "operation-1",
      receipt: receipt("executing"),
    });
    send(p, {
      t: "operation_stream",
      version: 5,
      requestId: "s1",
      fence,
      operationId: "operation-1",
      streamSeq: 1,
      encoding: "base64url+opensession-operation-v1",
      bytes: Buffer.from("chunk").toString("base64url"),
    });
    await wait();
    expect(driver.delivered).toEqual([1]);
    expect(
      p.messages.some(
        (x) => x.t === "operation_stream_ack" && x.throughStreamSeq === 1,
      ),
    ).toBe(true);
    const last = p.messages
      .filter((x) => x.operationId === "operation-1")
      .at(-1);
    send(p, {
      t: "operation_receipt",
      version: 5,
      requestId: "r2",
      fence,
      ackHostSeq: last.hostSeq,
      operationId: "operation-1",
      receipt: receipt("settled"),
    });
    send(p, {
      t: "consumption_ack",
      version: 5,
      requestId: "consumed-1",
      fence,
      ackHostSeq: last.hostSeq,
      operations: [{ operationId: "operation-1", throughStreamSeq: 1 }],
    });
    send(p, {
      t: "consumption_ack",
      version: 5,
      requestId: "consumed-duplicate",
      fence,
      ackHostSeq: last.hostSeq,
      operations: [{ operationId: "operation-1", throughStreamSeq: 1 }],
    });
    driver.finish();
    await wait();
    expect(p.socket.destroyed).toBe(false);
    expect(p.messages.filter((message) => message.t === "turn_terminal")).toHaveLength(1);
    const terminal = p.messages.find((message) => message.t === "turn_terminal");
    expect(terminal).toMatchObject({
      hostGeneration: 1,
      result: { status: "completed" },
      finalAckHostSeq: last.hostSeq,
      operations: [{ operationId: "operation-1", throughStreamSeq: 1 }],
    });
    send(p, {
      t: "turn_terminal_ack",
      version: 5,
      requestId: "terminal-ack-1",
      fence,
      ackHostSeq: terminal.hostSeq,
      resultDigest: terminal.resultDigest,
      receiptsDigest: terminal.receiptsDigest,
    });
    await wait();
    expect(p.socket.destroyed).toBe(true);
  });
  test("replays one terminal after reconnect following the terminal write", async () => {
    const { socketPath, driver, receipt: sign } = await setup({ reconnectGraceMs: 200 });
    const first = await peer(socketPath);
    await attach(first, sign);
    send(first, { t: "start_turn", version: 5, requestId: "start-replay", planHash, spec });
    await wait();
    first.messages.shift();
    await driver.transport!.requestOperation(spec.initialOperation);
    await wait();
    const request = first.messages.find((message) => message.t === "operation_request");
    const finalIntent = first.messages.at(-1);
    send(first, { t: "operation_receipt", version: 5, requestId: "executing-replay", fence, ackHostSeq: request.hostSeq, operationId: "operation-1", receipt: receipt("executing") });
    send(first, { t: "operation_receipt", version: 5, requestId: "settled-replay", fence, ackHostSeq: finalIntent.hostSeq, operationId: "operation-1", receipt: receipt("settled") });
    send(first, { t: "consumption_ack", version: 5, requestId: "consumed-replay", fence, ackHostSeq: finalIntent.hostSeq, operations: [{ operationId: "operation-1", throughStreamSeq: 0 }] });
    driver.finish();
    await wait();
    const written = first.messages.find((message) => message.t === "turn_terminal");
    expect(written).toBeDefined();
    first.socket.destroy();
    await wait();

    const second = await peer(socketPath);
    expect((await attach(second, sign, { lastHostSeq: finalIntent.hostSeq, operations: [{ operationId: "operation-1", throughStreamSeq: 0 }] })).mode).toBe("resumed");
    await wait();
    const replayed = second.messages.filter((message) => message.t === "turn_terminal");
    expect(replayed).toHaveLength(1);
    expect(replayed[0]).toEqual(written);
    send(second, { t: "turn_terminal_ack", version: 5, requestId: "terminal-replay-ack", fence, ackHostSeq: written.hostSeq, resultDigest: written.resultDigest, receiptsDigest: written.receiptsDigest });
    await wait();
    expect(second.socket.destroyed).toBe(true);
  });

  test("keeps a detached driver alive through reconnect before terminal write and atomically resumes", async () => {
    const {
      socketPath,
      driver,
      receipt: sign,
    } = await setup({ reconnectGraceMs: 80 });
    const first = await peer(socketPath);
    await attach(first, sign);
    send(first, {
      t: "start_turn",
      version: 5,
      requestId: "start-1",
      planHash,
      spec,
    });
    await wait();
    first.socket.destroy();
    await wait();
    expect(driver.cancelled).toBe(0);
    const second = await peer(socketPath);
    const a = await attach(second, sign, { lastHostSeq: 1, operations: [] });
    expect(a.mode).toBe("resumed");
    await new Promise((r) => setTimeout(r, 100));
    expect(driver.cancelled).toBe(0);
  });
  test("consumes challenge before parsing and invokes canonical failpoints", async () => {
    const seen: AgentHostFailpoint[] = [];
    const { socketPath, receipt: sign } = await setup({
      failpoint: (p) => {
        seen.push(p);
      },
    });
    const p = await peer(socketPath);
    await attach(p, sign);
    expect(seen.slice(0, 3)).toEqual([
      "afterAttachChallengeConsumed",
      "afterAttachVerifiedBeforeOwnerSwap",
      "afterOwnerSwapBeforeAttachedWrite",
    ]);
  });
  test("rejects v4 without compatibility", async () => {
    const { socketPath } = await setup();
    const p = await peer(socketPath);
    send(p, { t: "hello", version: 4, requestId: "old" });
    await wait();
    expect(p.socket.destroyed).toBe(true);
  });
});
