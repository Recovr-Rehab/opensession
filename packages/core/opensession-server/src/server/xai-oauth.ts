/**
 * The ONE shared xAI (Grok) subscription for this workspace.
 *
 * pi already ships a complete xAI integration: the RFC 8628 device flow
 * against auth.x.ai, refresh with rotation, the Grok model catalog, and the
 * openai-responses compatibility for api.x.ai. None of that is reimplemented
 * here, because a second copy of an OAuth client is a second copy of its bugs.
 *
 * What pi cannot own is WHERE this workspace's single credential lives. Every
 * turn builds its own ModelRuntime with an in-memory credential store, so a
 * token pi refreshes mid-turn would die with that runtime and leave the stored
 * refresh token behind a rotation. This module supplies a write-through store
 * instead: pi reads the shared credential through it and persists whatever it
 * refreshes, under a generation stamp so a refresh that lands after an admin
 * disconnected cannot resurrect the credential it replaced.
 */
import type { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { existsSync, readFileSync, unlinkSync } from "fs";
import { randomUUID } from "crypto";
import { stateDir } from "./paths";
import { writeJsonAtomic } from "./shared/atomic-write";

/** pi's builtin provider id. Using it is what makes pi's catalog, its
 *  device flow and its api.x.ai compatibility apply without registration. */
export const XAI_PROVIDER_ID = "xai";

/** A pending device login is useless once its own code has expired; keep the
 *  record a little past that so a slow poll still gets a real answer. */
const FLOW_GRACE_MS = 2 * 60_000;

function storePath(): string {
  return stateDir("xai-oauth.json");
}

/** The shared credential, in pi's own OAuthCredential shape plus the
 *  provenance the Settings card shows and the generation stamp that makes a
 *  late write safe. */
export interface XaiStoredCredential {
  type: "oauth";
  access: string;
  refresh: string;
  /** Epoch ms, already reduced by pi's refresh skew. */
  expires: number;
  generation: string;
  connectedAt: number;
  connectedBy?: string;
}

export interface XaiStatusPublic {
  connected: boolean;
  connectedAt?: number;
  connectedBy?: string;
  expiresAt?: number;
}

function readStore(): XaiStoredCredential | null {
  try {
    if (!existsSync(storePath())) return null;
    const parsed = JSON.parse(readFileSync(storePath(), "utf-8"));
    if (
      !parsed ||
      typeof parsed.access !== "string" ||
      typeof parsed.refresh !== "string" ||
      typeof parsed.generation !== "string"
    ) {
      return null;
    }
    return { ...parsed, type: "oauth" } as XaiStoredCredential;
  } catch {
    return null;
  }
}

function writeStore(credential: XaiStoredCredential): void {
  // 0600 at CREATION, not after: writeJsonAtomic passes the mode to openSync,
  // so the inode is private before any bytes land. Chmod-after-rename leaves a
  // window where the tokens sit world-readable under the default umask, and a
  // failed chmod would leave them that way for good.
  writeJsonAtomic(storePath(), credential, true, 0o600);
}

export function xaiStatus(): XaiStatusPublic {
  const stored = readStore();
  if (!stored) return { connected: false };
  return {
    connected: true,
    connectedAt: stored.connectedAt,
    connectedBy: stored.connectedBy,
    expiresAt: stored.expires,
  };
}

export function xaiConnected(): boolean {
  return readStore() !== null;
}

/** Drop the shared credential and abandon any login still in flight, so a
 *  device flow an admin walked away from cannot land on top of a disconnect. */
export function disconnectXai(): boolean {
  for (const flow of flows().values()) flow.controller.abort();
  flows().clear();
  try {
    if (!existsSync(storePath())) return false;
    unlinkSync(storePath());
    return true;
  } catch {
    return false;
  }
}

// ── The write-through credential store handed to a per-turn runtime ─────────

/** pi's own CredentialStore type, derived from the SDK so this stays a
 *  type-only reference and never pulls pi into the module graph at import. */
export type PiCredentialStore = NonNullable<
  NonNullable<Parameters<typeof ModelRuntime.create>[0]>["credentials"]
>;
type PiCredential = Awaited<ReturnType<PiCredentialStore["read"]>>;

/**
 * A credential store for one turn: the shared xAI credential is read from and
 * written back to disk, every other provider stays in memory.
 *
 * The generation stamp is the whole safety property. pi refreshes inside
 * `modify`, so a refresh can complete after an admin has disconnected or
 * replaced the credential. Re-reading the file and persisting only when the
 * generation still matches means a stale winner drops its write instead of
 * reviving a credential nobody is using any more.
 */
export function xaiCredentialStore(): PiCredentialStore {
  const memory = new Map<string, PiCredential>();
  return {
    async read(id: string) {
      if (id !== XAI_PROVIDER_ID) return memory.get(id);
      const stored = readStore();
      return stored ? piCredential(stored) : undefined;
    },
    async list() {
      const rows = [...memory.entries()]
        .filter(([, credential]) => credential !== undefined)
        .map(([providerId, credential]) => ({
          providerId,
          type: credential!.type,
        }));
      if (readStore()) {
        rows.push({ providerId: XAI_PROVIDER_ID, type: "oauth" as const });
      }
      return rows;
    },
    async modify(
      id: string,
      fn: (current: PiCredential) => Promise<PiCredential>,
    ) {
      if (id !== XAI_PROVIDER_ID) {
        const next = await fn(memory.get(id));
        if (next !== undefined) memory.set(id, next);
        return memory.get(id);
      }
      const before = readStore();
      const next = await fn(before ? piCredential(before) : undefined);
      if (next === undefined) return before ? piCredential(before) : undefined;
      if (
        next.type !== "oauth" ||
        typeof next.access !== "string" ||
        typeof next.refresh !== "string" ||
        typeof next.expires !== "number"
      ) {
        // Not something this store can persist. Leave the stored credential
        // alone rather than overwriting a working token with an api-key entry.
        return before ? piCredential(before) : undefined;
      }
      const current = readStore();
      if (!before || !current || current.generation !== before.generation) {
        // Disconnected or replaced while this refresh was in flight. Two turns
        // refreshing at the same instant can still both write; they write the
        // same rotation, and a shared subscription has no per-turn identity to
        // lock against, so the generation stamp guards the case that actually
        // loses data - a write landing after a disconnect.
        return current ? piCredential(current) : undefined;
      }
      const merged: XaiStoredCredential = {
        ...before,
        access: next.access,
        refresh: next.refresh,
        expires: next.expires,
      };
      writeStore(merged);
      return piCredential(merged);
    },
    async delete(id: string) {
      if (id !== XAI_PROVIDER_ID) {
        memory.delete(id);
        return;
      }
      disconnectXai();
    },
  };
}

function piCredential(stored: XaiStoredCredential) {
  return {
    type: "oauth" as const,
    access: stored.access,
    refresh: stored.refresh,
    expires: stored.expires,
  };
}

// ── Device login, driven through pi's own flow ─────────────────────────────

export interface XaiLoginFlow {
  id: string;
  userCode: string;
  verificationUri: string;
  expiresAt: number;
  controller: AbortController;
  settled?: { ok: true } | { ok: false; error: string };
}

/** Module-global so a reload of this module during dev does not strand a
 *  login the browser is still polling. */
function flows(): Map<string, XaiLoginFlow> {
  const g = globalThis as typeof globalThis & {
    __opensessionXaiFlows?: Map<string, XaiLoginFlow>;
  };
  return (g.__opensessionXaiFlows ??= new Map());
}

function pruneFlows(): void {
  const now = Date.now();
  for (const [id, flow] of flows()) {
    if (now > flow.expiresAt + FLOW_GRACE_MS) {
      flow.controller.abort();
      flows().delete(id);
    }
  }
}

export interface XaiLoginStarted {
  flowId: string;
  userCode: string;
  verificationUri: string;
  expiresAt: number;
}

/**
 * Begin pi's xAI device flow and return the code to show the admin. The login
 * promise keeps running in the background; `pollXaiLogin` reports where it got
 * to. `loadRuntime` is a seam so tests do not need the real pi SDK.
 */
export async function startXaiLogin(
  connectedBy?: string,
  loadRuntime: () => Promise<{
    login: (
      providerId: string,
      type: "oauth",
      interaction: {
        signal: AbortSignal;
        prompt: (prompt: unknown) => Promise<string>;
        notify: (event: Record<string, unknown>) => void;
      },
    ) => Promise<unknown>;
  }> = defaultLoginRuntime,
): Promise<XaiLoginStarted | { error: string }> {
  pruneFlows();
  let runtime;
  try {
    runtime = await loadRuntime();
  } catch (error) {
    return { error: describe(error) };
  }

  const controller = new AbortController();
  let announce: (started: XaiLoginStarted) => void = () => undefined;
  let fail: (error: Error) => void = () => undefined;
  const announced = new Promise<XaiLoginStarted>((resolve, reject) => {
    announce = resolve;
    fail = reject;
  });
  const id = randomUUID();

  const login = runtime
    .login(XAI_PROVIDER_ID, "oauth", {
      signal: controller.signal,
      // pi's xAI flow never prompts; anything that does is a flow we cannot
      // drive from an HTTP round trip, so fail loudly instead of hanging.
      prompt: async () => {
        throw new Error("xAI login asked for interactive input");
      },
      notify: (event) => {
        if (event.type !== "device_code") return;
        const expiresInSeconds =
          typeof event.expiresInSeconds === "number"
            ? event.expiresInSeconds
            : 600;
        announce({
          flowId: id,
          userCode: String(event.userCode ?? ""),
          verificationUri: String(event.verificationUri ?? ""),
          expiresAt: Date.now() + expiresInSeconds * 1_000,
        });
      },
    })
    .then((credential) => {
      const value = credential as {
        access?: unknown;
        refresh?: unknown;
        expires?: unknown;
      };
      if (
        typeof value?.access !== "string" ||
        typeof value?.refresh !== "string"
      ) {
        throw new Error("xAI returned no usable credential");
      }
      writeStore({
        type: "oauth",
        access: value.access,
        refresh: value.refresh,
        expires:
          typeof value.expires === "number"
            ? value.expires
            : Date.now() + 55 * 60_000,
        // A new generation on every connect: refreshes still in flight against
        // the credential this one replaces will decline to write.
        generation: randomUUID(),
        connectedAt: Date.now(),
        connectedBy,
      });
      const flow = flows().get(id);
      if (flow) flow.settled = { ok: true };
    })
    .catch((error: unknown) => {
      const flow = flows().get(id);
      if (flow) flow.settled = { ok: false, error: describe(error) };
      fail(error instanceof Error ? error : new Error(describe(error)));
    });
  void login;

  let started: XaiLoginStarted;
  try {
    started = await announced;
  } catch (error) {
    controller.abort();
    return { error: describe(error) };
  }
  flows().set(id, {
    id,
    userCode: started.userCode,
    verificationUri: started.verificationUri,
    expiresAt: started.expiresAt,
    controller,
  });
  return started;
}

export type XaiPollResult =
  | { status: "pending" }
  | { status: "connected"; state: XaiStatusPublic }
  | { status: "error"; error: string };

/** Report where a started login got to, and retire the flow once it is done. */
export function pollXaiLogin(flowId: string): XaiPollResult {
  pruneFlows();
  const flow = flows().get(flowId);
  if (!flow) {
    // A flow that completed and was already collected still leaves evidence.
    return xaiConnected()
      ? { status: "connected", state: xaiStatus() }
      : { status: "error", error: "That Grok login is no longer in progress" };
  }
  if (!flow.settled) return { status: "pending" };
  flows().delete(flowId);
  return flow.settled.ok
    ? { status: "connected", state: xaiStatus() }
    : { status: "error", error: flow.settled.error };
}

/** Cancel a login the admin backed out of. */
export function cancelXaiLogin(flowId: string): boolean {
  const flow = flows().get(flowId);
  if (!flow) return false;
  flow.controller.abort();
  flows().delete(flowId);
  return true;
}

async function defaultLoginRuntime() {
  const sdk = await import("@earendil-works/pi-coding-agent");
  const runtime = await sdk.ModelRuntime.create({
    credentials: xaiCredentialStore(),
    modelsPath: null,
  });
  return runtime as unknown as Awaited<
    ReturnType<NonNullable<Parameters<typeof startXaiLogin>[1]>>
  >;
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
