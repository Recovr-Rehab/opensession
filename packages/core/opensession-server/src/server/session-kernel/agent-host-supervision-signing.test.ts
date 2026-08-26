import { describe, expect, test } from "bun:test";
import { generateKeyPairSync } from "node:crypto";
import {
  AGENT_HOST_SUPERVISION_AUDIENCE,
  AGENT_HOST_SUPERVISION_PURPOSE,
  MAX_AGENT_HOST_SUPERVISION_CLOCK_SKEW_MS,
  decodeAgentHostSupervisionAuthorityV2,
  serializeAgentHostSupervisionAuthorityV2,
  type AgentHostSupervisionAuthorityV2,
} from "@tellahq/opensession-protocol/agent-host";
import {
  AGENT_HOST_SUPERVISION_KEYRING_VERSION,
  AGENT_HOST_SUPERVISION_SIGNATURE_ALGORITHM,
  AGENT_HOST_SUPERVISION_SIGNATURE_DOMAIN,
  decodeAgentHostSupervisionPublicKeyringV1,
  decodeSignedAgentHostSupervisionEnvelopeV1,
  verifySignedAgentHostSupervisionEnvelopeV1,
  type AgentHostSupervisionPublicKeyV1,
  type AgentHostSupervisionPublicKeyringV1,
  type ExpectedAgentHostSupervisionBindingsV2,
  type SignedAgentHostSupervisionEnvelopeV1,
} from "@tellahq/opensession-protocol/agent-host-supervision";
import {
  signAgentHostSupervisionAuthorityV2,
  type AgentHostSupervisionPrivateSigningKeyV1,
} from "./agent-host-supervision-signer";

const now = 1_000_000;
const keyId = "agent-host-key-0001";
const generated = generateKeyPairSync("ed25519");
const pkcs8 = generated.privateKey.export({ type: "pkcs8", format: "der" });
const spki = generated.publicKey.export({ type: "spki", format: "der" });

function authority(
  overrides: Partial<AgentHostSupervisionAuthorityV2> = {},
): AgentHostSupervisionAuthorityV2 {
  return decodeAgentHostSupervisionAuthorityV2({
    version: 2,
    fence: {
      sessionId: "session-1",
      runId: "run-1",
      turnId: "turn-1",
      generation: 7,
    },
    planHash: `sha256:${"a".repeat(64)}`,
    hostId: "stable-host-1",
    hostGeneration: 3,
    hostIncarnation: "host-incarnation-0001",
    supervisorEpoch: 11,
    kernelServiceEpoch: "kernel-service-epoch-0001",
    hostChallenge: "fresh-challenge-0000001",
    audience: AGENT_HOST_SUPERVISION_AUDIENCE,
    purpose: AGENT_HOST_SUPERVISION_PURPOSE,
    issuedAtMs: now,
    expiresAtMs: now + 60_000,
    nonce: "supervision-nonce-00001",
    keyId,
    ...overrides,
  })!;
}

function privateKey(
  overrides: Partial<AgentHostSupervisionPrivateSigningKeyV1> = {},
): AgentHostSupervisionPrivateSigningKeyV1 {
  return {
    keyId,
    privateKeyPkcs8: Buffer.from(pkcs8).toString("base64url"),
    notBeforeMs: now - 1,
    notAfterMs: now + 300_000,
    retiredAtMs: null,
    ...overrides,
  };
}

function publicKey(
  overrides: Partial<AgentHostSupervisionPublicKeyV1> = {},
): AgentHostSupervisionPublicKeyV1 {
  return {
    keyId,
    status: "active",
    publicKeySpki: Buffer.from(spki).toString("base64url"),
    notBeforeMs: now - 1,
    notAfterMs: now + 300_000,
    retiredAtMs: null,
    ...overrides,
  };
}

function keyring(
  keys: AgentHostSupervisionPublicKeyV1[] = [publicKey()],
): AgentHostSupervisionPublicKeyringV1 {
  return {
    version: AGENT_HOST_SUPERVISION_KEYRING_VERSION,
    algorithm: AGENT_HOST_SUPERVISION_SIGNATURE_ALGORITHM,
    domain: AGENT_HOST_SUPERVISION_SIGNATURE_DOMAIN,
    keys,
  };
}

function expected(
  value: AgentHostSupervisionAuthorityV2,
): ExpectedAgentHostSupervisionBindingsV2 {
  return {
    fence: value.fence,
    planHash: value.planHash,
    hostId: value.hostId,
    hostGeneration: value.hostGeneration,
    hostIncarnation: value.hostIncarnation,
    supervisorEpoch: value.supervisorEpoch,
    kernelServiceEpoch: value.kernelServiceEpoch,
    hostChallenge: value.hostChallenge,
    nonce: value.nonce,
    audience: value.audience,
    purpose: value.purpose,
  };
}

async function signed(value = authority(), key = privateKey()) {
  return signAgentHostSupervisionAuthorityV2(
    serializeAgentHostSupervisionAuthorityV2(value),
    key,
    now,
  );
}

function flipBase64Url(value: string): string {
  const bytes = Buffer.from(value, "base64url");
  bytes[bytes.length - 1] ^= 1;
  return bytes.toString("base64url");
}

describe("signed Agent Host supervision", () => {
  test("signs canonical bytes and verifies every exact binding", async () => {
    const value = authority();
    const envelope = await signed(value);
    expect(
      await verifySignedAgentHostSupervisionEnvelopeV1(
        envelope,
        keyring(),
        expected(value),
        now,
      ),
    ).toEqual(value);
  });

  test("snapshots mutable authority input before asynchronous key import", async () => {
    const value = authority();
    const bytes = serializeAgentHostSupervisionAuthorityV2(value);
    const signing = signAgentHostSupervisionAuthorityV2(
      bytes,
      privateKey(),
      now,
    );
    bytes.fill(0);
    const envelope = await signing;
    expect(
      await verifySignedAgentHostSupervisionEnvelopeV1(
        envelope,
        keyring(),
        expected(value),
        now,
      ),
    ).toBeDefined();
  });

  test("Ed25519 replay is deterministic and remains verifiable", async () => {
    const first = await signed();
    const second = await signed();
    expect(second).toEqual(first);
    expect(
      await verifySignedAgentHostSupervisionEnvelopeV1(
        second,
        keyring(),
        expected(authority()),
        now,
      ),
    ).toBeDefined();
  });

  test("rejects tampered, mismatched, and noncanonical authority bytes", async () => {
    const value = authority();
    const envelope = await signed(value);
    const changed = authority({ nonce: "supervision-nonce-00002" });
    const pretty = Buffer.from(JSON.stringify(value, null, 2)).toString(
      "base64url",
    );
    for (const authorityBytes of [
      flipBase64Url(envelope.authorityBytes),
      Buffer.from(serializeAgentHostSupervisionAuthorityV2(changed)).toString(
        "base64url",
      ),
      pretty,
    ]) {
      expect(
        await verifySignedAgentHostSupervisionEnvelopeV1(
          { ...envelope, authorityBytes },
          keyring(),
          expected(value),
          now,
        ),
      ).toBeUndefined();
    }
    expect(
      await verifySignedAgentHostSupervisionEnvelopeV1(
        { ...envelope, signature: flipBase64Url(envelope.signature) },
        keyring(),
        expected(value),
        now,
      ),
    ).toBeUndefined();
  });

  test("rejects every wrong caller binding", async () => {
    const value = authority();
    const envelope = await signed(value);
    const base = expected(value);
    const wrong: ExpectedAgentHostSupervisionBindingsV2[] = [
      { ...base, fence: { ...base.fence, sessionId: "session-2" } },
      { ...base, fence: { ...base.fence, runId: "run-2" } },
      { ...base, fence: { ...base.fence, turnId: "turn-2" } },
      { ...base, fence: { ...base.fence, generation: 8 } },
      { ...base, planHash: `sha256:${"b".repeat(64)}` },
      { ...base, hostId: "stable-host-2" },
      { ...base, hostGeneration: 4 },
      { ...base, hostIncarnation: "host-incarnation-0002" },
      { ...base, supervisorEpoch: 12 },
      { ...base, kernelServiceEpoch: "kernel-service-epoch-0002" },
      { ...base, hostChallenge: "fresh-challenge-0000002" },
      { ...base, nonce: "supervision-nonce-00002" },
      { ...base, audience: "wrong" as typeof base.audience },
      { ...base, purpose: "wrong" as typeof base.purpose },
    ];
    for (const binding of wrong) {
      expect(
        await verifySignedAgentHostSupervisionEnvelopeV1(
          envelope,
          keyring(),
          binding,
          now,
        ),
      ).toBeUndefined();
    }
  });

  test("enforces unknown, not-yet-valid, and retiring key windows", async () => {
    const value = authority();
    const envelope = await signed(value);
    const verify = (ring: AgentHostSupervisionPublicKeyringV1) =>
      verifySignedAgentHostSupervisionEnvelopeV1(
        envelope,
        ring,
        expected(value),
        now,
      );
    expect(
      await verify(keyring([publicKey({ keyId: "agent-host-key-9999" })])),
    ).toBeUndefined();
    expect(
      await verify(keyring([publicKey({ notBeforeMs: now + 1 })])),
    ).toBeUndefined();
    expect(
      await verify(
        keyring([
          publicKey({
            status: "retiring",
            notAfterMs: now + 1,
            retiredAtMs:
              value.expiresAtMs + MAX_AGENT_HOST_SUPERVISION_CLOCK_SKEW_MS - 1,
          }),
        ]),
      ),
    ).toBeUndefined();
    expect(
      await verify(
        keyring([
          publicKey({
            status: "retiring",
            notAfterMs: now + 1,
            retiredAtMs:
              value.expiresAtMs + MAX_AGENT_HOST_SUPERVISION_CLOCK_SKEW_MS,
          }),
        ]),
      ),
    ).toBeDefined();
  });

  test("supports overlapping rotation and selects authority.keyId only", async () => {
    const nextGenerated = generateKeyPairSync("ed25519");
    const nextId = "agent-host-key-0002";
    const oldValue = authority();
    const oldEnvelope = await signed(oldValue);
    const nextValue = authority({
      keyId: nextId,
      hostChallenge: "fresh-challenge-0000002",
      nonce: "supervision-nonce-00002",
    });
    const nextPrivate = privateKey({
      keyId: nextId,
      privateKeyPkcs8: Buffer.from(
        nextGenerated.privateKey.export({ type: "pkcs8", format: "der" }),
      ).toString("base64url"),
    });
    const nextEnvelope = await signed(nextValue, nextPrivate);
    const overlap = keyring([
      publicKey({
        status: "retiring",
        retiredAtMs: now + 300_000,
      }),
      publicKey({
        keyId: nextId,
        publicKeySpki: Buffer.from(
          nextGenerated.publicKey.export({ type: "spki", format: "der" }),
        ).toString("base64url"),
      }),
    ]);
    expect(
      await verifySignedAgentHostSupervisionEnvelopeV1(
        oldEnvelope,
        overlap,
        expected(oldValue),
        now,
      ),
    ).toBeDefined();
    expect(
      await verifySignedAgentHostSupervisionEnvelopeV1(
        nextEnvelope,
        overlap,
        expected(nextValue),
        now,
      ),
    ).toBeDefined();
    expect(
      await verifySignedAgentHostSupervisionEnvelopeV1(
        { ...nextEnvelope, signature: oldEnvelope.signature },
        overlap,
        expected(nextValue),
        now,
      ),
    ).toBeUndefined();
  });

  test("refuses backdated signing outside the key's current validity", async () => {
    const future = authority({
      issuedAtMs: now + 1,
      expiresAtMs: now + 60_001,
    });
    const futureKey = privateKey({ notBeforeMs: now + 1 });
    await expect(
      signAgentHostSupervisionAuthorityV2(
        serializeAgentHostSupervisionAuthorityV2(future),
        futureKey,
        now,
      ),
    ).rejects.toThrow();
    await expect(
      signAgentHostSupervisionAuthorityV2(
        serializeAgentHostSupervisionAuthorityV2(future),
        futureKey,
        now + 1,
      ),
    ).resolves.toBeDefined();

    const retained = authority({ issuedAtMs: now - 1 });
    const expiredKey = privateKey({
      notBeforeMs: now - 2,
      notAfterMs: now,
    });
    await expect(
      signAgentHostSupervisionAuthorityV2(
        serializeAgentHostSupervisionAuthorityV2(retained),
        expiredKey,
        now - 1,
      ),
    ).resolves.toBeDefined();
    for (const currentTimeMs of [now, now + 1]) {
      await expect(
        signAgentHostSupervisionAuthorityV2(
          serializeAgentHostSupervisionAuthorityV2(retained),
          expiredKey,
          currentTimeMs,
        ),
      ).rejects.toThrow();
    }

    const retiredAtMs =
      retained.expiresAtMs + MAX_AGENT_HOST_SUPERVISION_CLOCK_SKEW_MS;
    const retiredKey = privateKey({ retiredAtMs });
    await expect(
      signAgentHostSupervisionAuthorityV2(
        serializeAgentHostSupervisionAuthorityV2(retained),
        retiredKey,
        now,
      ),
    ).resolves.toBeDefined();
    for (const currentTimeMs of [retiredAtMs, retiredAtMs + 1]) {
      await expect(
        signAgentHostSupervisionAuthorityV2(
          serializeAgentHostSupervisionAuthorityV2(retained),
          retiredKey,
          currentTimeMs,
        ),
      ).rejects.toThrow();
    }
  });

  test("pins lease expiration and issuance skew boundaries", async () => {
    const future = authority({
      issuedAtMs: now + MAX_AGENT_HOST_SUPERVISION_CLOCK_SKEW_MS,
      expiresAtMs: now + MAX_AGENT_HOST_SUPERVISION_CLOCK_SKEW_MS + 1,
    });
    const envelope = await signed(
      future,
      privateKey({ notAfterMs: now + 300_001 }),
    );
    expect(
      await verifySignedAgentHostSupervisionEnvelopeV1(
        envelope,
        keyring(),
        expected(future),
        now,
      ),
    ).toBeDefined();
    const tooFuture = authority({
      issuedAtMs: now + MAX_AGENT_HOST_SUPERVISION_CLOCK_SKEW_MS + 1,
      expiresAtMs: now + MAX_AGENT_HOST_SUPERVISION_CLOCK_SKEW_MS + 2,
    });
    await expect(signed(tooFuture)).rejects.toThrow();
    const ordinary = authority();
    const ordinaryEnvelope = await signed(ordinary);
    expect(
      await verifySignedAgentHostSupervisionEnvelopeV1(
        ordinaryEnvelope,
        keyring(),
        expected(ordinary),
        ordinary.expiresAtMs - 1,
      ),
    ).toBeDefined();
    expect(
      await verifySignedAgentHostSupervisionEnvelopeV1(
        ordinaryEnvelope,
        keyring(),
        expected(ordinary),
        ordinary.expiresAtMs,
      ),
    ).toBeUndefined();
  });

  test("strictly decodes exact bounded envelope and keyring structures", async () => {
    const envelope = await signed();
    expect(decodeSignedAgentHostSupervisionEnvelopeV1(envelope)).toEqual(
      envelope,
    );
    expect(
      decodeSignedAgentHostSupervisionEnvelopeV1({ ...envelope, extra: true }),
    ).toBeUndefined();
    for (const change of [
      { version: 2 },
      { algorithm: "ECDSA" },
      { domain: "opensession.agent-host.supervision.wrong" },
    ]) {
      expect(
        decodeSignedAgentHostSupervisionEnvelopeV1({ ...envelope, ...change }),
      ).toBeUndefined();
    }
    expect(
      decodeSignedAgentHostSupervisionEnvelopeV1({
        ...envelope,
        signature: `${envelope.signature}=`,
      }),
    ).toBeUndefined();
    expect(
      decodeSignedAgentHostSupervisionEnvelopeV1({
        ...envelope,
        authorityBytes: "a".repeat(6_000),
      }),
    ).toBeUndefined();
    expect(decodeAgentHostSupervisionPublicKeyringV1(keyring())).toBeDefined();
    expect(
      decodeAgentHostSupervisionPublicKeyringV1({ ...keyring(), extra: true }),
    ).toBeUndefined();
    expect(
      decodeAgentHostSupervisionPublicKeyringV1(
        keyring([publicKey(), publicKey()]),
      ),
    ).toBeUndefined();
    expect(
      decodeAgentHostSupervisionPublicKeyringV1(
        keyring([
          publicKey({ publicKeySpki: Buffer.alloc(44).toString("base64url") }),
        ]),
      ),
    ).toBeUndefined();
    expect(
      decodeAgentHostSupervisionPublicKeyringV1(
        keyring(
          Array.from({ length: 33 }, (_, index) =>
            publicKey({
              keyId: `agent-host-key-${String(index).padStart(4, "0")}`,
            }),
          ),
        ),
      ),
    ).toBeUndefined();
  });

  test("rejects noncanonical authority JSON and malformed or mismatched PKCS8", async () => {
    const value = authority();
    const pretty = Buffer.from(JSON.stringify(value, null, 2));
    await expect(
      signAgentHostSupervisionAuthorityV2(pretty, privateKey(), now),
    ).rejects.toThrow();
    await expect(
      signed(value, privateKey({ keyId: "agent-host-key-9999" })),
    ).rejects.toThrow();
    await expect(
      signed(
        value,
        privateKey({ privateKeyPkcs8: Buffer.alloc(48).toString("base64url") }),
      ),
    ).rejects.toThrow();
    await expect(
      signed(
        value,
        privateKey({
          privateKeyPkcs8: `${Buffer.from(pkcs8).toString("base64url")}=`,
        }),
      ),
    ).rejects.toThrow();
  });

  test("modules are import-inert", async () => {
    const child = Bun.spawn(
      [
        process.execPath,
        "-e",
        `await import(${JSON.stringify(new URL("./agent-host-supervision-signer.ts", import.meta.url).href)}); await import(${JSON.stringify(new URL("../../../../protocol/src/agent-host-supervision.ts", import.meta.url).href)}); console.log("imported")`,
      ],
      { stdout: "pipe", stderr: "pipe" },
    );
    expect(await child.exited).toBe(0);
    expect(await new Response(child.stdout).text()).toBe("imported\n");
    expect(await new Response(child.stderr).text()).toBe("");
  });
});
