/**
 * Per-user Traces credentials. A namespace API key cannot author as a person
 * (it is the key creator, or a linked Traces Agent). The CLI device session
 * can: each Open Session user connects Traces with GitHub, and publishes use
 * that device token. Join key is GitHub login (Open Session createdByLogin
 * and Traces displayName / personal slug).
 */
import { randomUUIDv7 } from "bun";
import { chmodSync, existsSync, readFileSync } from "fs";
import { stateDir } from "../../server/paths";
import { writeJsonAtomic } from "../../server/shared/atomic-write";
import { fetchWithTimeout } from "../../server/shared/fetch-with-timeout";
import { tracesApiBase, tracesDeviceName } from "./config";

export function tracesAuthStorePath(): string {
  return process.env.OPENSESSION_TRACES_AUTH_STORE || stateDir("traces-auth.json");
}

export interface TracesConnectedAccount {
  githubLogin: string;
  tracesUserId: string;
  displayName: string;
  namespaceSlug: string;
  namespaceType: string;
  connectedAt: string;
}

interface StoredAccount extends TracesConnectedAccount {
  deviceKey: string;
  namespaceId: string;
}

interface Store {
  deviceId: string;
  users: Record<string, StoredAccount>;
}

type TracesEnvelope<T> = {
  ok?: boolean;
  data?: T;
  error?: { code?: string; message?: string } | string;
};

function loginKey(login: string): string {
  return login.trim().toLowerCase();
}

function readStore(): Store {
  const path = tracesAuthStorePath();
  if (!existsSync(path)) {
    return { deviceId: randomUUIDv7(), users: {} };
  }
  try {
    const raw = JSON.parse(readFileSync(path, "utf-8")) as Partial<Store>;
    return {
      deviceId: typeof raw.deviceId === "string" && raw.deviceId ? raw.deviceId : randomUUIDv7(),
      users: raw.users && typeof raw.users === "object" ? raw.users : {},
    };
  } catch {
    return { deviceId: randomUUIDv7(), users: {} };
  }
}

function writeStore(store: Store): void {
  const path = tracesAuthStorePath();
  writeJsonAtomic(path, store);
  try {
    chmodSync(path, 0o600);
  } catch {}
}

function publicAccount(account: StoredAccount): TracesConnectedAccount {
  return {
    githubLogin: account.githubLogin,
    tracesUserId: account.tracesUserId,
    displayName: account.displayName,
    namespaceSlug: account.namespaceSlug,
    namespaceType: account.namespaceType,
    connectedAt: account.connectedAt,
  };
}

export function listTracesAccounts(): TracesConnectedAccount[] {
  return Object.values(readStore().users).map(publicAccount);
}

export function tracesAccountForLogin(login: string | null | undefined): TracesConnectedAccount | null {
  if (!login) return null;
  const account = readStore().users[loginKey(login)];
  return account ? publicAccount(account) : null;
}

/** Device bearer for publishing. Never returned over HTTP. */
export function tracesCredentialForLogin(login: string | null | undefined): {
  githubLogin: string;
  deviceKey: string;
  namespaceSlug: string;
} | null {
  if (!login) return null;
  const account = readStore().users[loginKey(login)];
  if (!account?.deviceKey) return null;
  return {
    githubLogin: account.githubLogin,
    deviceKey: account.deviceKey,
    namespaceSlug: account.namespaceSlug,
  };
}

export function disconnectTracesAccount(login: string): boolean {
  const store = readStore();
  const key = loginKey(login);
  if (!store.users[key]) return false;
  delete store.users[key];
  writeStore(store);
  return true;
}

function errorMessage(body: TracesEnvelope<unknown> | null, fallback: string): string {
  const err = body?.error;
  if (typeof err === "string" && err.trim()) return err;
  if (err && typeof err === "object" && typeof err.message === "string") return err.message;
  return fallback;
}

async function tracesFetch<T>(
  path: string,
  init: RequestInit = {},
  token?: string,
): Promise<{ status: number; body: TracesEnvelope<T> | null }> {
  const headers = new Headers(init.headers);
  headers.set("Accept", "application/json");
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  headers.set("User-Agent", `opensession (${tracesDeviceName()})`);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const res = await fetchWithTimeout(`${tracesApiBase()}${path}`, { ...init, headers });
  const body = (await res.json().catch(() => null)) as TracesEnvelope<T> | null;
  return { status: res.status, body };
}

export type TracesConnectStart = {
  state: string;
  verificationUrl: string;
  expiresIn: number;
  pollInterval: number;
};

export type TracesConnectPoll =
  | { status: "pending" }
  | { status: "ok"; account: TracesConnectedAccount }
  | { status: "error"; error: string };

type WatchedFlow = TracesConnectPoll & { expiresAt: number };

const watchedFlows: Map<string, WatchedFlow> = ((globalThis as any).__osWatchedTracesFlows ??=
  new Map());

function sweepWatchedFlows(): void {
  const now = Date.now();
  for (const [state, flow] of watchedFlows) {
    if (flow.expiresAt < now) watchedFlows.delete(state);
  }
}

export async function startTracesConnect(): Promise<TracesConnectStart | { error: string }> {
  const store = readStore();
  writeStore(store);
  const { status, body } = await tracesFetch<TracesConnectStart>("/v1/auth/cli/start", {
    method: "POST",
    body: JSON.stringify({
      provider: "github",
      deviceId: store.deviceId,
      deviceName: tracesDeviceName(),
    }),
  });
  const data = body?.data;
  if (!body?.ok || !data?.state || !data.verificationUrl) {
    return { error: errorMessage(body, `Traces login start failed (${status})`) };
  }
  return {
    state: data.state,
    verificationUrl: data.verificationUrl,
    expiresIn: typeof data.expiresIn === "number" ? data.expiresIn : 600,
    pollInterval: typeof data.pollInterval === "number" ? data.pollInterval : 2,
  };
}

type StatusPayload = {
  status?: string;
  exchangeCode?: string;
  error?: string;
};

type CompletePayload = {
  session?: {
    token?: string;
    userId?: string;
    namespaceId?: string;
    namespaceSlug?: string;
    namespaceType?: string;
  };
};

type SessionPayload = {
  user?: { id?: string; displayName?: string; avatarUrl?: string };
  actor?: {
    displayName?: string;
    namespace?: { slug?: string; type?: string };
  };
  activeNamespace?: { id?: string; slug?: string; type?: string };
  namespace?: { id?: string; slug?: string; type?: string };
};

/** GitHub login claimed by a Traces session (personal slug, else display name). */
export function githubLoginFromTracesSession(session: SessionPayload): string | null {
  const slug = session.actor?.namespace?.type === "individual" ? session.actor.namespace.slug : null;
  const name = session.user?.displayName || session.actor?.displayName;
  const value = (slug || name || "").trim();
  return value || null;
}

async function completeAndStore(
  state: string,
  exchangeCode: string,
  expectedLogin?: string | null,
): Promise<TracesConnectPoll> {
  const { status, body } = await tracesFetch<CompletePayload>("/v1/auth/cli/complete", {
    method: "POST",
    body: JSON.stringify({ state, exchangeCode }),
  });
  const session = body?.data?.session;
  const token = session?.token;
  if (!body?.ok || !token) {
    return { status: "error", error: errorMessage(body, `Traces login complete failed (${status})`) };
  }
  const who = await tracesFetch<SessionPayload>("/v1/session", { method: "GET" }, token);
  const identity = who.body?.data;
  if (!who.body?.ok || !identity) {
    return { status: "error", error: errorMessage(who.body, "Traces session lookup failed") };
  }
  const githubLogin = githubLoginFromTracesSession(identity);
  if (!githubLogin) {
    return { status: "error", error: "Traces did not return a GitHub identity for this login" };
  }
  if (expectedLogin && loginKey(expectedLogin) !== loginKey(githubLogin)) {
    return {
      status: "error",
      error: `Traces is signed in as ${githubLogin}, but this Open Session account is ${expectedLogin}. Connect the same GitHub account.`,
    };
  }
  const ns = identity.activeNamespace || identity.namespace;
  const store = readStore();
  const account: StoredAccount = {
    githubLogin,
    tracesUserId: identity.user?.id || session.userId || "",
    displayName: identity.user?.displayName || githubLogin,
    deviceKey: token,
    namespaceId: ns?.id || session.namespaceId || "",
    namespaceSlug: ns?.slug || session.namespaceSlug || "",
    namespaceType: ns?.type || session.namespaceType || "",
    connectedAt: new Date().toISOString(),
  };
  store.users[loginKey(githubLogin)] = account;
  writeStore(store);
  return { status: "ok", account: publicAccount(account) };
}

export async function pollTracesConnect(
  state: string,
  expectedLogin?: string | null,
): Promise<TracesConnectPoll> {
  sweepWatchedFlows();
  const parked = watchedFlows.get(state);
  if (parked && parked.status !== "pending") return parked;
  const { status, body } = await tracesFetch<StatusPayload>(
    `/v1/auth/cli/status?state=${encodeURIComponent(state)}`,
  );
  const data = body?.data;
  const phase = (data?.status || "").toLowerCase();
  if (phase === "pending" || phase === "started") return { status: "pending" };
  if (phase === "error" || phase === "expired") {
    return { status: "error", error: data?.error || errorMessage(body, `Traces login ${phase}`) };
  }
  if (phase === "complete" && data?.exchangeCode) {
    return completeAndStore(state, data.exchangeCode, expectedLogin);
  }
  if (!body?.ok) return { status: "error", error: errorMessage(body, `Traces login status failed (${status})`) };
  return { status: "pending" };
}

export function watchTracesConnect(start: TracesConnectStart, expectedLogin?: string | null): void {
  sweepWatchedFlows();
  if (watchedFlows.has(start.state)) return;
  const codeExpiresAt = Date.now() + start.expiresIn * 1000;
  const keepUntil = codeExpiresAt + 10 * 60_000;
  watchedFlows.set(start.state, { status: "pending", expiresAt: keepUntil });
  void (async () => {
    let interval = Math.max(start.pollInterval, 2);
    while (Date.now() < codeExpiresAt) {
      await new Promise((r) => setTimeout(r, interval * 1000));
      let result: TracesConnectPoll;
      try {
        result = await pollTracesConnect(start.state, expectedLogin);
      } catch {
        continue;
      }
      if (result.status === "pending") continue;
      watchedFlows.set(start.state, { ...result, expiresAt: keepUntil });
      return;
    }
    watchedFlows.set(start.state, {
      status: "error",
      error: "Traces login timed out",
      expiresAt: keepUntil,
    });
  })();
}

export function tracesConnectResult(state: string): TracesConnectPoll {
  sweepWatchedFlows();
  return watchedFlows.get(state) || { status: "pending" };
}
