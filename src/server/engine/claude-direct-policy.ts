/**
 * claude-direct policy layer — the pure, testable half of the engine.
 *
 * Everything here is a function of its arguments (no SDK, no accounts, no
 * filesystem beyond the shared MCP config readers), so the security-relevant
 * decisions can be unit-tested without a live turn: model-id normalization,
 * effort mapping, the deny/confirm strip-set, the ask-mode read-only bash
 * allowlist, MCP config translation, and the dial-oracle subagent set.
 *
 * The runner (claude-direct-adapter.ts) owns everything stateful: accounts,
 * the journal, the transcript, the SDK query and its event pump.
 *
 * One deliberate port rather than an import:
 *  - The strip-set is derived from `opencodeRunPolicy` (imported), but the
 *    ids are re-projected into the SDK's `mcp__<server>__<tool>` naming —
 *    opencode's `<server>_<tool>` convention means nothing to this engine.
 */

import type { McpServerConfig } from "@anthropic-ai/claude-agent-sdk";
import { buildOpencodeMcpConfig } from "../opencode-policy";
import { ASK_BASH_PERMISSIONS, type McpScope } from "../runner-shared";
import {
  DIAL_ORACLE_AGENTS,
  ORCHESTRATOR_WORKER_AGENTS,
  dialPreset,
  orchestratorPreset,
  orchestratorWorkerForBridge,
  sameBridgeDialOracle,
} from "../models";
import type { DialPreset, OrchestratorPreset, SessionEffort } from "../models";
import { resolveWorkspaceModelPreset } from "../workspace-model-presets";
import type { ResolvedWorkspaceModelPreset } from "../workspace-model-presets";
import type { TurnUsage } from "./adapter-types";

/** Engine-prefixed model ids this engine answers to. */
export const CLAUDE_DIRECT_MODEL_PREFIX = "claude/";

/** The only upstream provider claude-direct can serve — the SDK talks to
 *  Anthropic and nothing else. A `claude/openai/...` id is a configuration
 *  mistake, and saying so beats silently running an Anthropic model. */
const SUPPORTED_UPSTREAM = "anthropic";

// ── Model ids ────────────────────────────────────────────────────────────────

export interface ResolvedClaudeDirectModel {
  /** The bare SDK model slug, e.g. "claude-opus-5". */
  model: string;
  /** The Dial preset this id resolved through, when it was a preset id. */
  dial?: DialPreset;
  /** The Orchestrator preset this id resolved through. */
  orchestrator?: OrchestratorPreset;
  /** The workspace ("Custom") preset this id resolved through. */
  workspacePreset?: ResolvedWorkspaceModelPreset;
  /** Reasoning effort the preset pins for its main model — overrides the
   *  session's own effort, exactly as the opencode runner's preset hook does. */
  effort?: SessionEffort;
}

/** The preset families a model id can name, in resolution order. Each head
 *  carries no upstream provider segment, so it must be recognized before the
 *  `<provider>/<model>` parse below. */
const PRESET_HEADS: Array<{ head: string; label: string }> = [
  { head: "dial/", label: "Dial" },
  { head: "orchestrator/", label: "Orchestrator" },
  { head: "workspace-preset/", label: "workspace" },
];

/** How a preset id wires this run: its main model plus whichever preset
 *  objects the adapter needs to build instructions from. */
export interface ClaudeDirectPresetWiring {
  /** The id of the preset's MAIN model (a picker id, resolved recursively). */
  model: string;
  /** Name for error copy — the preset id, or a workspace preset's label. */
  label: string;
  dial?: DialPreset;
  orchestrator?: OrchestratorPreset;
  workspacePreset?: ResolvedWorkspaceModelPreset;
  effort?: SessionEffort;
}

/**
 * What a workspace ("Custom") preset contributes to a run: its lead model, its
 * pinned effort, and — when the combo is an exact restatement of a built-in
 * preset — that preset's own oracle/worker wiring through `enginePresetId`.
 * Following the indirection is what keeps a custom combo from degrading to a
 * plain model run; it mirrors the opencode runner's
 * `dialPreset(opts.model) ?? dialPreset(workspacePreset?.enginePresetId)`.
 *
 * Split out from the id lookup because the lookup reads the workspace store
 * (the one impure step in this module) while this half is pure.
 */
export function claudeDirectWorkspacePresetWiring(
  ws: ResolvedWorkspaceModelPreset
): ClaudeDirectPresetWiring {
  const engineDial = dialPreset(ws.enginePresetId);
  const engineOrch = orchestratorPreset(ws.enginePresetId);
  const effort =
    (ws.effort as SessionEffort | undefined) ?? engineDial?.effort ?? engineOrch?.effort;
  return {
    model: ws.model,
    label: ws.label || ws.id,
    workspacePreset: ws,
    ...(engineDial ? { dial: engineDial } : {}),
    ...(engineOrch ? { orchestrator: engineOrch } : {}),
    ...(effort ? { effort } : {}),
  };
}

/**
 * Resolve a preset id (engine prefix already stripped) to its wiring, or
 * undefined when the head names no live preset. Dial and Orchestrator presets
 * come from the built-in tables; a workspace preset is read from the workspace
 * store it belongs to.
 */
function presetWiring(id: string): ClaudeDirectPresetWiring | undefined {
  const dial = dialPreset(id);
  if (dial) return { model: dial.model, label: dial.id, dial, effort: dial.effort };
  const orch = orchestratorPreset(id);
  if (orch) {
    return { model: orch.model, label: orch.id, orchestrator: orch, effort: orch.effort };
  }
  if (!id.toLowerCase().startsWith("workspace-preset/")) return undefined;
  const ws = resolveWorkspaceModelPreset(id);
  return ws ? claudeDirectWorkspacePresetWiring(ws) : undefined;
}

/**
 * Normalize any id this engine accepts to its SDK model slug:
 *
 *  - `claude/anthropic/<model>` — the canonical engine-prefixed form
 *  - `claude/dial/<preset>`, `claude/orchestrator/<preset>`,
 *    `claude/workspace-preset/<workspace>/<preset>` — a preset routed to this
 *    engine (bare, unprefixed preset ids resolve identically, so the engine
 *    accepts exactly what `directEngineServes` advertises)
 *  - `opencode/anthropic/<model>` / `pi/anthropic/<model>` — another engine's
 *    id for the same model (a session migrating engines keeps its stored id
 *    until the next save, so accepting these avoids a dead first turn)
 *  - `claude-<...>`             — the bare native id
 *
 * Returns `{ error }` for anything else, including a `claude/<other>/…`
 * upstream this engine cannot serve.
 */
export function resolveClaudeDirectModel(
  model: string
): ResolvedClaudeDirectModel | { error: string } {
  const raw = (model || "").trim();
  if (!raw) return { error: "no model id" };
  const prefixed = raw.toLowerCase().startsWith(CLAUDE_DIRECT_MODEL_PREFIX);
  const rest = prefixed ? raw.slice(CLAUDE_DIRECT_MODEL_PREFIX.length) : raw;

  const head = PRESET_HEADS.find((h) => rest.toLowerCase().startsWith(h.head));
  if (head) {
    const wiring = presetWiring(rest);
    if (!wiring) return { error: `Unknown ${head.label} preset: "${raw}"` };
    const inner = resolveClaudeDirectModel(wiring.model);
    if ("error" in inner) {
      return {
        error:
          `${head.label} preset "${wiring.label}" runs ${wiring.model}, which the claude engine ` +
          "cannot serve (Anthropic models only).",
      };
    }
    return {
      model: inner.model,
      ...(wiring.dial ? { dial: wiring.dial } : {}),
      ...(wiring.orchestrator ? { orchestrator: wiring.orchestrator } : {}),
      ...(wiring.workspacePreset ? { workspacePreset: wiring.workspacePreset } : {}),
      ...(wiring.effort ? { effort: wiring.effort } : {}),
    };
  }

  if (prefixed) {
    const sep = rest.indexOf("/");
    if (sep <= 0 || sep === rest.length - 1) {
      return { error: `Not a claude engine model id: "${raw}" (expected claude/<provider>/<model>)` };
    }
    const upstream = rest.slice(0, sep);
    const slug = rest.slice(sep + 1);
    if (upstream !== SUPPORTED_UPSTREAM) {
      return {
        error:
          `The claude engine only serves ${SUPPORTED_UPSTREAM} models (got "${raw}"). ` +
          "Use an opencode/* id for other providers.",
      };
    }
    return isNativeClaudeSlug(slug)
      ? { model: slug }
      : { error: `Not an Anthropic model slug: "${slug}"` };
  }

  const foreign = raw.match(/^(?:opencode|pi)\/([^/]+)\/(.+)$/);
  if (foreign) {
    if (foreign[1] !== SUPPORTED_UPSTREAM) {
      return {
        error:
          `The claude engine only serves ${SUPPORTED_UPSTREAM} models (got "${raw}"). ` +
          "Use an opencode/* id for other providers.",
      };
    }
    return isNativeClaudeSlug(foreign[2])
      ? { model: foreign[2] }
      : { error: `Not an Anthropic model slug: "${foreign[2]}"` };
  }

  if (isNativeClaudeSlug(raw)) return { model: raw };
  return { error: `Not a model the claude engine can run: "${raw}"` };
}

function isNativeClaudeSlug(slug: string): boolean {
  return /^claude-[a-z0-9][\w.-]*$/i.test(slug);
}

// ── Effort ───────────────────────────────────────────────────────────────────

/** The SDK's four-rung effort ladder plus its thinking switch. */
export interface ClaudeDirectEffortConfig {
  effort?: "low" | "medium" | "high" | "max";
  thinking?: { type: "adaptive" } | { type: "disabled" };
}

/**
 * Map one of our six SESSION_EFFORTS onto the SDK's controls.
 *
 * The ladders don't line up: we expose none/low/medium/high/xhigh/max and the
 * SDK exposes low/medium/high/max plus an orthogonal `thinking` switch. So
 * "none" becomes thinking-off (there is no sub-low effort), and the two top
 * rungs turn adaptive thinking on — "xhigh" has no distinct SDK level and
 * rounds DOWN to high-with-adaptive-thinking rather than up to max, because
 * max is the rung a person picks deliberately above it.
 *
 * An unknown value returns `{}` (the model default), never a guess: passing a
 * bad literal through would make the SDK reject the whole turn.
 */
export function claudeDirectEffortConfig(
  effort: string | undefined
): ClaudeDirectEffortConfig {
  switch (effort as SessionEffort | undefined) {
    case "none":
      return { thinking: { type: "disabled" } };
    case "low":
      return { effort: "low" };
    case "medium":
      return { effort: "medium" };
    case "high":
      return { effort: "high" };
    case "xhigh":
      return { effort: "high", thinking: { type: "adaptive" } };
    case "max":
      return { effort: "max", thinking: { type: "adaptive" } };
    default:
      return {};
  }
}

// ── Tool naming + the strip-set ──────────────────────────────────────────────

/** Our workspace-tool ids (opencode spelling) → the SDK's tool names. Used
 *  when `disableLocalWorkspaceTools` strips the engine's local reach because
 *  the real workspace is only available over MCP. */
const LOCAL_WORKSPACE_SDK_TOOLS: Record<string, string[]> = {
  bash: ["Bash", "BashOutput", "KillShell"],
  read: ["Read", "NotebookRead"],
  write: ["Write"],
  edit: ["Edit", "MultiEdit", "NotebookEdit"],
  patch: ["Edit", "MultiEdit"],
  apply_patch: ["Edit", "MultiEdit"],
  grep: ["Grep"],
  glob: ["Glob"],
};

/** Split an SDK tool name into its MCP parts, or null for a built-in. */
export function parseMcpToolName(
  name: string
): { server: string; tool: string } | null {
  const m = name.match(/^mcp__(.+?)__(.+)$/);
  return m ? { server: m[1], tool: m[2] } : null;
}

/**
 * Is this SDK tool name covered by the run's strip-set?
 *
 * `disables` is `opencodeRunPolicy().disables`, whose keys are opencode's
 * `<server>_<tool>` ids plus, for the money-movers, the broad `*_<tool>` and
 * bare `<tool>` forms. This re-projects an SDK name onto all three so a
 * broad entry keeps its intentional over-blocking (that is the trade the
 * confirm-list makes) and a server-scoped entry stays exact.
 *
 * Built-ins compare case-insensitively: our ids are lowercase ("bash"), the
 * SDK's names are capitalized ("Bash").
 */
export function isStrippedToolName(
  name: string,
  disables: Record<string, false>
): boolean {
  const mcp = parseMcpToolName(name);
  if (mcp) {
    return (
      `${mcp.server}_${mcp.tool}` in disables ||
      `*_${mcp.tool}` in disables ||
      mcp.tool in disables
    );
  }
  const lower = name.toLowerCase();
  for (const key of Object.keys(disables)) {
    if (key.toLowerCase() === lower) return true;
    const expanded = LOCAL_WORKSPACE_SDK_TOOLS[key];
    if (expanded?.some((n) => n.toLowerCase() === lower)) return true;
  }
  return false;
}

/**
 * The names to hand the SDK's `disallowedTools` so they are REMOVED from the
 * model's tool list rather than merely denied on call. Exact names only —
 * `disallowedTools` has no wildcard form — so the broad `*_<tool>` entries in
 * the policy are enforced by isStrippedToolName in canUseTool instead. Both
 * layers run; this one is the one that keeps the tool out of the context.
 */
export function claudeDirectDisallowedTools(input: {
  deniedTools?: Record<string, string>;
  confirmTools?: Record<string, string>;
  disableLocalWorkspaceTools?: boolean;
}): string[] {
  const out = new Set<string>();
  for (const name of [
    ...Object.keys(input.deniedTools || {}),
    ...Object.keys(input.confirmTools || {}),
  ]) {
    // Our deny/confirm keys are already SDK-shaped (`mcp__server__tool`) for
    // MCP tools, and plain names otherwise — both pass through verbatim.
    out.add(name);
  }
  if (input.disableLocalWorkspaceTools) {
    for (const names of Object.values(LOCAL_WORKSPACE_SDK_TOOLS)) {
      for (const n of names) out.add(n);
    }
  }
  return [...out];
}

// ── Ask mode ─────────────────────────────────────────────────────────────────

/** Built-in tools an ask-mode run may not use at all. Bash is deliberately
 *  NOT here: it is screened per command by the read-only allowlist below,
 *  which is what makes ask mode useful instead of blind. */
export const ASK_MODE_DENIED_TOOLS = new Set([
  "Write",
  "Edit",
  "MultiEdit",
  "NotebookEdit",
  "KillShell",
]);

/** Built-ins every run gets: reading, searching, delegation, the web, and the
 *  permission-ask tool. Nothing here mutates the workspace. */
const READ_BUILTIN_TOOLS = [
  "Read",
  "Grep",
  "Glob",
  "NotebookRead",
  "Task",
  "TaskOutput",
  "TodoWrite",
  "WebFetch",
  "WebSearch",
  "Skill",
  "ListMcpResourcesTool",
  "ReadMcpResourceTool",
  "ToolSearch",
  "AskUserQuestion",
];

/** Built-ins that touch the workspace. Bash is here rather than in the read
 *  set because code mode gets it unscreened; ask mode gets it screened per
 *  command by askBashDecision. */
const WORKSPACE_BUILTIN_TOOLS = ["Bash", "BashOutput", "KillShell"];
const WRITE_BUILTIN_TOOLS = ["Write", "Edit", "MultiEdit", "NotebookEdit"];

/**
 * The SDK `tools` option: the base set of built-ins this run may see.
 *
 * Ask mode keeps Bash (screened) but no writers. `disableLocalWorkspaceTools`
 * — the engine-outside-its-sandbox case, where the real workspace is only
 * reachable over MCP — drops every filesystem and shell built-in, so a run
 * that lost its workspace can't quietly operate on the server's own cwd.
 */
export function claudeDirectBuiltinTools(input: {
  mode?: "ask" | "code" | "scratch";
  disableLocalWorkspaceTools?: boolean;
}): string[] {
  if (input.disableLocalWorkspaceTools) {
    return READ_BUILTIN_TOOLS.filter(
      (t) => !["Read", "Grep", "Glob", "NotebookRead"].includes(t)
    );
  }
  const base = [...READ_BUILTIN_TOOLS, ...WORKSPACE_BUILTIN_TOOLS];
  return input.mode === "ask" ? base : [...base, ...WRITE_BUILTIN_TOOLS];
}

/** Glob match with `*` spanning any characters (opencode's rule shape). */
function globMatches(pattern: string, value: string): boolean {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp(`^${escaped}$`).test(value);
}

/**
 * Split a command line into the sub-commands a permission rule must each
 * clear. Conservative by construction: any construct that can hide a command
 * from this split (command substitution, backticks, process substitution,
 * redirection into a file) makes the whole line unclassifiable, which the
 * caller treats as a deny.
 */
export function splitBashSubCommands(
  command: string
): { parts: string[] } | { unparseable: string } {
  const text = command.trim();
  if (!text) return { unparseable: "empty command" };
  if (/\$\(|`|<\(|>\(/.test(text)) {
    return { unparseable: "command substitution" };
  }
  if (/(^|[^0-9<>&])>{1,2}[^&]/.test(text)) {
    return { unparseable: "output redirection to a file" };
  }
  const parts = text
    .split(/\|\||&&|[;|\n]/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (!parts.length) return { unparseable: "no command" };
  return { parts };
}

/**
 * Would ask mode allow this bash command? Every sub-command must clear the
 * allowlist; an unparseable line is denied rather than guessed at.
 */
export function askBashDecision(
  command: string
): { allow: true } | { allow: false; reason: string } {
  const split = splitBashSubCommands(command);
  if ("unparseable" in split) {
    return {
      allow: false,
      reason:
        `this session is read-only and the command uses ${split.unparseable}, which cannot be ` +
        "checked against the read-only allowlist",
    };
  }
  for (const part of split.parts) {
    let verdict: "allow" | "deny" = "deny";
    for (const [pattern, decision] of Object.entries(ASK_BASH_PERMISSIONS)) {
      if (globMatches(pattern, part)) verdict = decision; // last match wins
    }
    if (verdict !== "allow") {
      return {
        allow: false,
        reason: `"${part.slice(0, 120)}" is not on the read-only allowlist for ask-mode sessions`,
      };
    }
  }
  return { allow: true };
}

// ── The permission decision ──────────────────────────────────────────────────

export type ClaudeDirectToolDecision =
  | { behavior: "allow" }
  | { behavior: "deny"; message: string; reason: string };

export interface ClaudeDirectToolPolicy {
  mode?: "ask" | "code" | "scratch";
  /** Merged deny/confirm messages, keyed by our tool names. */
  denyMessages: Record<string, string>;
  /** `opencodeRunPolicy().disables` — the strip-set membership test. */
  disables: Record<string, false>;
}

/**
 * The pure part of canUseTool: deny-map first, then ask mode's read-only
 * surface. Returns null when this layer has no opinion and the caller should
 * continue (AskUserQuestion routing, the unattended command-policy screen,
 * then allow).
 *
 * Order matters and mirrors the deleted claude-runner's canUseTool: an
 * explicitly denied tool is denied even in code mode, and ask mode's
 * read-only rules apply to everything the deny-map didn't already catch.
 */
export function claudeDirectToolDecision(
  toolName: string,
  toolInput: Record<string, unknown>,
  policy: ClaudeDirectToolPolicy
): ClaudeDirectToolDecision | null {
  const explicit = policy.denyMessages[toolName];
  if (explicit) return { behavior: "deny", message: explicit, reason: "denied_tool" };
  if (isStrippedToolName(toolName, policy.disables)) {
    return {
      behavior: "deny",
      message:
        `${toolName} is not available on this run (it is on the run's denied-tool list). ` +
        "State what you wanted to do instead of retrying.",
      reason: "stripped_tool",
    };
  }

  if (policy.mode === "ask") {
    if (ASK_MODE_DENIED_TOOLS.has(toolName)) {
      return {
        behavior: "deny",
        message: `${toolName} is not available in ask mode (read-only session).`,
        reason: "ask_mode",
      };
    }
    if (toolName === "Bash") {
      const command = String(toolInput?.command ?? "");
      const verdict = askBashDecision(command);
      if (!verdict.allow) {
        return {
          behavior: "deny",
          message:
            `Denied: ${verdict.reason}. Read-only inspection commands (cat/rg/ls/git log/git ` +
            "diff/gh pr view and friends) are available; anything that could modify state is not.",
          reason: "ask_mode_bash",
        };
      }
    }
  }
  return null;
}

// ── MCP ──────────────────────────────────────────────────────────────────────

/**
 * The run's EXTERNAL MCP servers in the SDK's config shape.
 *
 * Resolution goes through buildOpencodeMcpConfig so this engine inherits,
 * without a second copy: filterMcpServers (per-run allowlist + the per-user
 * `allowedUsers` gate) and the OAuth fresh-auth relay (short-lived tokens
 * re-resolved per request instead of baked into a config that can expire
 * mid-turn). Only the transport spelling is translated.
 *
 * In-process opensession-* servers are NOT built here: they reach a run only
 * through `opts.inProcessMcp`, which the interactive call sites set and
 * automations never do.
 */
export function buildClaudeDirectMcpServers(
  scope: McpScope,
  user: string | undefined,
  grantUsers?: Array<string | undefined>
): Record<string, McpServerConfig> {
  const { mcp } = buildOpencodeMcpConfig(scope, user, grantUsers);
  const out: Record<string, McpServerConfig> = {};
  for (const [name, cfg] of Object.entries(mcp)) {
    if (cfg.type === "remote" && typeof cfg.url === "string") {
      out[name] = {
        type: "http",
        url: cfg.url,
        ...(cfg.headers ? { headers: cfg.headers as Record<string, string> } : {}),
      };
    } else if (cfg.type === "local" && Array.isArray(cfg.command)) {
      const [command, ...args] = cfg.command as string[];
      if (!command) continue;
      out[name] = {
        type: "stdio",
        command,
        ...(args.length ? { args } : {}),
        // The SDK subprocess already runs on a minimal env, so a stdio server
        // it spawns inherits that plus its own configured credentials — never
        // the Open Session server env.
        ...(cfg.environment ? { env: cfg.environment as Record<string, string> } : {}),
      };
    }
  }
  return out;
}

/** In-process servers this engine drops from whatever the caller passed.
 *  opensession-ask exists for engines with no native permission-ask hook;
 *  claude-direct answers AskUserQuestion through canUseTool, and mounting
 *  both lets the model pick the duplicate. */
const DROPPED_INPROCESS_SERVERS = new Set(["opensession-ask"]);

/** The caller's in-process servers, minus the ones this engine supersedes.
 *  Values pass through verbatim: they are live `{type:"sdk", name, instance}`
 *  objects the SDK mounts directly. */
export function claudeDirectInProcessServers(
  inProcessMcp: Record<string, unknown> | undefined
): Record<string, McpServerConfig> {
  const out: Record<string, McpServerConfig> = {};
  for (const [name, server] of Object.entries(inProcessMcp || {})) {
    if (DROPPED_INPROCESS_SERVERS.has(name)) continue;
    if (!server || typeof server !== "object") continue;
    out[name] = server as McpServerConfig;
  }
  return out;
}

// ── Dial oracles ─────────────────────────────────────────────────────────────

/** Read-only tool surface for an oracle subagent: it advises, never executes. */
const ORACLE_TOOLS = ["Read", "Grep", "Glob", "WebFetch", "WebSearch"];

/** Every built-in that reaches the local filesystem or shell. A subagent
 *  carries its OWN tool list, so `disableLocalWorkspaceTools` — the run whose
 *  real workspace is only reachable over MCP — has to be applied here too, or
 *  a worker keeps a shell in the server's own cwd after the main agent lost
 *  one. */
const LOCAL_WORKSPACE_TOOL_NAMES = new Set(
  Object.values(LOCAL_WORKSPACE_SDK_TOOLS).flat()
);

function withoutLocalWorkspaceTools(tools: string[], disabled?: boolean): string[] {
  return disabled ? tools.filter((t) => !LOCAL_WORKSPACE_TOOL_NAMES.has(t)) : tools;
}

/**
 * The Dial's oracle subagents as SDK agent definitions, resolved onto THIS
 * engine's bridge. A claude-direct server can only run Anthropic models, so a
 * cross-vendor oracle keeps its NAME (prompts and instructions stay stable)
 * while its body resolves to the same-bridge substitute — naming a model the
 * bridge can't serve is how a task call dies on "Model not found".
 */
export function claudeDirectOracleAgents(input?: {
  disableLocalWorkspaceTools?: boolean;
}): Record<
  string,
  {
    description: string;
    prompt: string;
    model: string;
    tools: string[];
    effort?: "low" | "medium" | "high" | "max";
  }
> {
  const out: Record<string, any> = {};
  for (const name of Object.keys(DIAL_ORACLE_AGENTS)) {
    const oracle = DIAL_ORACLE_AGENTS[sameBridgeDialOracle(name, SUPPORTED_UPSTREAM)];
    if (!oracle) continue;
    const slug = oracle.model.replace(/^[^/]+\//, "");
    const { effort } = claudeDirectEffortConfig(oracle.variant);
    out[name] = {
      description: oracle.description,
      prompt:
        "You are a read-only senior engineering advisor. Give a concise, concrete second " +
        "opinion: state assumptions, tradeoffs, and recommended next steps. You may read " +
        "and search the workspace, but you never edit files or run commands.",
      model: slug,
      tools: withoutLocalWorkspaceTools(ORACLE_TOOLS, input?.disableLocalWorkspaceTools),
      ...(effort ? { effort } : {}),
    };
  }
  return out;
}

/** Picker label for the oracle a Dial preset actually gets on this engine
 *  (the same-bridge substitute when the preset names a cross-vendor one). */
export function claudeDirectOracleLabel(agentName: string): string {
  const oracle = DIAL_ORACLE_AGENTS[sameBridgeDialOracle(agentName, SUPPORTED_UPSTREAM)];
  return oracle?.label || agentName;
}

// ── Orchestrator workers ─────────────────────────────────────────────────────

/** Read-only surface a worker shares with the oracles, plus notebook reads. */
const WORKER_READ_TOOLS = [
  "Read",
  "Grep",
  "Glob",
  "NotebookRead",
  "WebFetch",
  "WebSearch",
];

/** A code-mode worker executes: it gets the shell and the writers, because
 *  "workers do the typing" is the whole point of the preset. */
const WORKER_CODE_TOOLS = [
  ...WORKER_READ_TOOLS,
  "Bash",
  "BashOutput",
  "Write",
  "Edit",
  "MultiEdit",
  "NotebookEdit",
  "TodoWrite",
];

const WORKER_CODE_PROMPT =
  "You are an implementation worker. Execute the one subtask you were given, end to end, in " +
  "the workspace you were handed: read what you need, make the change, and verify it (build " +
  "or tests) before reporting. Stay inside the brief — no adjacent refactors, no design " +
  "changes, no commits or pushes unless the brief asks for them. Report what you changed, " +
  "with file paths, and anything you could not do.";

const WORKER_ASK_PROMPT =
  "You are a read-only investigator. Answer the one question you were given from the " +
  "workspace: read and search the code, then report concrete findings with file paths and " +
  "line numbers. You cannot edit files or run commands — say so plainly if the task needs " +
  "them, rather than describing an edit as if you made it.";

/**
 * The Orchestrator's worker subagents as SDK agent definitions.
 *
 * Two deliberate differences from the oracles:
 *
 *  - Workers get WRITE tools in code mode. An oracle advises and never
 *    executes; a worker exists to execute. In ask mode they collapse to the
 *    read-only surface — not "Bash, screened", because the ask-mode bash
 *    allowlist is enforced in `canUseTool` and a subagent's shell is not a
 *    surface to bet a read-only session on.
 *  - The backing model is forced onto this engine's bridge with an EMPTY
 *    provider set, so `worker-fast`'s Cerebras preference (a real option on
 *    opencode) can't name a model this SDK cannot run. Worker NAMES stay
 *    stable across engines; only the body changes.
 *
 * Registered on every run like the oracles — a stable agent set — while only
 * orchestrator-preset runs are told the workers exist.
 */
export function claudeDirectWorkerAgents(input: {
  mode?: "ask" | "code" | "scratch";
  disableLocalWorkspaceTools?: boolean;
}): Record<
  string,
  {
    description: string;
    prompt: string;
    model: string;
    tools: string[];
    effort?: "low" | "medium" | "high" | "max";
  }
> {
  const out: Record<string, any> = {};
  const isAsk = input.mode === "ask";
  for (const [name, worker] of Object.entries(ORCHESTRATOR_WORKER_AGENTS)) {
    const backing = claudeDirectWorkerBacking(name);
    if (!backing) continue;
    const { effort } = claudeDirectEffortConfig(backing.variant);
    out[name] = {
      description: worker.description,
      prompt: isAsk ? WORKER_ASK_PROMPT : WORKER_CODE_PROMPT,
      model: backing.slug,
      tools: withoutLocalWorkspaceTools(
        isAsk ? WORKER_READ_TOOLS : WORKER_CODE_TOOLS,
        input.disableLocalWorkspaceTools
      ),
      ...(effort ? { effort } : {}),
    };
  }
  return out;
}

/** The Anthropic model backing a worker name on this engine, or undefined
 *  when no bridge entry resolves to a model the SDK can run. */
function claudeDirectWorkerBacking(
  name: string
): { slug: string; label: string; variant: SessionEffort } | undefined {
  const backing = orchestratorWorkerForBridge(name, SUPPORTED_UPSTREAM, new Set());
  if (!backing) return undefined;
  const slug = backing.model.replace(/^[^/]+\//, "");
  if (!isNativeClaudeSlug(slug)) return undefined;
  return { slug, label: backing.label, variant: backing.variant };
}

/** The worker roster for an orchestrator preset's instructions block: the
 *  preset's workers that this engine actually registered, with the label of
 *  the model each one runs here. */
export function claudeDirectOrchestratorWorkers(
  preset: OrchestratorPreset
): Array<{ agent: string; label: string; modelLabel: string }> {
  return preset.workerAgents.flatMap((name) => {
    const backing = claudeDirectWorkerBacking(name);
    if (!backing) return [];
    return [
      {
        agent: name,
        label: ORCHESTRATOR_WORKER_AGENTS[name]?.label || name,
        modelLabel: backing.label,
      },
    ];
  });
}

/** Every subagent this engine registers: the Dial's oracles and the
 *  Orchestrator's workers. One static set per mode, so a session that switches
 *  preset mid-run never finds an agent missing. */
export function claudeDirectAgents(input: {
  mode?: "ask" | "code" | "scratch";
  disableLocalWorkspaceTools?: boolean;
}): Record<string, unknown> {
  return {
    ...claudeDirectOracleAgents(input),
    ...claudeDirectWorkerAgents(input),
  };
}

// ── Usage ────────────────────────────────────────────────────────────────────

export function emptyTurnUsage(): TurnUsage {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    contextTokens: 0,
  };
}

/**
 * Fold one SDK `result` message's usage into the run-cumulative total.
 *
 * A steered turn produces one result message PER turn, so reading only the
 * last one under-reports the run — token counts and cost accumulate, while
 * `contextTokens` is the LAST prompt's size (the live "how full is the window"
 * figure), so it is replaced rather than summed.
 */
export function addResultUsage(
  total: TurnUsage,
  result: { usage?: Record<string, number | undefined> | null; total_cost_usd?: unknown }
): TurnUsage {
  const u = result.usage || {};
  const input = u.input_tokens || 0;
  const cacheRead = u.cache_read_input_tokens || 0;
  const cacheCreate = u.cache_creation_input_tokens || 0;
  const cost =
    typeof result.total_cost_usd === "number" ? result.total_cost_usd : undefined;
  return {
    // The SDK reports total_cost_usd cumulatively for the whole query, so the
    // latest value wins rather than being added to itself.
    costUsd: cost !== undefined ? cost : total.costUsd,
    inputTokens: total.inputTokens + input,
    outputTokens: total.outputTokens + (u.output_tokens || 0),
    cacheReadTokens: total.cacheReadTokens + cacheRead,
    cacheCreationTokens: total.cacheCreationTokens + cacheCreate,
    contextTokens: input + cacheRead + cacheCreate,
  };
}
