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
import {
  closeSync,
  existsSync,
  openSync,
  readFileSync,
  statSync,
  unlinkSync,
} from "fs";
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
export async function disconnectXai(): Promise<boolean> {
  for (const flow of flows().values()) flow.controller.abort();
  flows().clear();
  // Through the same lock as every write: otherwise an unlink can land between
  // a refresh reading the generation and writing it back, and the credential
  // comes back from the dead.
  return withStoreLock(async () => {
    try {
      if (!existsSync(storePath())) return false;
      unlinkSync(storePath());
      return true;
    } catch {
      return false;
    }
  });
}

// ── Serialization ───────────────────────────────────────────────────────────

/** pi's CredentialStore contract requires "mutual exclusion per provider id,
 *  cross-process too where the backing store supports it", and it runs the
 *  network refresh INSIDE modify(). Without that, two turns whose token expires
 *  together both POST the same refresh_token; xAI rotates, so one persists a
 *  token the other has already invalidated and the shared workspace credential
 *  dies until an admin signs in again.
 *
 *  In-process chaining is what actually serializes this deployment's turns. The
 *  lock file is for a second server sharing the state dir; it is best-effort by
 *  design — after the wait it proceeds anyway, because blocking a turn forever
 *  is worse than the narrow race it is protecting against. */
const LOCK_STALE_MS = 30_000;
const LOCK_WAIT_MS = 10_000;

function chain(): Promise<void> {
  const g = globalThis as typeof globalThis & {
    __opensessionXaiLockChain?: Promise<void>;
  };
  return (g.__opensessionXaiLockChain ??= Promise.resolve());
}

function setChain(next: Promise<void>): void {
  (
    globalThis as typeof globalThis & {
      __opensessionXaiLockChain?: Promise<void>;
    }
  ).__opensessionXaiLockChain = next;
}

function lockPath(): string {
  return `${storePath()}.lock`;
}

function takeFileLock(): boolean {
  const deadline = Date.now() + LOCK_WAIT_MS;
  // EVERY path through this loop must reach the deadline check. An earlier
  // version continued straight back to the top when statSync also failed - a
  // missing parent directory then span this synchronously, forever, on the
  // credential path.
  while (Date.now() <= deadline) {
    try {
      closeSync(openSync(lockPath(), "wx", 0o600));
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code !== "EEXIST") {
        // Not contention: the directory is missing or unwritable. Locking is
        // best effort, so say so once and let the caller proceed rather than
        // spinning against a condition that will not clear.
        return false;
      }
      try {
        // A holder that died leaves its lock behind; reap it rather than
        // stalling every future refresh on this box.
        if (Date.now() - statSync(lockPath()).mtimeMs > LOCK_STALE_MS) {
          unlinkSync(lockPath());
        }
      } catch {
        // The holder released it between our open and our stat. Retry.
      }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25);
    }
  }
  return false;
}

function dropFileLock(): void {
  try {
    unlinkSync(lockPath());
  } catch {}
}

function lockHeld(): boolean {
  return (
    (globalThis as typeof globalThis & { __opensessionXaiLockHeld?: boolean })
      .__opensessionXaiLockHeld === true
  );
}

function setLockHeld(held: boolean): void {
  (
    globalThis as typeof globalThis & { __opensessionXaiLockHeld?: boolean }
  ).__opensessionXaiLockHeld = held;
}

/** Run a read-modify-write against the shared credential with nothing else
 *  touching it. */
async function withStoreLock<T>(run: () => Promise<T>): Promise<T> {
  // Re-entrant by design: disconnectXai takes this lock, and it is also
  // reachable from inside a modify() callback. The chain guarantees only one
  // holder is ever running, so seeing the flag set means WE are that holder -
  // and waiting on ourselves would simply deadlock.
  if (lockHeld()) return run();
  const previous = chain();
  let release!: () => void;
  const mine = new Promise<void>((resolve) => (release = resolve));
  setChain(previous.then(() => mine));
  await previous.catch(() => undefined);
  const held = takeFileLock();
  if (!held) {
    console.warn(
      "[xai] could not take the credential lock in time; proceeding unlocked",
    );
  }
  setLockHeld(true);
  try {
    return await run();
  } finally {
    setLockHeld(false);
    if (held) dropFileLock();
    release();
  }
}

// ── The write-through credential store handed to a per-turn runtime ─────────

/** pi's own CredentialStore type, derived from the SDK so this stays a
 *  type-only reference and never pulls pi into the module graph at import. */
export type PiCredentialStore = NonNullable<
  NonNullable<Parameters<typeof ModelRuntime.create>[0]>["credentials"]
>;
type PiCredential = Awaited<ReturnType<PiCredentialStore["read"]>>;

export interface XaiStoreOptions {
  /** Aborting this refuses every write through this store. A device login runs
   *  against a store bound to its own flow, so cancelling the flow stops the
   *  credential pi is about to persist rather than racing it afterwards. */
  signal?: AbortSignal;
  /** Recorded on a credential this store creates, for the Settings card. */
  connectedBy?: string;
}

/**
 * A credential store for one turn or one login: the shared xAI credential is
 * read from and written back to disk, every other provider stays in memory.
 *
 * `modify` is the ONLY write path, as pi's contract says it is. pi persists a
 * login through it and refreshes through it, so both go through the same lock,
 * the same abort check and the same generation check. A refresh that finishes
 * after an admin disconnected or reconnected finds a different generation and
 * drops its write instead of resurrecting a credential nobody is using.
 */
export function xaiCredentialStore(
  options: XaiStoreOptions = {},
): PiCredentialStore {
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
      return withStoreLock(async () => {
        const before = readStore();
        const next = await fn(before ? piCredential(before) : undefined);
        const keep = () => {
          const now = readStore();
          return now ? piCredential(now) : undefined;
        };
        if (next === undefined) return keep();
        if (
          next.type !== "oauth" ||
          typeof next.access !== "string" ||
          typeof next.refresh !== "string" ||
          typeof next.expires !== "number"
        ) {
          // Not something this store can persist. Leave the stored credential
          // alone rather than overwriting a working token with an api-key entry.
          return keep();
        }
        // The admin cancelled this login, or disconnected the workspace, while
        // xAI was still answering. pi commits its own write before login()
        // resolves, so refusing here is the only place that can stop it.
        if (options.signal?.aborted) return keep();
        const current = readStore();
        if (before) {
          if (!current || current.generation !== before.generation)
            return keep();
          const merged: XaiStoredCredential = {
            ...before,
            access: next.access,
            refresh: next.refresh,
            expires: next.expires,
          };
          writeStore(merged);
          return piCredential(merged);
        }
        // Nothing was stored: this is a first connect. A new generation makes
        // every refresh still in flight against the credential this replaces
        // decline to write.
        if (current) return keep();
        const created: XaiStoredCredential = {
          type: "oauth",
          access: next.access,
          refresh: next.refresh,
          expires: next.expires,
          generation: randomUUID(),
          connectedAt: Date.now(),
          connectedBy: options.connectedBy,
        };
        writeStore(created);
        return piCredential(created);
      });
    },
    async delete(id: string) {
      if (id !== XAI_PROVIDER_ID) {
        memory.delete(id);
        return;
      }
      // Only the stored credential. Aborting live device logins is an admin
      // action (disconnectXai), not something a pi-side logout should do.
      await withStoreLock(async () => {
        try {
          if (existsSync(storePath())) unlinkSync(storePath());
        } catch {}
      });
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
  loadRuntime: (
    signal: AbortSignal,
    connectedBy?: string,
  ) => Promise<{
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
  const controller = new AbortController();
  let runtime;
  try {
    runtime = await loadRuntime(controller.signal, connectedBy);
  } catch (error) {
    return { error: describe(error) };
  }

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
    .then(() => {
      // No write here. pi persists the credential through the store above,
      // which is the only write path and already applied the lock, the abort
      // check and the generation check. Writing again would be a second,
      // unserialized path - which is exactly how a cancelled reconnect used to
      // replace a live credential.
      const flow = flows().get(id);
      if (!xaiConnected()) {
        if (flow) {
          flow.settled = { ok: false, error: "The Grok sign-in was cancelled" };
        }
        return;
      }
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
    // Deliberately not "connected": a credential may exist because someone
    // else connected one. This flow's own outcome is simply no longer known.
    return {
      status: "error",
      error: "That Grok login is no longer in progress",
    };
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

async function defaultLoginRuntime(signal: AbortSignal, connectedBy?: string) {
  const sdk = await import("@earendil-works/pi-coding-agent");
  const runtime = await sdk.ModelRuntime.create({
    credentials: xaiCredentialStore({ signal, connectedBy }),
    modelsPath: null,
  });
  return runtime as unknown as Awaited<
    ReturnType<NonNullable<Parameters<typeof startXaiLogin>[1]>>
  >;
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
