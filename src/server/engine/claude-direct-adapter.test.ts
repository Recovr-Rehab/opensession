/**
 * claude-direct adapter tests — the refusal paths and the control surface,
 * i.e. everything that must hold WITHOUT a live SDK turn.
 *
 * Every case here stops before an account is picked or a subprocess is
 * spawned: the config gate, the deny-by-default kind gate (including the
 * smoke-kind spoof), model-id refusal, the exactly-one-terminal contract, the
 * registry, and the adapter object's restart-survival answers. The turn itself
 * is covered by the smoke harness (POST /api/admin/claude-direct-smoke)
 * against a live account.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  cancelClaudeDirectRun,
  claudeDirectAdapter,
  claudeDirectEnabled,
  claudeDirectGateReason,
  isClaudeDirectBusy,
  runClaudeDirect,
  runClaudeDirectSmokeTurn,
  steerClaudeDirectRun,
  activeClaudeDirectRunCount,
} from "./claude-direct-adapter";
import type { RunAgentOpts, StreamEvent } from "./adapter-types";

const TERMINALS = new Set(["done", "error"]);

let dir: string;
let prevConfig: string | undefined;
let prevLegacyFlag: string | undefined;

/** Point the engines config at a throwaway file so a test can never read (or
 *  depend on) the instance's real ~/.opensession-engines.json, and clear the
 *  legacy env alias so "enabled" means exactly what this file says. */
function useEnginesConfig(contents: string | null): void {
  const path = join(dir, "engines.json");
  if (contents === null) {
    process.env.OPENSESSION_ENGINES_CONFIG = join(dir, "missing.json");
    return;
  }
  writeFileSync(path, contents);
  process.env.OPENSESSION_ENGINES_CONFIG = path;
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "claude-direct-test-"));
  prevConfig = process.env.OPENSESSION_ENGINES_CONFIG;
  prevLegacyFlag = process.env.OPENSESSION_ENGINE_CLAUDE_DIRECT;
  delete process.env.OPENSESSION_ENGINE_CLAUDE_DIRECT;
});

afterEach(() => {
  if (prevConfig === undefined) delete process.env.OPENSESSION_ENGINES_CONFIG;
  else process.env.OPENSESSION_ENGINES_CONFIG = prevConfig;
  if (prevLegacyFlag === undefined) delete process.env.OPENSESSION_ENGINE_CLAUDE_DIRECT;
  else process.env.OPENSESSION_ENGINE_CLAUDE_DIRECT = prevLegacyFlag;
  rmSync(dir, { recursive: true, force: true });
});

/** Drain a turn to completion. Safe only for the refusal paths below — they
 *  all end before the SDK is reached. */
async function collect(
  opts: Partial<RunAgentOpts>,
  model: string
): Promise<StreamEvent[]> {
  const events: StreamEvent[] = [];
  for await (const ev of runClaudeDirect(
    { prompt: "hi", cwd: dir, mode: "ask", mcpServers: [], ...opts } as RunAgentOpts,
    model
  )) {
    events.push(ev);
  }
  return events;
}

describe("config gate", () => {
  test("a missing config file means the engine is off", async () => {
    useEnginesConfig(null);
    expect(claudeDirectEnabled()).toBe(false);
    const events = await collect(
      { journal: { osSessionId: "os-test-gate", kind: "prompt" } },
      "claude/anthropic/claude-sonnet-5"
    );
    expect(events.map((e) => e.type)).toEqual(["error"]);
    expect(events[0].content).toContain("not enabled");
    expect(events[0].provider).toBe("claude");
  });

  test("enabled:false refuses too", async () => {
    useEnginesConfig(JSON.stringify({ claude: { enabled: false } }));
    expect(claudeDirectEnabled()).toBe(false);
    const events = await collect({ journal: { kind: "prompt" } }, "claude/anthropic/claude-sonnet-5");
    expect(events.map((e) => e.type)).toEqual(["error"]);
  });

  test("the legacy env alias still turns it on", () => {
    useEnginesConfig(null);
    process.env.OPENSESSION_ENGINE_CLAUDE_DIRECT = "1";
    expect(claudeDirectEnabled()).toBe(true);
  });
});

describe("claudeDirectGateReason", () => {
  test("interactive and unattended kinds pass", () => {
    for (const kind of ["prompt", "goal", "create", "linear", "slack", "workflow"]) {
      expect(claudeDirectGateReason({ journal: { kind } })).toBeNull();
    }
    for (const kind of ["automation", "plain", "action", "security-scan", "github-review"]) {
      expect(claudeDirectGateReason({ journal: { kind } })).toBeNull();
    }
  });

  test("resume/rerun/fallback suffixes resolve to the base kind", () => {
    expect(claudeDirectGateReason({ journal: { kind: "prompt-resume" } })).toBeNull();
    expect(claudeDirectGateReason({ journal: { kind: "automation-resume-fallback" } })).toBeNull();
  });

  test("kind-less runs are refused (deny by default)", () => {
    expect(claudeDirectGateReason({})).toMatch(/explicit run kind/);
    expect(claudeDirectGateReason({ journal: {} })).toMatch(/explicit run kind/);
  });

  test("unknown kinds are refused by name", () => {
    expect(claudeDirectGateReason({ journal: { kind: "mystery" } })).toContain('"mystery"');
  });

  test("the smoke kind is refused unless the harness armed its bypass", () => {
    // Request/automation data can NAME the kind; only runClaudeDirectSmokeTurn
    // can arm the module-scoped counter, so from out here it stays refused.
    expect(claudeDirectGateReason({ journal: { kind: "claude-direct-smoke" } })).toContain(
      '"claude-direct-smoke"'
    );
  });
});

describe("the kind gate on a live turn", () => {
  beforeEach(() => {
    useEnginesConfig(JSON.stringify({ claude: { enabled: true } }));
  });

  test("a kind-less run is refused before any account or SDK work", async () => {
    const events = await collect({}, "claude/anthropic/claude-sonnet-5");
    expect(events.map((e) => e.type)).toEqual(["error"]);
    expect(events[0].content).toMatch(/explicit run kind/);
  });

  test("an unknown kind is refused by name", async () => {
    const events = await collect(
      { journal: { osSessionId: "os-test-kind", kind: "mystery" } },
      "claude/anthropic/claude-sonnet-5"
    );
    expect(events.map((e) => e.type)).toEqual(["error"]);
    expect(events[0].content).toContain('"mystery"');
  });

  test("naming the smoke kind from outside the harness does not open the gate", async () => {
    const events = await collect(
      { journal: { osSessionId: "os-test-spoof", kind: "claude-direct-smoke" } },
      "claude/anthropic/claude-sonnet-5"
    );
    expect(events.map((e) => e.type)).toEqual(["error"]);
    expect(events[0].content).toContain("claude-direct-smoke");
  });
});

describe("model-id refusal", () => {
  beforeEach(() => {
    useEnginesConfig(JSON.stringify({ claude: { enabled: true } }));
  });

  test("a non-anthropic model is refused after the gate, before any account pick", async () => {
    const events = await collect(
      { journal: { osSessionId: "os-test-model", kind: "prompt" } },
      "claude/openai/gpt-5.6-sol"
    );
    expect(events.map((e) => e.type)).toEqual(["error"]);
    expect(events[0].content).toContain("anthropic");
    expect(events[0].model).toBe("claude/openai/gpt-5.6-sol");
  });

  test("a truncated engine id is refused", async () => {
    const events = await collect(
      { journal: { osSessionId: "os-test-model2", kind: "prompt" } },
      "claude/anthropic"
    );
    expect(events.map((e) => e.type)).toEqual(["error"]);
  });

  test("an orchestrator preset led by another vendor is refused by name", async () => {
    // The preset resolves (it exists), so the refusal has to name the lead
    // model rather than reading as "unknown preset".
    const events = await collect(
      { journal: { osSessionId: "os-test-orch", kind: "prompt" } },
      "claude/orchestrator/sol"
    );
    expect(events.map((e) => e.type)).toEqual(["error"]);
    expect(events[0].content).toContain("Orchestrator preset");
    expect(events[0].content).toContain("Anthropic models only");
  });

  test("a workspace preset id that names no live preset is refused as one", async () => {
    const events = await collect(
      { journal: { osSessionId: "os-test-wsp", kind: "prompt" } },
      "claude/workspace-preset/ws-not-a-workspace/nope"
    );
    expect(events.map((e) => e.type)).toEqual(["error"]);
    expect(events[0].content).toContain("workspace preset");
  });
});

describe("the terminal contract", () => {
  test("every refusal path yields exactly one terminal event and no init", async () => {
    const cases: Array<[string | null, Partial<RunAgentOpts>, string]> = [
      [null, { journal: { kind: "prompt" } }, "claude/anthropic/claude-sonnet-5"],
      [
        JSON.stringify({ claude: { enabled: true } }),
        {},
        "claude/anthropic/claude-sonnet-5",
      ],
      [
        JSON.stringify({ claude: { enabled: true } }),
        { journal: { kind: "prompt" } },
        "claude/openai/gpt-5.6-sol",
      ],
    ];
    for (const [config, opts, model] of cases) {
      useEnginesConfig(config);
      const events = await collect(opts, model);
      expect(events.filter((e) => TERMINALS.has(e.type)).length).toBe(1);
      expect(events.some((e) => e.type === "init")).toBe(false);
      expect(events[events.length - 1].type).toBe("error");
    }
  });
});

describe("the control surface", () => {
  test("unknown ids are not busy, not steerable, not cancellable", () => {
    const id = `os-test-nothing-${Date.now()}`;
    expect(isClaudeDirectBusy(id)).toBe(false);
    expect(cancelClaudeDirectRun(id)).toBe(false);
    expect(steerClaudeDirectRun(id, "hello")).toBe(false);
  });

  test("a refused turn leaves no registry entry behind", async () => {
    useEnginesConfig(JSON.stringify({ claude: { enabled: true } }));
    const before = activeClaudeDirectRunCount();
    await collect(
      { journal: { osSessionId: "os-test-registry", kind: "prompt" } },
      "claude/openai/gpt-5.6-sol"
    );
    expect(activeClaudeDirectRunCount()).toBe(before);
    expect(isClaudeDirectBusy("os-test-registry")).toBe(false);
  });
});

describe("claudeDirectAdapter", () => {
  test("implements the contract and answers the restart questions honestly", async () => {
    expect(claudeDirectAdapter.name).toBe("claude-direct");
    expect(typeof claudeDirectAdapter.startTurn).toBe("function");
    expect(claudeDirectAdapter.steer).toBe(steerClaudeDirectRun);
    expect(claudeDirectAdapter.cancel).toBe(cancelClaudeDirectRun);
    expect(claudeDirectAdapter.isBusy).toBe(isClaudeDirectBusy);
    // In-process runs are direct children: nothing survives a restart, so
    // reattach is null and the drain never waits on a detached run.
    expect(
      await claudeDirectAdapter.reattach({ runKey: "k", cwd: dir, startedAt: "" } as any)
    ).toBeNull();
    expect(claudeDirectAdapter.activeDetachedRunCount()).toBe(0);
  });
});

describe("runClaudeDirectSmokeTurn with the engine disabled", () => {
  test("pure dry run: config-gate error only, no account, SDK, or store rows", async () => {
    useEnginesConfig(null);
    const res = await runClaudeDirectSmokeTurn({ timeoutMs: 5_000 });
    expect(res.ok).toBe(false);
    expect(res.enabled).toBe(false);
    expect(res.dryRun).toBe(true);
    expect(res.eventTypes).toEqual(["error"]);
    expect(res.error || "").toContain("not enabled");
    expect(res.reason || "").toContain("disabled");
    expect(res.storeRows).toBe(0);
    expect(res.timedOut).toBe(false);
  });

  test("an unrunnable model override is an explicit error, never a silent default", async () => {
    useEnginesConfig(null);
    const res = await runClaudeDirectSmokeTurn({ model: "opencode/openai/gpt-5.6-sol" });
    expect(res.ok).toBe(false);
    expect(res.reason || "").toContain("gpt-5.6-sol");
    expect(res.eventTypes).toEqual([]);
  });
});
