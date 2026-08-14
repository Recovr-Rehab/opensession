/**
 * claude-direct policy tests — the security-relevant decisions, all pure:
 * model-id normalization, effort mapping, the deny/confirm strip-set, the
 * ask-mode read-only bash allowlist, the built-in tool sets, usage summation
 * and the dial-oracle subagent resolution. Nothing here touches the SDK, an
 * account, or the network; the turn itself is covered by the smoke harness
 * (POST /api/admin/claude-direct-smoke) against a live account.
 */
import { describe, expect, test } from "bun:test";
import { opencodeRunPolicy } from "../opencode-policy";
import { STRIPE_CONFIRM_TOOLS } from "../runner-shared";
import {
  addResultUsage,
  askBashDecision,
  claudeDirectBuiltinTools,
  claudeDirectDisallowedTools,
  claudeDirectEffortConfig,
  claudeDirectInProcessServers,
  claudeDirectOracleAgents,
  claudeDirectOracleLabel,
  claudeDirectToolDecision,
  emptyTurnUsage,
  isStrippedToolName,
  parseMcpToolName,
  resolveClaudeDirectModel,
  splitBashSubCommands,
} from "./claude-direct-policy";

describe("resolveClaudeDirectModel", () => {
  test("accepts the canonical engine-prefixed id", () => {
    expect(resolveClaudeDirectModel("claude/anthropic/claude-opus-5")).toEqual({
      model: "claude-opus-5",
    });
  });

  test("accepts another engine's spelling of the same model", () => {
    expect(resolveClaudeDirectModel("opencode/anthropic/claude-fable-5")).toEqual({
      model: "claude-fable-5",
    });
    expect(resolveClaudeDirectModel("pi/anthropic/claude-sonnet-5")).toEqual({
      model: "claude-sonnet-5",
    });
  });

  test("accepts the bare native slug", () => {
    expect(resolveClaudeDirectModel("claude-haiku-4-5-20251001")).toEqual({
      model: "claude-haiku-4-5-20251001",
    });
  });

  test("refuses a non-anthropic upstream by name rather than running one anyway", () => {
    const out = resolveClaudeDirectModel("claude/openai/gpt-5.6-sol");
    expect(out).toHaveProperty("error");
    expect((out as { error: string }).error).toContain("anthropic");
  });

  test("refuses truncated and foreign ids", () => {
    for (const id of ["claude/", "claude/anthropic", "claude/anthropic/", "gpt-5.6-sol", ""]) {
      expect(resolveClaudeDirectModel(id)).toHaveProperty("error");
    }
    expect(resolveClaudeDirectModel("opencode/openai/gpt-5.6-sol")).toHaveProperty("error");
  });

  test("routes a Dial preset to its main model and keeps the preset attached", () => {
    const out = resolveClaudeDirectModel("claude/dial/opus-fable");
    expect(out).toMatchObject({
      model: "claude-opus-5",
      dial: { id: "dial/opus-fable", oracleAgent: "oracle-fable" },
    });
  });

  test("refuses an unknown Dial preset instead of falling through to a model id", () => {
    const out = resolveClaudeDirectModel("claude/dial/not-real");
    expect(out).toHaveProperty("error");
    expect((out as { error: string }).error).toContain("Dial preset");
  });
});

describe("claudeDirectEffortConfig", () => {
  test("maps our six rungs onto the SDK's four plus the thinking switch", () => {
    expect(claudeDirectEffortConfig("none")).toEqual({ thinking: { type: "disabled" } });
    expect(claudeDirectEffortConfig("low")).toEqual({ effort: "low" });
    expect(claudeDirectEffortConfig("medium")).toEqual({ effort: "medium" });
    expect(claudeDirectEffortConfig("high")).toEqual({ effort: "high" });
    expect(claudeDirectEffortConfig("xhigh")).toEqual({
      effort: "high",
      thinking: { type: "adaptive" },
    });
    expect(claudeDirectEffortConfig("max")).toEqual({
      effort: "max",
      thinking: { type: "adaptive" },
    });
  });

  test("an unset or unknown effort is the model default, never a guess", () => {
    expect(claudeDirectEffortConfig(undefined)).toEqual({});
    expect(claudeDirectEffortConfig("turbo")).toEqual({});
  });
});

describe("the strip-set", () => {
  const policy = opencodeRunPolicy({
    confirmTools: STRIPE_CONFIRM_TOOLS,
    journalKind: "automation",
  });

  test("parseMcpToolName splits SDK MCP names and passes built-ins through", () => {
    expect(parseMcpToolName("mcp__stripe__create_refund")).toEqual({
      server: "stripe",
      tool: "create_refund",
    });
    expect(parseMcpToolName("Bash")).toBeNull();
  });

  test("money-movers are stripped, and their broad form covers a same-named tool elsewhere", () => {
    expect(isStrippedToolName("mcp__stripe__create_refund", policy.disables)).toBe(true);
    // The `broad` expansion deliberately over-blocks: that is the trade the
    // confirm list makes for money-moving names.
    expect(isStrippedToolName("mcp__other__create_refund", policy.disables)).toBe(true);
  });

  test("an unrelated tool on an unrelated server is untouched", () => {
    expect(isStrippedToolName("mcp__slack__post_message", policy.disables)).toBe(false);
    expect(isStrippedToolName("Read", policy.disables)).toBe(false);
  });

  test("a server-scoped deny stays exact — it must not blank the same tool elsewhere", () => {
    const scoped = opencodeRunPolicy({
      deniedTools: { mcp__plain__reply_to_thread: "no" },
      journalKind: "automation",
    });
    expect(isStrippedToolName("mcp__plain__reply_to_thread", scoped.disables)).toBe(true);
    expect(isStrippedToolName("mcp__slack__reply_to_thread", scoped.disables)).toBe(false);
  });

  test("disableLocalWorkspaceTools maps our ids onto the SDK's capitalized names", () => {
    const outside = opencodeRunPolicy({ disableLocalWorkspaceTools: true });
    expect(isStrippedToolName("Bash", outside.disables)).toBe(true);
    expect(isStrippedToolName("Read", outside.disables)).toBe(true);
    expect(isStrippedToolName("MultiEdit", outside.disables)).toBe(true);
    expect(isStrippedToolName("WebFetch", outside.disables)).toBe(false);
  });

  test("disallowedTools carries every exact name so it leaves the model's tool list", () => {
    const names = claudeDirectDisallowedTools({
      deniedTools: { mcp__plain__send_email: "no" },
      confirmTools: STRIPE_CONFIRM_TOOLS,
    });
    expect(names).toContain("mcp__plain__send_email");
    for (const money of Object.keys(STRIPE_CONFIRM_TOOLS)) expect(names).toContain(money);
  });

  test("disallowedTools adds the workspace built-ins when the engine is outside its sandbox", () => {
    const names = claudeDirectDisallowedTools({ disableLocalWorkspaceTools: true });
    for (const n of ["Bash", "Read", "Write", "Edit", "Grep", "Glob"]) {
      expect(names).toContain(n);
    }
  });
});

describe("ask-mode bash allowlist", () => {
  test("allows read-only inspection", () => {
    for (const cmd of [
      "cat src/index.ts",
      "ls -la",
      "rg TODO src",
      "git log --oneline -20",
      "git diff HEAD~1",
      "gh pr view 123 --json title",
      "jq .name package.json",
      "git show HEAD:file | nl -ba",
      "git status && git rev-parse HEAD",
    ]) {
      expect(askBashDecision(cmd).allow).toBe(true);
    }
  });

  test("denies anything that could change state", () => {
    for (const cmd of [
      "rm -rf /tmp/x",
      "git push origin main",
      "sed -i s/a/b/ file",
      "npm install",
      "systemctl restart opensession",
      "python3 -c 'print(1)'",
      "gh pr merge 5",
      "gh api -X POST /repos",
    ]) {
      expect(askBashDecision(cmd).allow).toBe(false);
    }
  });

  test("one bad sub-command denies the whole pipeline", () => {
    expect(askBashDecision("cat f | rm -rf /").allow).toBe(false);
    expect(askBashDecision("git log && curl http://x").allow).toBe(false);
  });

  test("constructs that could hide a command are unclassifiable, therefore denied", () => {
    expect(splitBashSubCommands("cat $(echo f)")).toHaveProperty("unparseable");
    expect(splitBashSubCommands("echo hi > /tmp/f")).toHaveProperty("unparseable");
    expect(askBashDecision("cat `whoami`").allow).toBe(false);
    expect(askBashDecision("echo pwned > ~/.bashrc").allow).toBe(false);
  });
});

describe("claudeDirectToolDecision", () => {
  const disables = opencodeRunPolicy({
    confirmTools: STRIPE_CONFIRM_TOOLS,
    journalKind: "automation",
  }).disables;

  test("an explicit deny message wins, in code mode too", () => {
    const out = claudeDirectToolDecision(
      "mcp__plain__send_email",
      {},
      { mode: "code", denyMessages: { mcp__plain__send_email: "not on this run" }, disables }
    );
    expect(out).toMatchObject({ behavior: "deny", reason: "denied_tool" });
  });

  test("a stripped money-mover is denied even without an explicit message", () => {
    const out = claudeDirectToolDecision("mcp__stripe__create_refund", {}, {
      mode: "code",
      denyMessages: {},
      disables,
    });
    expect(out).toMatchObject({ behavior: "deny", reason: "stripped_tool" });
  });

  test("ask mode denies the writers and allows the readers", () => {
    for (const tool of ["Write", "Edit", "MultiEdit", "NotebookEdit"]) {
      expect(
        claudeDirectToolDecision(tool, {}, { mode: "ask", denyMessages: {}, disables })
      ).toMatchObject({ behavior: "deny", reason: "ask_mode" });
    }
    expect(
      claudeDirectToolDecision("Read", {}, { mode: "ask", denyMessages: {}, disables })
    ).toBeNull();
  });

  test("ask mode screens Bash per command instead of denying it wholesale", () => {
    expect(
      claudeDirectToolDecision(
        "Bash",
        { command: "git diff" },
        { mode: "ask", denyMessages: {}, disables }
      )
    ).toBeNull();
    expect(
      claudeDirectToolDecision(
        "Bash",
        { command: "git push" },
        { mode: "ask", denyMessages: {}, disables }
      )
    ).toMatchObject({ behavior: "deny", reason: "ask_mode_bash" });
  });

  test("code mode leaves Bash to the caller's command-policy screen", () => {
    expect(
      claudeDirectToolDecision(
        "Bash",
        { command: "git push" },
        { mode: "code", denyMessages: {}, disables }
      )
    ).toBeNull();
  });
});

describe("claudeDirectBuiltinTools", () => {
  test("ask mode keeps Bash and drops every writer", () => {
    const tools = claudeDirectBuiltinTools({ mode: "ask" });
    expect(tools).toContain("Bash");
    expect(tools).toContain("Read");
    expect(tools).not.toContain("Write");
    expect(tools).not.toContain("Edit");
  });

  test("code mode gets the writers", () => {
    const tools = claudeDirectBuiltinTools({ mode: "code" });
    expect(tools).toContain("Write");
    expect(tools).toContain("Edit");
  });

  test("outside its sandbox the engine loses every filesystem and shell built-in", () => {
    const tools = claudeDirectBuiltinTools({
      mode: "code",
      disableLocalWorkspaceTools: true,
    });
    for (const n of ["Bash", "Read", "Write", "Edit", "Grep", "Glob"]) {
      expect(tools).not.toContain(n);
    }
    // Delegation and the permission ask still work — they don't touch the fs.
    expect(tools).toContain("Task");
    expect(tools).toContain("AskUserQuestion");
  });
});

describe("in-process MCP servers", () => {
  test("opensession-ask is dropped (the native AskUserQuestion covers it)", () => {
    const out = claudeDirectInProcessServers({
      "opensession-ask": { type: "sdk", name: "opensession-ask", instance: {} },
      "opensession-sessions": { type: "sdk", name: "opensession-sessions", instance: {} },
    });
    expect(Object.keys(out)).toEqual(["opensession-sessions"]);
  });

  test("nothing is synthesized when the caller passed none", () => {
    expect(claudeDirectInProcessServers(undefined)).toEqual({});
    expect(claudeDirectInProcessServers({})).toEqual({});
  });
});

describe("dial oracles", () => {
  const agents = claudeDirectOracleAgents();

  test("every oracle resolves to a model this engine's bridge can serve", () => {
    expect(Object.keys(agents).length).toBeGreaterThan(0);
    for (const [name, def] of Object.entries(agents)) {
      expect(def.model.startsWith("claude-")).toBe(true);
      expect(def.model.includes("/")).toBe(false);
      expect(def.description.length).toBeGreaterThan(0);
      expect(name.startsWith("oracle-")).toBe(true);
    }
  });

  test("a cross-vendor oracle keeps its NAME and swaps its body for the same-bridge one", () => {
    // oracle-sol is an OpenAI model; on this bridge the agent must still exist
    // (prompts reference it) but resolve to the anthropic substitute.
    expect(agents["oracle-sol"]).toBeDefined();
    expect(agents["oracle-sol"].model.startsWith("claude-")).toBe(true);
    expect(claudeDirectOracleLabel("oracle-sol")).toContain("Claude");
  });

  test("oracles are read-only advisors", () => {
    for (const def of Object.values(agents)) {
      expect(def.tools).not.toContain("Write");
      expect(def.tools).not.toContain("Edit");
      expect(def.tools).not.toContain("Bash");
    }
  });
});

describe("usage accounting", () => {
  test("tokens sum across every result message, context is the last prompt's size", () => {
    let usage = emptyTurnUsage();
    usage = addResultUsage(usage, {
      usage: { input_tokens: 100, output_tokens: 10, cache_read_input_tokens: 900 },
      total_cost_usd: 0.01,
    });
    usage = addResultUsage(usage, {
      usage: { input_tokens: 50, output_tokens: 5, cache_creation_input_tokens: 200 },
      total_cost_usd: 0.03,
    });
    expect(usage.inputTokens).toBe(150);
    expect(usage.outputTokens).toBe(15);
    expect(usage.cacheReadTokens).toBe(900);
    expect(usage.cacheCreationTokens).toBe(200);
    // Last result's prompt size only: 50 input + 0 cache read + 200 creation.
    expect(usage.contextTokens).toBe(250);
    // The SDK reports cost cumulatively, so the latest value wins.
    expect(usage.costUsd).toBe(0.03);
  });

  test("a result with no usage block leaves the totals intact", () => {
    const before = addResultUsage(emptyTurnUsage(), {
      usage: { input_tokens: 7, output_tokens: 1 },
    });
    const after = addResultUsage(before, {});
    expect(after.inputTokens).toBe(7);
    expect(after.outputTokens).toBe(1);
  });
});
