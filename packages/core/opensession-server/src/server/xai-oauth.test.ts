import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "fs";
import { homedir, tmpdir } from "os";
import { join } from "path";
import {
  cancelXaiLogin,
  disconnectXai,
  pollXaiLogin,
  startXaiLogin,
  xaiConnected,
  xaiCredentialStore,
  xaiStatus,
  XAI_PROVIDER_ID,
} from "./xai-oauth";

let dir = "";
let storePath = "";

/** Seed a stored credential directly - the tests that read one never need the
 *  device flow that produced it. */
function seed(overrides: Record<string, unknown> = {}): void {
  writeFileSync(
    storePath,
    JSON.stringify({
      type: "oauth",
      access: "stored-access",
      refresh: "stored-refresh",
      expires: Date.now() + 30 * 60_000,
      generation: "gen-1",
      connectedAt: Date.now(),
      connectedBy: "octocat",
      ...overrides,
    }),
  );
}

/** A ModelRuntime stand-in. It persists through the credential store inside
 *  login(), exactly as pi's Models.login does (`credentials.modify(id, () =>
 *  credential)` before login() resolves) - a fake that skipped that step is why
 *  a cancelled reconnect could replace a live credential while the suite stayed
 *  green. */
function fakeRuntime(outcome: {
  resolve?: Record<string, unknown>;
  reject?: string;
  announce?: boolean;
  /** Set false to model a provider that ignores cancellation. */
  honourSignal?: boolean;
}) {
  return async (signal: AbortSignal, connectedBy?: string) => {
    const store = xaiCredentialStore({ signal, connectedBy });
    return {
      login: async (
        _providerId: string,
        _type: "oauth",
        interaction: {
          signal: AbortSignal;
          prompt: (p: unknown) => Promise<string>;
          notify: (event: Record<string, unknown>) => void;
        },
      ) => {
        if (outcome.announce !== false) {
          interaction.notify({
            type: "device_code",
            userCode: "ABCD-EFGH",
            verificationUri: "https://x.ai/device?code=ABCD-EFGH",
            expiresInSeconds: 600,
          });
        }
        await new Promise((wake) => setTimeout(wake, 1));
        if (outcome.reject) throw new Error(outcome.reject);
        if (outcome.honourSignal !== false && interaction.signal.aborted) {
          throw new Error("Login cancelled");
        }
        await store.modify(
          XAI_PROVIDER_ID,
          async () => outcome.resolve as never,
        );
        return outcome.resolve;
      },
    };
  };
}

/** Give a background login time to run its completion handler. Used where the
 *  expected outcome is that it writes NOTHING, so there is no state to poll. */
async function settleFlows(): Promise<void> {
  await new Promise((wake) => setTimeout(wake, 25));
}

/** startXaiLogin returns as soon as the code is announced; the credential is
 *  written by the background login. */
async function settle(): Promise<void> {
  for (let i = 0; i < 50; i++) {
    await new Promise((wake) => setTimeout(wake, 2));
    if (xaiConnected()) return;
  }
}

/** The path a leaked write would land on: what stateDir() resolves to with no
 *  OPENSESSION_STATE_DIR. A background login outliving its test wrote a real
 *  credential here once; never again silently. */
const realStore = join(homedir(), ".opensession", "xai-oauth.json");
let realStoreExisted = false;

beforeEach(() => {
  realStoreExisted = existsSync(realStore);
  dir = mkdtempSync(join(tmpdir(), "opensession-xai-"));
  // OPENSESSION_STATE_DIR keeps the legacy flat spelling; stateDir() resolves
  // "xai-oauth.json" to ".opensession-xai-oauth.json" under it.
  storePath = join(dir, ".opensession-xai-oauth.json");
  // Never let a test touch the real workspace credential.
  process.env.OPENSESSION_STATE_DIR = dir;
  (globalThis as Record<string, unknown>).__opensessionXaiFlows = new Map();
});

afterEach(async () => {
  // Let any background login finish while the sandboxed state dir is STILL in
  // force. Tearing the env down first sends its write to the real store.
  await new Promise((wake) => setTimeout(wake, 25));
  delete process.env.OPENSESSION_STATE_DIR;
  rmSync(dir, { recursive: true, force: true });
  expect(existsSync(realStore)).toBe(realStoreExisted);
});

describe("shared Grok credential", () => {
  test("reports nothing connected until one is stored", () => {
    expect(xaiStatus()).toEqual({ connected: false });
    expect(xaiConnected()).toBe(false);
    seed();
    expect(xaiStatus().connected).toBe(true);
    expect(xaiStatus().connectedBy).toBe("octocat");
  });

  test("ignores a truncated or hand-edited store instead of half-using it", () => {
    writeFileSync(storePath, '{"access":"only-half"}');
    expect(xaiConnected()).toBe(false);
  });

  test("disconnect removes the credential and answers whether it did", async () => {
    seed();
    expect(await disconnectXai()).toBe(true);
    expect(xaiConnected()).toBe(false);
    expect(await disconnectXai()).toBe(false);
  });
});

describe("credential store handed to a turn", () => {
  test("reads the shared credential in pi's own shape", async () => {
    seed();
    const store = xaiCredentialStore();
    expect(await store.read(XAI_PROVIDER_ID)).toEqual({
      type: "oauth",
      access: "stored-access",
      refresh: "stored-refresh",
      expires: expect.any(Number),
    });
    expect(await store.read("anthropic")).toBeUndefined();
  });

  test("persists a refresh so the next turn does not replay a rotated token", async () => {
    seed();
    const store = xaiCredentialStore();
    await store.modify(XAI_PROVIDER_ID, async (current) => {
      expect((current as { access: string }).access).toBe("stored-access");
      return {
        type: "oauth",
        access: "rotated-access",
        refresh: "rotated-refresh",
        expires: Date.now() + 60 * 60_000,
      };
    });
    const onDisk = JSON.parse(readFileSync(storePath, "utf-8"));
    expect(onDisk.access).toBe("rotated-access");
    expect(onDisk.refresh).toBe("rotated-refresh");
    // Provenance survives a refresh; it describes the connection, not the token.
    expect(onDisk.connectedBy).toBe("octocat");
    expect(onDisk.generation).toBe("gen-1");
  });

  test("a refresh that lands after a disconnect does not resurrect it", async () => {
    seed();
    const store = xaiCredentialStore();
    await store.modify(XAI_PROVIDER_ID, async () => {
      // The admin disconnects while xAI is answering the refresh.
      await disconnectXai();
      return {
        type: "oauth",
        access: "late-access",
        refresh: "late-refresh",
        expires: Date.now() + 60 * 60_000,
      };
    });
    expect(xaiConnected()).toBe(false);
  });

  test("a refresh that lands after a reconnect does not clobber the new credential", async () => {
    seed();
    const store = xaiCredentialStore();
    await store.modify(XAI_PROVIDER_ID, async () => {
      seed({ generation: "gen-2", access: "reconnected-access" });
      return {
        type: "oauth",
        access: "late-access",
        refresh: "late-refresh",
        expires: Date.now() + 60 * 60_000,
      };
    });
    expect(JSON.parse(readFileSync(storePath, "utf-8")).access).toBe(
      "reconnected-access",
    );
  });

  test("keeps every other provider in memory", async () => {
    const store = xaiCredentialStore();
    await store.modify("anthropic", async () => ({
      type: "api_key",
      key: "sk-test",
    }));
    expect(await store.read("anthropic")).toEqual({
      type: "api_key",
      key: "sk-test",
    });
    // Nothing about another provider may reach the shared Grok file.
    expect(xaiConnected()).toBe(false);
  });
});

describe("device login through pi", () => {
  test("announces the code, then stores what pi returns", async () => {
    const started = await startXaiLogin(
      "octocat",
      fakeRuntime({
        resolve: {
          type: "oauth",
          access: "fresh-access",
          refresh: "fresh-refresh",
          expires: Date.now() + 55 * 60_000,
        },
      }),
    );
    expect("error" in started).toBe(false);
    if ("error" in started) return;
    expect(started.userCode).toBe("ABCD-EFGH");
    expect(started.verificationUri).toContain("x.ai");
    expect(pollXaiLogin(started.flowId)).toEqual({ status: "pending" });

    await settle();
    const polled = pollXaiLogin(started.flowId);
    expect(polled.status).toBe("connected");
    // Written by pi's persist through the store - the single write path - and
    // stamped with the connector this flow was started for.
    expect(xaiStatus().connectedBy).toBe("octocat");
    expect(
      JSON.parse(readFileSync(storePath, "utf-8")).generation,
    ).toBeTruthy();
    expect(JSON.parse(readFileSync(storePath, "utf-8")).access).toBe(
      "fresh-access",
    );
  });

  test("writes the credential file private from creation", async () => {
    const started = await startXaiLogin(
      "octocat",
      fakeRuntime({
        resolve: {
          type: "oauth",
          access: "fresh-access",
          refresh: "fresh-refresh",
          expires: Date.now() + 55 * 60_000,
        },
      }),
    );
    if ("error" in started) throw new Error(started.error);
    await settle();
    expect(statSync(storePath).mode & 0o777).toBe(0o600);
  });

  test("surfaces a denied or expired login instead of leaving it pending", async () => {
    const started = await startXaiLogin(
      "octocat",
      fakeRuntime({ reject: "xAI device authorization was denied" }),
    );
    if ("error" in started) throw new Error(started.error);
    for (let i = 0; i < 50; i++) {
      await new Promise((wake) => setTimeout(wake, 2));
      if (pollXaiLogin(started.flowId).status !== "pending") break;
    }
    expect(xaiConnected()).toBe(false);
  });

  test("reports a flow that never produced a code as an error, not a hang", async () => {
    const started = await startXaiLogin(
      "octocat",
      fakeRuntime({ announce: false, reject: "device authorization failed" }),
    );
    expect("error" in started).toBe(true);
  });

  test("cancelling stops the flow, forgets it, and writes nothing", async () => {
    const started = await startXaiLogin(
      "octocat",
      fakeRuntime({
        resolve: {
          type: "oauth",
          access: "never-used",
          refresh: "never-used",
          expires: Date.now() + 55 * 60_000,
        },
      }),
    );
    if ("error" in started) throw new Error(started.error);
    expect(cancelXaiLogin(started.flowId)).toBe(true);
    expect(cancelXaiLogin(started.flowId)).toBe(false);
    await settleFlows();
    // The bookkeeping above passed while the credential was being written
    // anyway. Assert the thing that actually matters.
    expect(xaiConnected()).toBe(false);
  });

  test("cancelling a RECONNECT leaves the live credential untouched", async () => {
    // The dangerous case: something IS stored, so pi's persist finds a
    // credential to overwrite rather than a first connect to create.
    seed();
    const started = await startXaiLogin(
      "octocat",
      fakeRuntime({
        honourSignal: false,
        resolve: {
          type: "oauth",
          access: "cancelled-reconnect",
          refresh: "cancelled-reconnect",
          expires: Date.now() + 55 * 60_000,
        },
      }),
    );
    if ("error" in started) throw new Error(started.error);
    expect(cancelXaiLogin(started.flowId)).toBe(true);
    await settleFlows();
    expect(JSON.parse(readFileSync(storePath, "utf-8")).access).toBe(
      "stored-access",
    );
  });

  test("two concurrent refreshes do not interleave into a torn credential", async () => {
    seed();
    // Both stores read the same generation, which is exactly the case the
    // generation stamp cannot resolve on its own - only serialization can.
    const a = xaiCredentialStore();
    const b = xaiCredentialStore();
    const rotate = (
      store: ReturnType<typeof xaiCredentialStore>,
      tag: string,
    ) =>
      store.modify(XAI_PROVIDER_ID, async (current) => {
        await new Promise((wake) => setTimeout(wake, 5));
        return {
          type: "oauth",
          access: `${tag}-from-${(current as { access: string }).access}`,
          refresh: `${tag}-refresh`,
          expires: Date.now() + 60 * 60_000,
        } as never;
      });
    await Promise.all([rotate(a, "first"), rotate(b, "second")]);
    const onDisk = JSON.parse(readFileSync(storePath, "utf-8"));
    // Whoever ran second must have SEEN the first one's write, not the
    // credential both started from.
    expect(onDisk.access).not.toBe("first-from-stored-access");
    expect(
      onDisk.access === "second-from-first-from-stored-access" ||
        onDisk.access === "first-from-second-from-stored-access",
    ).toBe(true);
  });

  test("disconnecting abandons a login still in flight", async () => {
    const started = await startXaiLogin(
      "octocat",
      fakeRuntime({
        resolve: {
          type: "oauth",
          access: "raced",
          refresh: "raced",
          expires: Date.now() + 55 * 60_000,
        },
      }),
    );
    if ("error" in started) throw new Error(started.error);
    seed();
    await disconnectXai();
    await settleFlows();
    // The point is the WRITE, not the poll result: polling reports "not
    // pending" either way, so asserting only that let a completed sign-in
    // reconnect a workspace an admin had just disconnected.
    expect(xaiConnected()).toBe(false);
    expect(pollXaiLogin(started.flowId).status).not.toBe("pending");
  });

  test("a provider that ignores cancellation still cannot reconnect us", async () => {
    const started = await startXaiLogin(
      "octocat",
      fakeRuntime({
        honourSignal: false,
        resolve: {
          type: "oauth",
          access: "raced",
          refresh: "raced",
          expires: Date.now() + 55 * 60_000,
        },
      }),
    );
    if ("error" in started) throw new Error(started.error);
    await disconnectXai();
    await settleFlows();
    expect(xaiConnected()).toBe(false);
  });
});
