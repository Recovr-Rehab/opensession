import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "fs";
import { tmpdir } from "os";
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

/** A ModelRuntime stand-in: announces a device code, then settles how the
 *  test says. Keeps pi's real network flow out of the suite. */
function fakeRuntime(outcome: {
  resolve?: Record<string, unknown>;
  reject?: string;
  announce?: boolean;
}) {
  return async () => ({
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
      return outcome.resolve;
    },
  });
}

/** startXaiLogin returns as soon as the code is announced; the credential is
 *  written by the background login. */
async function settle(): Promise<void> {
  for (let i = 0; i < 50; i++) {
    await new Promise((wake) => setTimeout(wake, 2));
    if (xaiConnected()) return;
  }
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "opensession-xai-"));
  // OPENSESSION_STATE_DIR keeps the legacy flat spelling; stateDir() resolves
  // "xai-oauth.json" to ".opensession-xai-oauth.json" under it.
  storePath = join(dir, ".opensession-xai-oauth.json");
  // Never let a test touch the real workspace credential.
  process.env.OPENSESSION_STATE_DIR = dir;
  (globalThis as Record<string, unknown>).__opensessionXaiFlows = new Map();
});

afterEach(() => {
  delete process.env.OPENSESSION_STATE_DIR;
  rmSync(dir, { recursive: true, force: true });
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

  test("disconnect removes the credential and answers whether it did", () => {
    seed();
    expect(disconnectXai()).toBe(true);
    expect(xaiConnected()).toBe(false);
    expect(disconnectXai()).toBe(false);
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
      disconnectXai();
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
    expect(xaiStatus().connectedBy).toBe("octocat");
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

  test("cancelling stops the flow and forgets it", async () => {
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
    disconnectXai();
    expect(pollXaiLogin(started.flowId).status).not.toBe("pending");
  });
});
