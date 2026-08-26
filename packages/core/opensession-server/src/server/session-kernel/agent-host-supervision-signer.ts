import {
  AGENT_HOST_SUPERVISION_ENVELOPE_VERSION,
  AGENT_HOST_SUPERVISION_SIGNATURE_ALGORITHM,
  AGENT_HOST_SUPERVISION_SIGNATURE_DOMAIN,
  agentHostSupervisionSigningBytesV1,
  decodeCanonicalAgentHostSupervisionAuthorityBytesV2,
  type SignedAgentHostSupervisionEnvelopeV1,
} from "@tellahq/opensession-protocol/agent-host-supervision";
import { MAX_AGENT_HOST_SUPERVISION_CLOCK_SKEW_MS } from "@tellahq/opensession-protocol/agent-host";

const ED25519_PKCS8_BYTES = 48;
const KEY_ID_RE = /^[A-Za-z0-9_-]{16,128}$/;
const PKCS8_PREFIX = Uint8Array.from([
  0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x04,
  0x22, 0x04, 0x20,
]);

/** Kernel-private key configuration. CryptoKey implementations do not expose
 * or guarantee zeroization of their internal key copy, and JavaScript strings
 * cannot be wiped. Credential loading must minimize the base64url string's
 * lifetime. Both temporary mutable PKCS8 byte copies are wiped after import. */
export interface AgentHostSupervisionPrivateSigningKeyV1 {
  readonly keyId: string;
  readonly privateKeyPkcs8: string;
  readonly notBeforeMs: number;
  readonly notAfterMs: number;
  readonly retiredAtMs: number | null;
}

function canonicalBase64Url(
  value: string,
  expectedBytes: number,
): Uint8Array | undefined {
  // PKCS8 is exactly 48 bytes, so its unpadded base64url form is exactly 64
  // symbols with no unused trailing bits. Alphabet and length therefore prove
  // canonical encoding without creating a second secret-bearing byte copy.
  if (
    value.length !== Math.ceil((expectedBytes * 4) / 3) ||
    value.includes("=") ||
    !/^[A-Za-z0-9_-]+$/.test(value)
  )
    return undefined;
  const bytes = Buffer.from(value, "base64url");
  if (bytes.byteLength === expectedBytes) return bytes;
  bytes.fill(0);
  return undefined;
}

function ownedArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

function validKey(
  value: AgentHostSupervisionPrivateSigningKeyV1,
): value is AgentHostSupervisionPrivateSigningKeyV1 {
  return (
    !!value &&
    typeof value === "object" &&
    Object.keys(value).length === 5 &&
    Object.keys(value).every((key) =>
      [
        "keyId",
        "privateKeyPkcs8",
        "notBeforeMs",
        "notAfterMs",
        "retiredAtMs",
      ].includes(key),
    ) &&
    KEY_ID_RE.test(value.keyId) &&
    typeof value.privateKeyPkcs8 === "string" &&
    Number.isSafeInteger(value.notBeforeMs) &&
    value.notBeforeMs >= 0 &&
    Number.isSafeInteger(value.notAfterMs) &&
    value.notAfterMs > value.notBeforeMs &&
    (value.retiredAtMs === null ||
      (Number.isSafeInteger(value.retiredAtMs) &&
        value.retiredAtMs > value.notBeforeMs))
  );
}

/** Import-inert SessionKernel signing primitive. It is deliberately not wired
 * into gateway composition or the live actor service in this slice. */
export async function signAgentHostSupervisionAuthorityV2(
  canonicalAuthorityBytes: Uint8Array,
  signingKey: AgentHostSupervisionPrivateSigningKeyV1,
  nowMs: number,
): Promise<SignedAgentHostSupervisionEnvelopeV1> {
  if (!Number.isSafeInteger(nowMs) || nowMs < 0 || !validKey(signingKey))
    throw new Error("Invalid Agent Host signing inputs");
  const authorityBytes = Uint8Array.from(canonicalAuthorityBytes);
  const authority = decodeCanonicalAgentHostSupervisionAuthorityBytesV2(
    authorityBytes,
    nowMs,
  );
  if (
    !authority ||
    authority.keyId !== signingKey.keyId ||
    nowMs < signingKey.notBeforeMs ||
    nowMs >= signingKey.notAfterMs ||
    authority.issuedAtMs < signingKey.notBeforeMs ||
    authority.issuedAtMs >= signingKey.notAfterMs ||
    (signingKey.retiredAtMs !== null &&
      (nowMs >= signingKey.retiredAtMs ||
        signingKey.retiredAtMs <
          authority.expiresAtMs + MAX_AGENT_HOST_SUPERVISION_CLOCK_SKEW_MS))
  )
    throw new Error("Agent Host authority is not valid for the signing key");
  const pkcs8 = canonicalBase64Url(
    signingKey.privateKeyPkcs8,
    ED25519_PKCS8_BYTES,
  );
  if (!pkcs8 || !PKCS8_PREFIX.every((byte, index) => pkcs8[index] === byte)) {
    pkcs8?.fill(0);
    throw new Error("Invalid Ed25519 PKCS8 private key");
  }
  const pkcs8Buffer = ownedArrayBuffer(pkcs8);
  try {
    const privateKey = await crypto.subtle.importKey(
      "pkcs8",
      pkcs8Buffer,
      { name: AGENT_HOST_SUPERVISION_SIGNATURE_ALGORITHM },
      false,
      ["sign"],
    );
    const signature = new Uint8Array(
      await crypto.subtle.sign(
        AGENT_HOST_SUPERVISION_SIGNATURE_ALGORITHM,
        privateKey,
        ownedArrayBuffer(agentHostSupervisionSigningBytesV1(authorityBytes)),
      ),
    );
    if (signature.byteLength !== 64)
      throw new Error("Invalid Ed25519 signature length");
    return Object.freeze({
      version: AGENT_HOST_SUPERVISION_ENVELOPE_VERSION,
      algorithm: AGENT_HOST_SUPERVISION_SIGNATURE_ALGORITHM,
      domain: AGENT_HOST_SUPERVISION_SIGNATURE_DOMAIN,
      authorityBytes: Buffer.from(authorityBytes).toString("base64url"),
      signature: Buffer.from(signature).toString("base64url"),
    });
  } finally {
    pkcs8.fill(0);
    new Uint8Array(pkcs8Buffer).fill(0);
  }
}
