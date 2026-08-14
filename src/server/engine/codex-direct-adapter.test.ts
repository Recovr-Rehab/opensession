/**
 * codex-direct tests. Everything here is hermetic: the account store, the
 * engines config and the isolated CODEX_HOMEs are redirected into a temp dir,
 * and the turn tests drive a FAKE codex binary that speaks the app-server
 * JSON-RPC protocol (the seam codex-usage.test.ts established). No network,
 * no real accounts, no live codex process.
 *
 * Covered: the config and kind gates, model-id normalization, effort mapping,
 * the auth-seeding shape (the rotation-proof placeholder refresh is the
 * security invariant), MCP disabled_tools bucketing, usage folding, and the
 * terminal-event invariants — exactly one terminal, a flagged pool-dry
 * failure, a flagged usage-limit failure, and a quiet user cancel.
 */

import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { __setCodexAccountsPathForTest } from "../codex-accounts";
import { OPENCODE_OPENAI_PLACEHOLDER_REFRESH } from "../opencode-openai-auth";
import { codexConfigArgs, tomlValue } from "./codex-direct-protocol";
import { bearerEnvVarFor, disabledToolsByServer } from "./codex-direct-mcp";
import { seedCodexDirectHome, codexDirectHomeFor } from "./codex-direct-auth";
import {
  CODEX_DIRECT_SMOKE_KIND,
  cancelCodexDirectRun,
  codexDirectEnabled,
  codexDirectGateReason,
  codexReasoningEffort,
  foldCodexUsage,
  isCodexDirectUsageLimit,
  parseCodexDirectModel,
  runCodexDirect,
  runCodexDirectSmokeTurn,
} from "./codex-direct-adapter";
import type { StreamEvent } from "./adapter-types";

let dir: string;
let storePath: string;
let enginesConfigPath: string;
let prevStorePath: string;
let prevEnginesConfig: string | undefined;
let prevCodexBin: string | undefined;

/** A JWT whose only meaningful claim is an expiry — buildSeededOpenaiAuth
 *  parses `exp` and refuses an already-expired token. */
function fakeJwt(expSecondsFromNow: number): string {
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
  return `${b64({ alg: "none" })}.${b64({ exp: Math.floor(Date.now() / 1000) + expSecondsFromNow })}.sig`;
}

function writeAccountHome(name: string, accessExpSeconds = 3_600): string {
  const home = join(dir, "accounts", name);
  mkdirSync(home, { recursive: true });
  writeFileSync(
    join(home, "auth.json"),
    JSON.stringify({
      auth_mode: "chatgpt",
      OPENAI_API_KEY: null,
      tokens: {
        id_token: "id-token-value",
        access_token: fakeJwt(accessExpSeconds),
        refresh_token: "LIVE-REFRESH-TOKEN-MUST-NOT-BE-COPIED",
        account_id: "acct-123",
      },
      last_refresh: new Date(Date.now() - 86_400_000).toISOString(),
    })
  );
  return home;
}

function setAccounts(accounts: unknown[]): void {
  writeFileSync(storePath, JSON.stringify({ accounts }, null, 2));
}

function setEngineEnabled(enabled: boolean): void {
  writeFileSync(enginesConfigPath, JSON.stringify({ codex: { enabled } }));
}

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "codex-direct-test-"));
  storePath = join(dir, "codex-accounts.json");
  enginesConfigPath = join(dir, "engines.json");
  prevStorePath = __setCodexAccountsPathForTest(storePath);
  prevEnginesConfig = process.env.OPENSESSION_ENGINES_CONFIG;
  process.env.OPENSESSION_ENGINES_CONFIG = enginesConfigPath;
  prevCodexBin = process.env.OPENSESSION_CODEX_BIN;
  setAccounts([]);
  setEngineEnabled(false);
});

afterAll(() => {
  __setCodexAccountsPathForTest(prevStorePath);
  if (prevEnginesConfig === undefined) delete process.env.OPENSESSION_ENGINES_CONFIG;
  else process.env.OPENSESSION_ENGINES_CONFIG = prevEnginesConfig;
  if (prevCodexBin === undefined) delete process.env.OPENSESSION_CODEX_BIN;
  else process.env.OPENSESSION_CODEX_BIN = prevCodexBin;
  rmSync(dir, { recursive: true, force: true });
});

// ── Pure pieces ──────────────────────────────────────────────────────────────

describe("parseCodexDirectModel", () => {
  test("normalizes every id shape that should reach codex", () => {
    expect(parseCodexDirectModel("codex/openai/gpt-5.6-sol")).toBe("gpt-5.6-sol");
    expect(parseCodexDirectModel("codex/gpt-5.6-sol")).toBe("gpt-5.6-sol");
    expect(parseCodexDirectModel("opencode/openai/gpt-5.4-mini")).toBe("gpt-5.4-mini");
    expect(parseCodexDirectModel("openai/gpt-5.5")).toBe("gpt-5.5");
    expect(parseCodexDirectModel("gpt-5.6-terra")).toBe("gpt-5.6-terra");
    expect(parseCodexDirectModel("codex-mini")).toBe("codex-mini");
  });

  test("rejects non-OpenAI ids so a misroute fails loudly", () => {
    expect(parseCodexDirectModel("claude-opus-5")).toBeNull();
    expect(parseCodexDirectModel("codex/anthropic/claude-opus-5")).toBeNull();
    expect(parseCodexDirectModel("pi/anthropic/claude-opus-5")).toBeNull();
    expect(parseCodexDirectModel("")).toBeNull();
  });
});

describe("codexReasoningEffort", () => {
  test("maps the session effort scale onto codex's rungs", () => {
    expect(codexReasoningEffort(undefined)).toBeUndefined();
    expect(codexReasoningEffort("none")).toBe("minimal");
    expect(codexReasoningEffort("low")).toBe("low");
    expect(codexReasoningEffort("medium")).toBe("medium");
    expect(codexReasoningEffort("high")).toBe("high");
    expect(codexReasoningEffort("xhigh")).toBe("xhigh");
    // codex has no rung above xhigh.
    expect(codexReasoningEffort("max")).toBe("xhigh");
  });
});

describe("config overrides", () => {
  test("TOML-encodes scalars, arrays and inline tables", () => {
    expect(tomlValue("gpt-5.6-sol")).toBe('"gpt-5.6-sol"');
    expect(tomlValue(true)).toBe("true");
    expect(tomlValue(["a", "b"])).toBe('["a", "b"]');
    expect(tomlValue({ command: "bun", args: ["x"] })).toBe(
      '{ command = "bun", args = ["x"] }'
    );
    // Keys that are not bare TOML identifiers must be quoted; TOML bare keys
    // do allow dashes and underscores, so those stay unquoted.
    expect(tomlValue({ "tool-timeout": 5 })).toBe("{ tool-timeout = 5 }");
    expect(tomlValue({ "tella.support": 5 })).toBe('{ "tella.support" = 5 }');
  });

  test("emits one -c pair per override", () => {
    expect(codexConfigArgs({ model: "gpt-5.5", nope: undefined })).toEqual([
      "-c",
      'model="gpt-5.5"',
    ]);
  });
});

describe("MCP tool stripping", () => {
  test("buckets mcp__<server>__<tool> names per server, underscores included", () => {
    const { byServer, unenforceable } = disabledToolsByServer([
      "mcp__stripe__create_refund",
      "mcp__stripe__create_payout",
      "mcp__opensession_admin__forget",
      "Bash",
    ]);
    expect(byServer.stripe).toEqual(["create_refund", "create_payout"]);
    expect(byServer.opensession_admin).toEqual(["forget"]);
    // Built-ins cannot be expressed as disabled_tools — reported, not dropped.
    expect(unenforceable).toEqual(["Bash"]);
  });

  test("bearer env var names are namespaced and shell-safe", () => {
    expect(bearerEnvVarFor("tella-support")).toBe("CODEX_MCP_BEARER_TELLA_SUPPORT");
  });
});

describe("usage folding", () => {
  test("sums each request's usage and tracks the latest prompt size", () => {
    let usage = foldCodexUsage(
      { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, contextTokens: 0 },
      { inputTokens: 1_000, cachedInputTokens: 400, outputTokens: 50 }
    );
    expect(usage).toMatchObject({
      inputTokens: 600,
      cacheReadTokens: 400,
      outputTokens: 50,
      contextTokens: 1_000,
    });
    usage = foldCodexUsage(usage, { inputTokens: 2_000, cachedInputTokens: 1_800, outputTokens: 20 });
    expect(usage).toMatchObject({
      inputTokens: 800,
      cacheReadTokens: 2_200,
      outputTokens: 70,
      // The live "how full is the window" figure, not a sum.
      contextTokens: 2_000,
    });
  });
});

describe("usage-limit classification", () => {
  test("codex's typed error info decides, and a typed non-limit never falls through", () => {
    expect(isCodexDirectUsageLimit("usageLimitExceeded", "whatever")).toBe(true);
    expect(isCodexDirectUsageLimit("sessionBudgetExceeded", "whatever")).toBe(true);
    // A prose "rate limit" inside a typed non-limit error must not sideline
    // a healthy account.
    expect(isCodexDirectUsageLimit("badRequest", "you hit a rate limit somewhere")).toBe(false);
    // Transport failures have no typed info — the string classifier is the
    // fallback there.
    expect(isCodexDirectUsageLimit(undefined, "429 too many requests")).toBe(true);
    expect(isCodexDirectUsageLimit(undefined, "connection refused")).toBe(false);
  });
});

// ── Gates ────────────────────────────────────────────────────────────────────

describe("kind gate", () => {
  test("denies by default and refuses kind-less runs", () => {
    expect(codexDirectGateReason({ journal: { kind: "prompt" } })).toBeNull();
    expect(codexDirectGateReason({ journal: { kind: "automation" } })).toBeNull();
    expect(codexDirectGateReason({})).toContain("explicit run kind");
    expect(codexDirectGateReason({ journal: { kind: "title" } })).toContain("not available");
  });

  test("naming the smoke kind does not arm the smoke bypass", () => {
    // The bypass counter is module-scoped and only runCodexDirectSmokeTurn
    // increments it — request data can spell the kind but never arm it.
    expect(codexDirectGateReason({ journal: { kind: CODEX_DIRECT_SMOKE_KIND } })).toContain(
      "not available"
    );
  });
});

async function collect(
  model: string,
  extra: Record<string, unknown> = {}
): Promise<StreamEvent[]> {
  const events: StreamEvent[] = [];
  for await (const event of runCodexDirect(
    {
      prompt: "hi",
      cwd: dir,
      mode: "ask",
      mcpServers: [],
      journal: { kind: "prompt" },
      ...extra,
    } as any,
    model
  )) {
    events.push(event);
  }
  return events;
}

describe("config gate", () => {
  afterEach(() => setEngineEnabled(false));

  test("a disabled engine refuses before any account or binary work", async () => {
    setEngineEnabled(false);
    expect(codexDirectEnabled()).toBe(false);
    const events = await collect("codex/openai/gpt-5.6-sol");
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("error");
    expect(String(events[0].content)).toContain("disabled");
  });

  test("an enabled engine still refuses a non-OpenAI model", async () => {
    setEngineEnabled(true);
    const events = await collect("codex/anthropic/claude-opus-5");
    expect(events).toHaveLength(1);
    expect(String(events[0].content)).toContain("only runs OpenAI models");
  });

  test("an enabled engine refuses a kind-less run and audits nothing else", async () => {
    setEngineEnabled(true);
    const events = await collect("gpt-5.6-sol", { journal: {} });
    expect(events).toHaveLength(1);
    expect(String(events[0].content)).toContain("explicit run kind");
  });

  test("a dry account pool fails flagged, before any binary work", async () => {
    setEngineEnabled(true);
    setAccounts([]);
    const events = await collect("gpt-5.6-sol");
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("error");
    expect(String(events[0].content)).toContain("no codex accounts configured");
    // The only thing that drives agent-runner's fallback walk.
    expect(events[0].usageLimitExhausted).toBe(true);
  });
});

// ── Auth seeding ─────────────────────────────────────────────────────────────

describe("auth seeding", () => {
  test("the isolated CODEX_HOME never receives the live refresh token", () => {
    const home = writeAccountHome("seed-ok");
    const account = {
      id: "acct-seed-ok",
      name: "seed-ok",
      kind: "home" as const,
      value: home,
      createdAt: new Date().toISOString(),
    };
    const bound = seedCodexDirectHome(account);
    expect("error" in bound).toBe(false);
    if ("error" in bound) return;
    expect(bound.mechanism).toBe("oauth-subscription-seeded");
    // Isolation: never the account's own directory.
    expect(bound.codexHome).toBe(codexDirectHomeFor(account.id));
    expect(bound.codexHome).not.toBe(home);

    const seeded = JSON.parse(readFileSync(join(bound.codexHome, "auth.json"), "utf-8"));
    expect(seeded.auth_mode).toBe("chatgpt");
    expect(seeded.tokens.refresh_token).toBe(OPENCODE_OPENAI_PLACEHOLDER_REFRESH);
    expect(seeded.tokens.refresh_token).not.toContain("LIVE-REFRESH-TOKEN");
    expect(seeded.tokens.access_token).toBeTruthy();
    expect(seeded.tokens.account_id).toBe("acct-123");
    // id_token is an identity assertion, not a rotating credential.
    expect(seeded.tokens.id_token).toBe("id-token-value");
    // Stamped now so codex has no reason to attempt a refresh.
    expect(Date.now() - Date.parse(seeded.last_refresh)).toBeLessThan(60_000);
  });

  test("an expired access token is refused rather than seeded", () => {
    const home = writeAccountHome("seed-expired", -60);
    const bound = seedCodexDirectHome({
      id: "acct-seed-expired",
      name: "seed-expired",
      kind: "home",
      value: home,
      createdAt: new Date().toISOString(),
    });
    expect("error" in bound).toBe(true);
    if ("error" in bound) expect(bound.error).toContain("expired");
  });

  test("api_key accounts seed a key-only home", () => {
    const bound = seedCodexDirectHome({
      id: "acct-key",
      name: "key",
      kind: "api_key",
      value: "sk-test-123",
      createdAt: new Date().toISOString(),
    });
    expect("error" in bound).toBe(false);
    if ("error" in bound) return;
    expect(bound.mechanism).toBe("api-key");
    expect(bound.extraEnv.OPENAI_API_KEY).toBe("sk-test-123");
    const seeded = JSON.parse(readFileSync(join(bound.codexHome, "auth.json"), "utf-8"));
    expect(seeded.auth_mode).toBe("apikey");
    expect(seeded.OPENAI_API_KEY).toBe("sk-test-123");
    expect(seeded.tokens).toBeNull();
  });
});

// ── Turn invariants, against a fake codex binary ─────────────────────────────

/** A fake `codex app-server`: reads newline-delimited JSON-RPC on stdin and
 *  plays a scripted turn. The script is picked from a MODE FILE, not an env
 *  var — the adapter deliberately hands the child a minimal env, so nothing
 *  the test sets in process.env reaches it (which is itself the invariant
 *  under test). */
function setFakeMode(mode: string): void {
  writeFileSync(join(dir, "fake-mode"), mode);
}

function installFakeCodex(): string {
  const script = join(dir, "fake-codex.mjs");
  writeFileSync(
    script,
    `
import { readFileSync } from "fs";
let mode = "ok";
try { mode = readFileSync(${JSON.stringify(join(dir, "fake-mode"))}, "utf8").trim() || "ok"; } catch {}
const send = (o) => process.stdout.write(JSON.stringify(o) + "\\n");
let buf = "";
process.stdin.on("data", (chunk) => {
  buf += chunk.toString();
  let i;
  while ((i = buf.indexOf("\\n")) >= 0) {
    const line = buf.slice(0, i).trim();
    buf = buf.slice(i + 1);
    if (!line) continue;
    const msg = JSON.parse(line);
    if (msg.method === "initialize") { send({ id: msg.id, result: { userAgent: "fake" } }); continue; }
    if (msg.method === "thread/start") {
      send({ id: msg.id, result: { thread: { id: "thr_fake_1" } } });
      continue;
    }
    if (msg.method === "turn/interrupt") { send({ id: msg.id, result: {} }); continue; }
    if (msg.method === "turn/start") {
      send({ id: msg.id, result: { turn: { id: "turn_1", status: "inProgress", items: [] } } });
      send({ method: "turn/started", params: { threadId: "thr_fake_1", turn: { id: "turn_1", status: "inProgress", items: [] } } });
      if (mode === "hang") continue;
      send({ method: "item/agentMessage/delta", params: { threadId: "thr_fake_1", turnId: "turn_1", itemId: "item_1", delta: "ok" } });
      send({ method: "item/completed", params: { threadId: "thr_fake_1", turnId: "turn_1", item: { id: "item_1", type: "agentMessage", text: "ok" } } });
      send({ method: "thread/tokenUsage/updated", params: { threadId: "thr_fake_1", turnId: "turn_1", tokenUsage: { last: { inputTokens: 100, cachedInputTokens: 40, outputTokens: 7, reasoningOutputTokens: 0, totalTokens: 107 }, total: { inputTokens: 100, cachedInputTokens: 40, outputTokens: 7, reasoningOutputTokens: 0, totalTokens: 107 } } } });
      if (mode === "usagelimit") {
        send({ method: "turn/completed", params: { threadId: "thr_fake_1", turn: { id: "turn_1", status: "failed", items: [], error: { message: "You've hit your usage limit.", codexErrorInfo: "usageLimitExceeded" } } } });
        continue;
      }
      send({ method: "turn/completed", params: { threadId: "thr_fake_1", turn: { id: "turn_1", status: "completed", items: [] } } });
      continue;
    }
    if (msg.id !== undefined) send({ id: msg.id, result: {} });
  }
});
`
  );
  const bin = join(dir, "fake-codex");
  writeFileSync(bin, `#!/bin/sh\nexec "${process.execPath}" "${script}" "$@"\n`);
  chmodSync(bin, 0o700);
  return bin;
}

describe("turn invariants", () => {
  // Two accounts: the usage-limit case sidelines the one it picks, so the
  // cancel case pins its own to stay order-independent.
  const accountId = "acct-turn";
  const cancelAccountId = "acct-turn-cancel";

  beforeAll(() => {
    setAccounts([
      {
        id: accountId,
        name: "turn-account",
        kind: "home",
        value: writeAccountHome("turn-account"),
        createdAt: new Date().toISOString(),
      },
      {
        id: cancelAccountId,
        name: "cancel-account",
        kind: "home",
        value: writeAccountHome("cancel-account"),
        createdAt: new Date().toISOString(),
      },
    ]);
    setFakeMode("ok");
    process.env.OPENSESSION_CODEX_BIN = installFakeCodex();
  });

  afterEach(() => {
    setFakeMode("ok");
    setEngineEnabled(false);
  });

  test("a successful turn emits init, text and EXACTLY one terminal", async () => {
    setEngineEnabled(true);
    const events = await collect("codex/openai/gpt-5.6-sol", {
      accountId,
      accountStrict: true,
    });
    const terminals = events.filter((e) => e.type === "done" || e.type === "error");
    expect(terminals).toHaveLength(1);
    expect(terminals[0].type).toBe("done");

    const init = events.find((e) => e.type === "init");
    expect(init?.sessionId).toBe("thr_fake_1");
    expect(init?.provider).toBe("codex");
    // init must precede the terminal.
    expect(events.indexOf(init!)).toBeLessThan(events.indexOf(terminals[0]));

    expect(events.filter((e) => e.type === "text_chunk").map((e) => e.text).join("")).toBe("ok");
    expect(terminals[0].usage).toMatchObject({
      inputTokens: 60,
      cacheReadTokens: 40,
      outputTokens: 7,
      contextTokens: 100,
    });
  });

  test("a usage-limit turn ends in ONE flagged error", async () => {
    setEngineEnabled(true);
    setFakeMode("usagelimit");
    const events = await collect("codex/openai/gpt-5.6-sol", {
      accountId,
      accountStrict: true,
    });
    const terminals = events.filter((e) => e.type === "done" || e.type === "error");
    expect(terminals).toHaveLength(1);
    expect(terminals[0].type).toBe("error");
    expect(terminals[0].usageLimitExhausted).toBe(true);
    expect(String(terminals[0].content)).toContain("usage limit");
  });

  test("a user cancel ends QUIETLY — no terminal event at all", async () => {
    setEngineEnabled(true);
    setFakeMode("hang");
    const sessionId = `os-test-cancel-${Date.now().toString(36)}`;
    const events: StreamEvent[] = [];
    const iterator = runCodexDirect(
      {
        prompt: "hi",
        cwd: dir,
        mode: "ask",
        mcpServers: [],
        journal: { kind: "prompt" },
        sessionId,
        accountId: cancelAccountId,
        accountStrict: true,
      } as any,
      "codex/openai/gpt-5.6-sol"
    );
    const pump = (async () => {
      for await (const event of iterator) {
        events.push(event);
        if (event.type === "init") {
          // Cancel the moment the run is registered and live.
          setTimeout(() => cancelCodexDirectRun(sessionId), 0);
        }
      }
    })();
    await pump;
    expect(events.some((e) => e.type === "init")).toBe(true);
    expect(events.filter((e) => e.type === "done" || e.type === "error")).toHaveLength(0);
  }, 20_000);
});

// ── Smoke harness ────────────────────────────────────────────────────────────

describe("smoke harness", () => {
  test("a disabled engine reports a pure dry run and never throws", async () => {
    setEngineEnabled(false);
    const result = await runCodexDirectSmokeTurn();
    expect(result.enabled).toBe(false);
    expect(result.dryRun).toBe(true);
    expect(result.ok).toBe(false);
    expect(result.storeRows).toBe(0);
    expect(String(result.error)).toContain("disabled");
    expect(result.sessionId.startsWith("os-test-codex-direct-")).toBe(true);
  });
});
