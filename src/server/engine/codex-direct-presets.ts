/**
 * Preset resolution for the codex-direct engine — the Dial, the Orchestrator
 * and workspace model presets.
 *
 * The contract is the opencode runner's (opencode-runner.ts, "The Dial / The
 * Orchestrator" block): a session STORES the preset id as its model, and every
 * engine resolves it to a concrete model plus an effort override at dispatch,
 * so tier wiring can change without rewriting stored sessions. Three ids can
 * name the same preset and all three land here:
 *
 *   codex/dial/medium          the routed preset id (what reaches runCodexDirect)
 *   dial/medium                the stored id, engine-prefix-less
 *   workspace-preset/<ws>/<id> a workspace preset whose lead+oracle happen to
 *                              match a built-in Dial tier, in which case
 *                              `enginePresetId` carries that tier's real wiring
 *
 * Two codex-specific decisions:
 *
 *  - The oracle is resolved through `sameBridgeDialOracle(..., "openai")`.
 *    codex only ever runs OpenAI models, so this engine matches what the
 *    opencode runner already does for an openai-provider dial run: dial/high's
 *    Fable oracle becomes Terra. Keeping the oracle on the same vendor also
 *    means a dial run does not silently lose its oracle on an instance with no
 *    Anthropic bridge configured.
 *  - A preset whose MAIN model is not an OpenAI one (dial/ultra, on Fable)
 *    resolves to null in parseCodexDirectModel rather than being handed to
 *    codex — a misroute fails loudly. `resolveModel` already refuses to mint
 *    `codex/dial/ultra` for the same reason, so this is the second line.
 */

import {
  ORCHESTRATOR_WORKER_AGENTS,
  DIAL_ORACLE_AGENTS,
  dialPreset,
  orchestratorPreset,
  orchestratorWorkerForBridge,
  sameBridgeDialOracle,
  type DialPreset,
  type OrchestratorPreset,
  type SessionEffort,
} from "../models";
import { resolveWorkspaceModelPreset } from "../workspace-model-presets";

/** The only vendor codex serves — every same-bridge substitution is computed
 *  against it. */
export const CODEX_DIRECT_PROVIDER_ID = "openai";

export interface CodexDirectPreset {
  dial?: DialPreset;
  orchestrator?: OrchestratorPreset;
  /** The preset's effort override; undefined on a non-preset run, where the
   *  session's own effort stands. */
  effort?: SessionEffort;
  /** The preset's MAIN model (bare slug). */
  model?: string;
  /** Set when the preset was reached through a workspace preset — for the
   *  audit log, so a run's wiring can be traced back to the picker entry. */
  workspacePresetId?: string;
  /** The oracle agent this run can ACTUALLY consult (same-bridge resolved).
   *  Only set for dial presets. */
  oracleAgent?: string;
}

/** The concrete main model behind a dial/orchestrator preset id, or undefined
 *  for anything that is not a preset. Engine-prefix agnostic. */
export function codexDirectPresetModel(model?: string | null): string | undefined {
  return dialPreset(model)?.model ?? orchestratorPreset(model)?.model;
}

function firstOf<T>(
  ids: Array<string | null | undefined>,
  lookup: (id?: string | null) => T | undefined
): T | undefined {
  for (const id of ids) {
    const hit = lookup(id);
    if (hit) return hit;
  }
  return undefined;
}

/**
 * Resolve every model id a turn carries into one preset view. Pass the routed
 * model AND the session's stored model (`opts.model`): the routed id is what
 * runCodexDirect was called with, the stored id is what survives on the
 * session, and a workspace preset only ever appears in the stored one.
 * Non-preset runs return `{}`.
 */
export function resolveCodexDirectPreset(
  ...modelIds: Array<string | null | undefined>
): CodexDirectPreset {
  const workspace = firstOf(modelIds, (id) => resolveWorkspaceModelPreset(id));
  const candidates = [...modelIds, workspace?.enginePresetId];
  const dial = firstOf(candidates, dialPreset);
  const orchestrator = firstOf(candidates, orchestratorPreset);
  const effort = dial?.effort ?? orchestrator?.effort;
  const model = dial?.model ?? orchestrator?.model;
  return {
    ...(dial ? { dial } : {}),
    ...(orchestrator ? { orchestrator } : {}),
    ...(effort ? { effort } : {}),
    ...(model ? { model } : {}),
    ...(workspace ? { workspacePresetId: workspace.id } : {}),
    ...(dial
      ? { oracleAgent: sameBridgeDialOracle(dial.oracleAgent, CODEX_DIRECT_PROVIDER_ID) }
      : {}),
  };
}

/** The preset id to record in the audit log, or undefined. */
export function codexDirectPresetId(preset: CodexDirectPreset): string | undefined {
  return preset.workspacePresetId ?? preset.dial?.id ?? preset.orchestrator?.id;
}

/** Human label for the oracle a dial run consults. */
export function codexDirectOracleLabel(oracleAgent?: string): string | undefined {
  if (!oracleAgent) return undefined;
  return DIAL_ORACLE_AGENTS[oracleAgent]?.label || oracleAgent;
}

type InstructionInputs = Pick<
  Parameters<typeof import("../run-instructions").buildRunInstructions>[0],
  "dialOracle" | "orchestrator"
>;

/**
 * The `dialOracle` / `orchestrator` blocks for buildRunInstructions.
 *
 * Both are deliberately conditional on the run ACTUALLY having the surface
 * they describe — instructions that name a tool the run does not carry read as
 * a broken tool:
 *  - the oracle block only when the oracle MCP server was wired in
 *    (`hasOracle`), which needs a unified session id for the run-rpc proxy;
 *  - the orchestrator block only when the caller passed the
 *    `opensession-sessions` worker tools in `inProcessMcp`. codex has no
 *    client-side dynamic tool registration, so there are no worker SUBAGENTS
 *    on this engine — delegation is the sessions MCP or nothing, and an
 *    orchestrator preset without it still gets its effort override.
 */
export function codexDirectPresetInstructions(input: {
  preset: CodexDirectPreset;
  /** The concrete model running the turn, for "you (<label>)". */
  modelLabel: string;
  /** Fully-qualified oracle tool name as codex exposes it. */
  oracleToolName: string;
  hasOracle: boolean;
  hasSessionsMcp: boolean;
}): InstructionInputs {
  const { preset } = input;
  const out: InstructionInputs = {};
  if (preset.dial && input.hasOracle && preset.oracleAgent) {
    out.dialOracle = {
      agent: input.oracleToolName,
      presetLabel: preset.dial.label,
      mainLabel: input.modelLabel,
      oracleLabel: codexDirectOracleLabel(preset.oracleAgent) || preset.oracleAgent,
      tool: true,
    };
  }
  if (preset.orchestrator && input.hasSessionsMcp) {
    out.orchestrator = {
      presetLabel: preset.orchestrator.label,
      mainLabel: input.modelLabel,
      workers: preset.orchestrator.workerAgents.map((name) => ({
        agent: name,
        label: ORCHESTRATOR_WORKER_AGENTS[name]?.label || name,
        modelLabel:
          orchestratorWorkerForBridge(name, CODEX_DIRECT_PROVIDER_ID)?.label || name,
      })),
      tool: "sessions",
    };
  }
  return out;
}
