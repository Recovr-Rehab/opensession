/**
 * Claude-direct engine — Anthropic's Claude Agent SDK driven IN-PROCESS as a
 * first-class engine beside opencode and pi. Model ids are
 * `claude/anthropic/<model>` (plus `claude/dial/<preset>`); the bare native
 * `claude-*` and another engine's `opencode|pi/anthropic/*` spelling are
 * accepted so a session that switches engines doesn't dead-end on its first
 * turn.
 *
 * Unlike the Meridian bridge (anthropic-bridge.ts), tools are NOT blocked
 * passthroughs: the SDK executes its own tools in `opts.cwd`, and its message
 * stream is normalized into the shared StreamEvent shapes.
 *
 * Policy parity (the pi-runner 14-point checklist; the pure half of each item
 * lives in claude-direct-policy.ts):
 *  - Config gate, not an env flag: every turn refuses unless
 *    `directEngineEnabled("claude")` (engines-config.ts, `~/.opensession-
 *    engines.json`; the old OPENSESSION_ENGINE_CLAUDE_DIRECT=1 is honored
 *    there as a legacy alias). Kind gate copies opencodeGateReason semantics —
 *    deny by default on journal kind, kind-less runs refused, denials audited
 *    (`claude_direct_gate_denied`). The one escape is the module-internal
 *    smoke bypass (kind "claude-direct-smoke", an armed counter incremented
 *    only inside runClaudeDirectSmokeTurn — request/automation data can name
 *    the kind but can never arm it).
 *  - Auth: a subscription account from claude-accounts (resolveAccount, so
 *    strict pins never widen to the pool and another user's personal
 *    subscription never serves this run) delivered as
 *    CLAUDE_CODE_OAUTH_TOKEN plus an ISOLATED per-account CLAUDE_CONFIG_DIR
 *    under ~/.opensession-claude-direct. The subprocess env is minimal —
 *    PATH/HOME/LANG, the git identity, the per-user GitHub token on eligible
 *    interactive runs, the AWS pointer env when `opts.aws`, and the two
 *    Claude vars. Never the Open Session server env, never host ~/.claude.
 *  - Tool policy: `opencodeRunPolicy` computes the strip-set; the exact names
 *    go to the SDK's `disallowedTools` so they are REMOVED from the model's
 *    tool list, and `canUseTool` is the enforcement of record for the broad
 *    (money-mover) forms a wildcard-less strip list can't express.
 *    STRIPE_CONFIRM_TOOLS ride `opts.confirmTools` on every run, so they are
 *    stripped everywhere. Ask mode is genuinely read-only WITH a screened
 *    Bash (the ported ASK_BASH_PERMISSIONS allowlist), not a blanket denial.
 *    Unattended code-mode bash is additionally screened per command through
 *    the org command policy (`bashAskPolicyReply`).
 *  - MCP: external servers resolve through buildClaudeDirectMcpServers →
 *    buildOpencodeMcpConfig → filterMcpServers, so the per-run allowlist, the
 *    per-user `allowedUsers` gate and the OAuth fresh-auth relay all apply
 *    unchanged. The in-process opensession-* servers are mounted ONLY from
 *    `opts.inProcessMcp` — never synthesized here — which is what keeps them
 *    out of automation runs and out of interactive resumes of automation
 *    sessions.
 *  - Steer: streaming-input mode. `steerClaudeDirectRun` folds a message into
 *    the live turn at its next boundary (mid-turn stream-json input is
 *    consumed but never starts a turn — the CLI behavior the deleted
 *    claude-runner documented), the transcript user line is written only at
 *    DELIVERY, and the run stops accepting steers in the same tick it decides
 *    to finish.
 *  - Journal: two-stage like opencode/pi (pre-engine record with the prompt,
 *    upgraded with the SDK session id in the `claudeSessionId` slot) but NEVER
 *    a serverKey — an in-process run doesn't survive a restart, so boot takes
 *    the continuation re-prompt path and `reattach()` stays null.
 *  - Transcript: store-only. recordBksSessionFor maps SDK→unified BEFORE any
 *    engine-keyed append (the W1 import-first gate), the turn's user line is
 *    written early under the unified id with the caller's promptEntryId and
 *    re-appended with the same uuid so the row upserts instead of duplicating
 *    the bubble.
 *  - Exactly ONE terminal done/error per turn. A user cancel ends QUIETLY —
 *    no terminal event, the generator just returns — so run-session records no
 *    failure for a run a human deliberately stopped.
 *  - Usage-limit shapes markExhausted the account and set `usageLimitExhausted`
 *    on the terminal so agent-runner's fallback walk engages; a pool that is
 *    dry at pick time fails before any SDK work and fails flagged.
 *  - Audit: the `claude_direct_turn` family (in with summarizeText(prompt),
 *    out through a first-call-wins closer with a finally backstop) plus
 *    `claude_direct_gate_denied`. Never raw prompt or output text.
 *
 * Deliberately not implemented (with reasons):
 *  - reattach(): SDK runs are direct children of this process; nothing
 *    survives a restart. Returns null, activeDetachedRunCount() is 0, and the
 *    journal deliberately carries no serverKey so boot re-prompts instead.
 *  - Background-task holding (the deleted claude-runner's boundary hold for
 *    Task/run_in_background work): a turn that ends with background tasks in
 *    flight kills them. pi has the same gap; it needs its own design.
 *  - Token-level partial streaming (`includePartialMessages`): text is
 *    emitted per completed assistant block.
 *  - seedTranscriptEntries: ignored, like every non-opencode runner — the
 *    store already holds unified history and handoffs ride the prompt.

 */

import { query } from "@anthropic-ai/claude-agent-sdk";
import type { SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import { existsSync, mkdirSync, readdirSync } from "fs";
import { stateDir } from "../paths";
import { audit, summarizeText } from "../audit";
import {
  resolveAccount,
  markExhausted,
  type ClaudeAccount,
} from "../claude-accounts";
import { CLAUDE_CODE_BIN, isClaudeUsageLimitError } from "../runner-shared";
import {
  INTERACTIVE_KINDS,
  isUnattendedKind,
  baseJournalKind,
  opencodeRunPolicy,
  readLocalInstructions,
} from "../opencode-policy";
import { buildRunInstructions } from "../run-instructions";
import { bashAskPolicyReply } from "../command-policy";
import {
  journalSet,
  buildRunJournalRecord,
  journalClear,
  registerActiveRunProbe,
} from "../run-journal";
import {
  appendOpencodeTranscript,
  recordBksSessionFor,
  transcriptLineForEntry,
  transcriptLineRunnerNotice,
  transcriptLineUser,
  storeAppendUserLineEarly,
} from "../opencode-transcript";
import { transcriptStore } from "../transcript-store";
import { gitIdentityEnv } from "../shared/user-mappings";
import { githubAuthEnv, githubUserLoginForRun } from "../github-auth";
import { ensureAgentAwsCredsFile } from "../aws-creds";
import { directEngineEnabled } from "./engines-config";
import {
  addResultUsage,
  buildClaudeDirectMcpServers,
  claudeDirectAgents,
  claudeDirectBuiltinTools,
  claudeDirectDisallowedTools,
  claudeDirectEffortConfig,
  claudeDirectInProcessServers,
  claudeDirectOracleLabel,
  claudeDirectOrchestratorWorkers,
  claudeDirectToolDecision,
  emptyTurnUsage,
  resolveClaudeDirectModel,
  CLAUDE_DIRECT_MODEL_PREFIX,
} from "./claude-direct-policy";
import type { TranscriptEntry } from "../types";
import type {
  ActiveRunRecord,
  EngineAdapter,
  EngineAskHandler,
  ImageInput,
  RunAgentOpts,
  StreamEvent,
  TurnUsage,
} from "./adapter-types";

export {
  CLAUDE_DIRECT_MODEL_PREFIX,
  resolveClaudeDirectModel,
} from "./claude-direct-policy";

const g = globalThis as any;

const PROVIDER = "claude" as const;

/** State root: per-account CLAUDE_CONFIG_DIRs and the smoke-turn scratch cwd.
 *  Never host ~/.claude. */
export const CLAUDE_DIRECT_STATE_DIR = stateDir("claude-direct");

/** Whether the engine may run at all. Read fresh per turn so a config edit
 *  applies without a restart. */
export function claudeDirectEnabled(): boolean {
  return directEngineEnabled("claude");
}

// ── Live-run registry ────────────────────────────────────────────────────────

interface ClaudeDirectRunHandle {
  abort: AbortController;
  /** Present only while the run is still accepting mid-turn steers. */
  steer?: (text: string, images?: ImageInput[]) => void;
}

// Alias keys (run key, unified session id, SDK session id) → one shared
// handle, parked on globalThis so a hot reload keeps cancel/steer/isBusy
// working for in-flight turns.
const activeRuns: Map<string, ClaudeDirectRunHandle> = (g.__claudeDirectActiveRuns ??=
  new Map());

registerActiveRunProbe((runKey) => activeRuns.has(runKey));

export function isClaudeDirectBusy(id: string): boolean {
  return activeRuns.has(id);
}

/** Distinct live runs (aliases collapse) — the graceful-shutdown drain. */
export function activeClaudeDirectRunCount(): number {
  return new Set(activeRuns.values()).size;
}

export function cancelClaudeDirectRun(id: string): boolean {
  const handle = activeRuns.get(id);
  if (!handle) return false;
  handle.abort.abort();
  return true;
}

/**
 * Fold a message into a live turn at its next boundary. True = a run accepted
 * it for delivery; false = nothing steerable under this id (the caller queues
 * it as the next turn instead).
 */
export function steerClaudeDirectRun(
  id: string,
  text: string,
  images?: ImageInput[]
): boolean {
  const handle = activeRuns.get(id);
  if (!handle?.steer) return false;
  handle.steer(text, images);
  return true;
}

// ── Gate ─────────────────────────────────────────────────────────────────────

/** The private journal kind the smoke harness runs under. */
const SMOKE_KIND = "claude-direct-smoke";

// Armed only inside runClaudeDirectSmokeTurn. A counter, so overlapping smoke
// calls can't disarm each other; request/automation data can name SMOKE_KIND
// but can never arm the bypass.
let smokeGateBypass = 0;

/** Non-null = the reason this run may not use the claude engine. Same
 *  deny-by-default semantics as opencodeGateReason: interactive and unattended
 *  journal kinds only, kind-less runs refused. */
export function claudeDirectGateReason(opts: {
  journal?: { kind?: string };
}): string | null {
  const base = baseJournalKind(opts.journal?.kind);
  if (base === SMOKE_KIND && smokeGateBypass > 0) return null;
  if (INTERACTIVE_KINDS.has(base) || isUnattendedKind(base)) return null;
  return base
    ? `The claude engine is not available to "${base}" runs — interactive sessions and automations only.`
    : "The claude engine requires an explicit run kind (journal.kind) — " +
        "deny by default; interactive sessions and automations only.";
}

// ── Small helpers ────────────────────────────────────────────────────────────

function nowIso(): string {
  return new Date().toISOString();
}

/**
 * Store one batch of normalized entries under the SDK session id. Requires
 * recordBksSessionFor to have mapped SDK→unified first (see runClaudeDirect);
 * system entries ride runner-notice lines, which the shared parser maps back
 * to a system chip — transcriptLineForEntry has no system shape, and dropping
 * them here would lose them entirely. Best-effort: a transcript write must
 * never take the run down.
 */
function persistEntries(
  engineSessionId: string | undefined,
  entries: TranscriptEntry[]
): void {
  if (!entries.length || !engineSessionId) return;
  try {
    const lines = entries
      .map((e) =>
        e.type === "system"
          ? transcriptLineRunnerNotice(e.content, e.id, e.timestamp)
          : transcriptLineForEntry(e)
      )
      .filter((l): l is Record<string, unknown> => !!l);
    appendOpencodeTranscript(engineSessionId, lines);
  } catch (e) {
    console.warn("[claude-direct] transcript persist failed:", e);
  }
}

/** Flatten a tool_result block's content to plain text (string or text-block
 *  array — the same subset anthropic-bridge reads). */
function toolResultText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  for (const b of content as Array<Record<string, unknown>>) {
    if (b && b.type === "text" && typeof b.text === "string") parts.push(b.text);
  }
  return parts.join("\n");
}

/** Whether `resumeId`'s SDK conversation exists in one account's isolated
 *  config dir (cfg/<account>/projects/<cwd-slug>/<resumeId>.jsonl). */
function conversationOnAccount(accountId: string, resumeId: string): boolean {
  try {
    const projects = `${CLAUDE_DIRECT_STATE_DIR}/cfg/${accountId}/projects`;
    for (const slug of readdirSync(projects)) {
      if (existsSync(`${projects}/${slug}/${resumeId}.jsonl`)) return true;
    }
  } catch {}
  return false;
}

/** The account whose config dir holds `resumeId`'s conversation, or null. The
 *  scan is tiny (accounts x project slugs) and restart-proof: the disk is the
 *  only durable record of which account minted an SDK session. */
function accountOwningConversation(resumeId: string): string | null {
  try {
    for (const accountId of readdirSync(`${CLAUDE_DIRECT_STATE_DIR}/cfg`)) {
      if (conversationOnAccount(accountId, resumeId)) return accountId;
    }
  } catch {}
  return null;
}

/** Account for this run: honor a pinned accountId first (strict pins never
 *  widen to the pool — automation cost-cap semantics), then the account that
 *  OWNS the conversation being resumed (each account's config dir is
 *  isolated, so any other account resumes into "No conversation found"),
 *  else the normal personal-first pool pick. resolveAccount owns that order
 *  and the owner gate on every step of it: a pin or a resume owner that is
 *  someone else's personal subscription is refused like any other ineligible
 *  account. An owner that can't serve falls through to the pool — the resume
 *  pre-flight in runClaudeDirect then starts fresh with a handoff note
 *  instead of letting the SDK fail the turn. */
function pickDirectAccount(
  opts: RunAgentOpts,
  model: string,
  resumeId?: string
): { account: ClaudeAccount } | { error: string } {
  const resolved = resolveAccount({
    user: opts.user,
    model,
    pinnedId: opts.accountId,
    strictPin: opts.accountStrict,
    stickyId: resumeId ? accountOwningConversation(resumeId) ?? undefined : undefined,
    allowExtraUsage: opts.usageCredits,
  });
  if ("account" in resolved) return { account: resolved.account };
  if (resolved.refusal.kind === "pin-unusable") {
    return {
      error: `pinned account "${resolved.refusal.pinName}" is not usable right now (strict pin — not widening to the pool)`,
    };
  }
  return { error: "no usable Claude account in the pool" };
}

/** An SDK user message, with pasted/dropped images as content blocks. */
function userMessage(text: string, images?: ImageInput[]): SDKUserMessage {
  if (!images?.length) {
    return {
      type: "user",
      message: { role: "user", content: text },
      parent_tool_use_id: null,
    } as SDKUserMessage;
  }
  const blocks: unknown[] = [];
  if (text) blocks.push({ type: "text", text });
  for (const im of images) {
    blocks.push({
      type: "image",
      source: { type: "base64", media_type: im.mediaType, data: im.data },
    });
  }
  return {
    type: "user",
    message: { role: "user", content: blocks },
    parent_tool_use_id: null,
  } as SDKUserMessage;
}

// ── The turn ─────────────────────────────────────────────────────────────────

export async function* runClaudeDirect(
  opts: RunAgentOpts,
  model: string
): AsyncGenerator<StreamEvent> {
  // Config gate first: the clearest refusal when the engine is off entirely.
  if (!claudeDirectEnabled()) {
    yield {
      type: "error",
      content:
        'The claude engine is not enabled (~/.opensession-engines.json). Set {"claude":{"enabled":true}} there to turn it on.',
      provider: PROVIDER,
      model,
    };
    return;
  }
  const gateReason = claudeDirectGateReason(opts);
  if (gateReason) {
    audit({
      msg: "claude_direct_gate_denied",
      run_kind: opts.journal?.kind,
      session_id: opts.journal?.osSessionId,
      reason: gateReason,
    });
    yield { type: "error", content: gateReason, provider: PROVIDER, model };
    return;
  }
  const resolvedModel = resolveClaudeDirectModel(model);
  if ("error" in resolvedModel) {
    yield {
      type: "error",
      content: `claude-direct: ${resolvedModel.error}`,
      provider: PROVIDER,
      model,
    };
    return;
  }
  const nativeModel = resolvedModel.model;
  // The Dial / The Orchestrator / a workspace ("Custom") preset: the id
  // resolved to a concrete Anthropic model above, and these are the wiring
  // that rides with it — the oracle or worker instructions below, and the
  // preset's own reasoning effort, which overrides the session's.
  const dial = resolvedModel.dial;
  const orch = resolvedModel.orchestrator;

  const {
    prompt,
    cwd,
    mode,
    mcpServers,
    confirmTools,
    journal,
    user,
    author,
  } = opts;
  const isAsk = mode === "ask";
  const isScratch = mode === "scratch";

  const runKey = opts.sessionId || journal?.osSessionId || crypto.randomUUID();
  if (activeRuns.has(runKey)) {
    yield { type: "error", content: "Session is busy" };
    return;
  }
  const abort = new AbortController();
  const handle: ClaudeDirectRunHandle = { abort };
  const registeredKeys = new Set<string>([runKey]);
  if (journal?.osSessionId) registeredKeys.add(journal.osSessionId);
  if (opts.transcriptSessionId) registeredKeys.add(opts.transcriptSessionId);
  for (const key of registeredKeys) activeRuns.set(key, handle);

  // The unified session id every transcript row keys on; kind-only loop runs
  // may pass transcriptSessionId instead (map-only, never journaled).
  const unifiedSessionId = journal?.osSessionId || opts.transcriptSessionId;

  const requestId = crypto.randomUUID();
  const started = Date.now();
  const auditBase = {
    msg: "claude_direct_turn",
    request_id: requestId,
    run_key: runKey,
    session: journal?.osSessionId,
    run_kind: journal?.kind,
    resume: opts.sessionId,
    model: nativeModel,
    mode: mode || "code",
  };
  // First-call-wins run closer + finally backstop.
  let turnEnded = false;
  const endTurn = (fields: Record<string, unknown>) => {
    if (turnEnded) return;
    turnEnded = true;
    audit({ ...auditBase, direction: "out", duration_ms: Date.now() - started, ...fields });
  };

  let engineSessionId: string | undefined = opts.sessionId;
  let reachedTerminal = false;
  let account: ClaudeAccount | undefined;

  try {
    // Durability before the engine exists (the opencode two-stage): journal
    // the run with its original prompt — no engine id yet and NO serverKey, so
    // a death here re-runs from scratch and a restart mid-turn takes the
    // continuation re-prompt path — and persist the user line under the
    // unified id with a stable uuid.
    const userLine = transcriptLineUser(
      prompt,
      opts.promptEntryId,
      undefined,
      opts.images
    );
    const journalRecord = (claudeSessionId: string | undefined) =>
      buildRunJournalRecord(opts, {
        runKey,
        osSessionId: journal!.osSessionId!,
        claudeSessionId,
        prompt,
        promptEntryId: String(userLine.uuid),
        cwd,
        mode,
        mcpServers,
        user,
        confirmTools,
        model,
        effort: opts.effort,
        fastMode: opts.fastMode,
        accountId: opts.accountId,
        accountStrict: opts.accountStrict,
        usageCredits: opts.usageCredits,
        kind: journal!.kind,
      });
    if (journal?.osSessionId) {
      journalSet(journalRecord(opts.sessionId || undefined));
      storeAppendUserLineEarly(journal.osSessionId, userLine, opts.sessionId);
    }

    const policy = opencodeRunPolicy({
      deniedTools: opts.deniedTools,
      confirmTools,
      journalKind: journal?.kind,
      disableLocalWorkspaceTools: opts.disableLocalWorkspaceTools,
    });
    // Command-policy gate: kind-based like opencode (NOT policy.unattended) —
    // the trusted-human loops carry deniedTools but shouldn't trip the gate.
    const bashGated = isUnattendedKind(baseJournalKind(journal?.kind)) && !isAsk;
    const githubUserLogin =
      !policy.unattended && INTERACTIVE_KINDS.has(baseJournalKind(journal?.kind))
        ? githubUserLoginForRun(user || author?.name)
        : null;

    // Account pick BEFORE any SDK work: a dry pool must fail cheap, and it
    // must fail FLAGGED — this engine has no host-auth fallthrough, so "no
    // account can serve this model" is always exhaustion-shaped, which is what
    // agent-runner's fallback walk keys on.
    const picked = pickDirectAccount(opts, nativeModel, opts.sessionId);
    if ("error" in picked) {
      const err = new Error(`claude-direct: ${picked.error}`) as Error & {
        usageLimitExhausted?: boolean;
      };
      err.usageLimitExhausted = true;
      throw err;
    }
    account = picked.account;

    audit({
      ...auditBase,
      direction: "in",
      account: account.name,
      ...(policy.unattended
        ? { denied_tools: policy.noteGroups.flatMap((grp) => grp.tools) }
        : {}),
      ...summarizeText(prompt),
    });

    // Isolated per-account SDK config dir — the containment this engine hangs
    // on: the subprocess can never fall back to host ~/.claude credentials.
    const configDir = `${CLAUDE_DIRECT_STATE_DIR}/cfg/${account.id}`;
    try {
      mkdirSync(configDir, { recursive: true });
    } catch {}

    // Resume pre-flight: when the chosen account's config dir has no such
    // conversation (rotation before the affinity pick existed, a pin to a
    // different account, pruned state), start FRESH with a handoff note
    // instead of letting the SDK kill the turn with "No conversation found".
    let resumeId = opts.sessionId;
    let resumeMissNote: string | null = null;
    if (resumeId && !conversationOnAccount(account.id, resumeId)) {
      audit({ ...auditBase, direction: "in", kind: "resume_miss", account: account.name });
      resumeMissNote =
        "Note: your previous engine session for this conversation could not be resumed, " +
        "so this turn starts fresh. Earlier messages are not in your context; the person " +
        "can still see them in the transcript. Ask for anything essential you are missing.";
      resumeId = undefined;
    }

    // Minimal subprocess env. The server env is NEVER inherited; every entry
    // is explicit.
    const awsEnv = opts.aws ? await ensureAgentAwsCredsFile() : {};
    const childEnv: Record<string, string | undefined> = {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      LANG: process.env.LANG,
      ...gitIdentityEnv(author),
      ...(githubUserLogin ? githubAuthEnv(user || author?.name) : {}),
      ...awsEnv,
      CLAUDE_CODE_OAUTH_TOKEN: account.token,
      CLAUDE_CONFIG_DIR: configDir,
    };

    // The repo owning this run's cwd, or undefined for a repo-less one.
    // Dynamic import to avoid a static module-init cycle through "./worktree".
    const cwdRepo = await (async () => {
      try {
        return (await import("../worktree")).repoForPathOrNull(cwd);
      } catch {
        return undefined;
      }
    })();
    const instructions = buildRunInstructions({
      isAsk,
      isScratch,
      isRepoLess: !cwdRepo,
      reposNote: opts.reposNote,
      prReviewer: opts.prReviewer,
      repoHost: isScratch ? undefined : cwdRepo?.host,
      localInstructions: readLocalInstructions(cwd),
      inProcessMcp: opts.inProcessMcp,
      osSessionId: journal?.osSessionId,
      user,
      author,
      githubUserLogin,
      deniedToolNotes: policy.noteGroups,
      commandPolicyGated: bashGated,
      ...(dial
        ? {
            dialOracle: {
              agent: dial.oracleAgent,
              presetLabel: dial.label,
              mainLabel: nativeModel,
              oracleLabel: claudeDirectOracleLabel(dial.oracleAgent),
            },
          }
        : {}),
      // Worker names are stable across engines; only the backing model label
      // varies (claudeDirectOrchestratorWorkers keeps this in step with the
      // agents actually registered on the query below).
      ...(orch
        ? {
            orchestrator: {
              presetLabel: orch.label,
              mainLabel: nativeModel,
              workers: claudeDirectOrchestratorWorkers(orch),
            },
          }
        : {}),
    });

    // MCP: external servers through the shared resolver (per-run allowlist,
    // allowedUsers, OAuth relay), in-process opensession-* servers ONLY from
    // what the caller passed — never synthesized here.
    const mcpConfig = {
      ...buildClaudeDirectMcpServers(mcpServers, user, [opts.mcpGrantUser, user]),
      ...claudeDirectInProcessServers(opts.inProcessMcp),
    };

    // Per-call deny wording, keyed by tool name. noteGroups already merges
    // deniedTools with the confirm-list's "propose it, don't execute it"
    // guidance (and picks the unattended vs interactive phrasing), so a tool
    // that slips the strip-set is refused with the same words the run's
    // instructions used, not a generic line.
    const denyMessages: Record<string, string> = {};
    for (const group of policy.noteGroups) {
      for (const name of group.tools) denyMessages[name] = group.message;
    }

    const effortConfig = claudeDirectEffortConfig(resolvedModel.effort ?? opts.effort);
    const disallowedTools = claudeDirectDisallowedTools({
      deniedTools: opts.deniedTools,
      confirmTools,
      disableLocalWorkspaceTools: opts.disableLocalWorkspaceTools,
    });

    // ── Streaming input (the steer channel) ────────────────────────────────
    //
    // Steered messages are released into the query only at a TURN BOUNDARY (a
    // result message): stream-json user input delivered mid-turn is consumed
    // but never starts a turn, which hangs the run. Each release starts
    // exactly one more turn in the same query, so the end-of-run rule stays
    // simple — finish on a result with nothing held.
    const steerPending: Array<{ text: string; images?: ImageInput[] }> = [];
    let steerWake: (() => void) | null = null;
    let steerReleases = 0;
    let inputDone = false;
    const releaseSteers = () => {
      steerReleases++;
      steerWake?.();
    };
    // The transcript user line for a steer is written at DELIVERY, not at
    // accept: session.steer resolving proves only that we queued it, and an
    // optimistically-persisted line would mark an undelivered steer as said
    // (queue-state reconciles receipts against transcript user texts, so it
    // would never be requeued). An undelivered steer keeps its run-session
    // receipt as the recovery affordance.
    const deliveredSteer = (text: string, images?: ImageInput[]) => {
      audit({ ...auditBase, direction: "in", kind: "steer_injected", ...summarizeText(text) });
      if (!engineSessionId) return;
      try {
        appendOpencodeTranscript(engineSessionId, [
          transcriptLineUser(text, undefined, undefined, images),
        ]);
      } catch (e) {
        console.warn("[claude-direct] steer transcript write failed:", e);
      }
    };
    handle.steer = (text, images) => {
      steerPending.push({ text, images });
      audit({ ...auditBase, direction: "in", kind: "steer_queued", ...summarizeText(text) });
    };
    const inputStream = (async function* (): AsyncGenerator<SDKUserMessage> {
      yield userMessage(resumeMissNote ? `${resumeMissNote}\n\n${prompt}` : prompt, opts.images);
      for (;;) {
        if (inputDone) return;
        if (steerReleases > 0) {
          steerReleases--;
          const batch = steerPending.splice(0);
          if (batch.length) {
            const text = batch.map((b) => b.text).filter(Boolean).join("\n\n");
            const images = batch.flatMap((b) => b.images ?? []);
            deliveredSteer(text, images.length ? images : undefined);
            yield userMessage(text, images.length ? images : undefined);
          }
          continue;
        }
        await new Promise<void>((resolve) => (steerWake = resolve));
        steerWake = null;
      }
    })();

    const q = query({
      prompt: inputStream,
      options: {
        cwd,
        model: nativeModel,
        resume: resumeId,
        forkSession: opts.forkSession,
        ...(opts.resumeSessionAt ? { resumeSessionAt: opts.resumeSessionAt } : {}),
        abortController: abort,
        // Never read host/project Claude settings: this engine's whole
        // containment story is that the subprocess sees only what we hand it.
        settingSources: [],
        systemPrompt: instructions
          ? { type: "preset", preset: "claude_code", append: instructions }
          : { type: "preset", preset: "claude_code" },
        tools: claudeDirectBuiltinTools({
          mode,
          disableLocalWorkspaceTools: opts.disableLocalWorkspaceTools,
        }),
        ...(disallowedTools.length ? { disallowedTools } : {}),
        // The Dial's read-only oracle subagents and the Orchestrator's
        // workers; native Task/subagents keep working either way. Registered
        // on every run (a stable set), while only a preset run is told they
        // exist through the instructions above.
        agents: claudeDirectAgents({
          mode,
          disableLocalWorkspaceTools: opts.disableLocalWorkspaceTools,
        }) as any,
        mcpServers: mcpConfig,
        strictMcpConfig: true,
        pathToClaudeCodeExecutable: CLAUDE_CODE_BIN,
        executable: "bun" as const,
        env: childEnv,
        ...effortConfig,
        canUseTool: async (toolName, input) => {
          const decision = claudeDirectToolDecision(toolName, input, {
            mode,
            denyMessages,
            disables: policy.disables,
          });
          if (decision?.behavior === "deny") {
            audit({
              ...auditBase,
              direction: "out",
              kind: "permission_decision",
              tool_name: toolName,
              decision: "deny",
              reason: decision.reason,
            });
            return { behavior: "deny", message: decision.message };
          }
          if (toolName === "AskUserQuestion") {
            // The blocking permission-ask contract: park the turn on the
            // caller's handler (web UI card + Slack escalation). Without a
            // handler (automations, smoke runs) deny rather than letting the
            // SDK run an interactive tool nobody can answer.
            if (!opts.onAskUser) {
              return {
                behavior: "deny",
                message:
                  "This run is headless — nobody can answer questions. Use your best judgment, " +
                  "and note the open question and your assumption in your final output.",
              };
            }
            try {
              return await opts.onAskUser(input);
            } catch (e: any) {
              return {
                behavior: "deny",
                message: `Question UI failed (${e?.message || e}) — decide yourself and note the assumption.`,
              };
            }
          }
          if (bashGated && toolName === "Bash") {
            // Unattended code-mode bash is screened per command through the
            // org command policy, the same gate the opencode engine applies to
            // its permission asks.
            const command = String((input as { command?: unknown })?.command ?? "");
            const reply = bashAskPolicyReply(
              { permission: "bash", metadata: { command } },
              {
                unattended: policy.unattended,
                gated: true,
                sessionId: journal?.osSessionId,
                runKind: journal?.kind,
              }
            );
            if (reply === "reject") {
              return {
                behavior: "deny",
                message:
                  "This command is blocked by the organization command policy for unattended runs. " +
                  "Describe what you wanted to run and why in your output instead of retrying.",
              };
            }
          }
          return { behavior: "allow", updatedInput: input };
        },
      },
    });

    // Cancellation: interrupt() asks the SDK to stop the current turn; the
    // AbortController is already wired into the query for the hard stop.
    const onAbort = () => {
      inputDone = true;
      releaseSteers();
      void Promise.resolve(q.interrupt?.()).catch(() => {});
    };
    if (abort.signal.aborted) onAbort();
    else abort.signal.addEventListener("abort", onAbort, { once: true });

    let sawInit = false;
    let sawUsage = false;
    let usageTotal: TurnUsage = emptyTurnUsage();
    let terminal: StreamEvent | null = null;
    let lastText = "";

    for await (const msg of q) {
      if (abort.signal.aborted) break;
      const m = msg as Record<string, any>;

      if (m.type === "system" && m.subtype === "init") {
        if (sawInit) continue; // a rotation/fork re-inits; one init event only
        engineSessionId = String(m.session_id || engineSessionId || "");
        sawInit = true;
        if (engineSessionId) {
          if (!registeredKeys.has(engineSessionId)) {
            registeredKeys.add(engineSessionId);
            activeRuns.set(engineSessionId, handle);
          }
          // Map SDK→unified BEFORE any engine-keyed append: the store write
          // resolves the unified session through this map and runs the
          // import-first gate. Without it the first live append would mark the
          // session 'live-only' and orphan its legacy history.
          if (unifiedSessionId) recordBksSessionFor(engineSessionId, unifiedSessionId);
          // Journal upgrade: the record now carries the engine id (still no
          // serverKey — boot must take the continuation re-prompt path).
          if (journal?.osSessionId) journalSet(journalRecord(engineSessionId));
          // Engine-keyed write of the turn's user line — same uuid as the
          // early store write, so the row upserts instead of duplicating.
          try {
            appendOpencodeTranscript(engineSessionId, [userLine]);
          } catch (e) {
            console.warn("[claude-direct] user-line append failed:", e);
          }
          if (resumeMissNote) {
            try {
              appendOpencodeTranscript(engineSessionId, [
                transcriptLineRunnerNotice(
                  "Previous engine session could not be resumed; this turn started fresh without in-engine context.",
                ),
              ]);
            } catch {}
          }
        }
        yield {
          type: "init",
          sessionId: engineSessionId,
          provider: PROVIDER,
          model: nativeModel,
        };
        continue;
      }

      if (m.type === "assistant") {
        const blocks = m.message?.content;
        const msgTs = nowIso();
        const msgUuid: string = String(m.uuid || crypto.randomUUID());
        if (Array.isArray(blocks)) {
          let textIdx = 0;
          for (const b of blocks) {
            if (!b || typeof b !== "object") continue;
            if (b.type === "text" && b.text) {
              lastText = String(b.text);
              yield { type: "text_chunk", text: b.text };
              persistEntries(engineSessionId, [
                {
                  id: textIdx === 0 ? msgUuid : `${msgUuid}-b${textIdx}`,
                  type: "assistant",
                  content: b.text,
                  timestamp: msgTs,
                  model: nativeModel,
                },
              ]);
              textIdx++;
            } else if (b.type === "tool_use" && b.id) {
              yield {
                type: "tool_use",
                toolName: String(b.name || "Tool"),
                toolInput: b.input ?? {},
                toolUseId: String(b.id),
              };
              persistEntries(engineSessionId, [
                {
                  id: String(b.id),
                  type: "tool_use",
                  content: "",
                  timestamp: msgTs,
                  toolName: String(b.name || "Tool"),
                  toolInput: b.input ?? {},
                  toolUseId: String(b.id),
                },
              ]);
            }
          }
        }
        continue;
      }

      if (m.type === "user") {
        // SDK-executed tool results ride user messages.
        const blocks = m.message?.content;
        if (Array.isArray(blocks)) {
          for (const b of blocks) {
            if (!b || typeof b !== "object" || b.type !== "tool_result" || !b.tool_use_id)
              continue;
            const text = toolResultText(b.content);
            const isError = b.is_error === true;
            yield {
              type: "tool_result",
              toolUseId: String(b.tool_use_id),
              result: text,
              content: text,
            };
            persistEntries(engineSessionId, [
              {
                id: `${b.tool_use_id}-result`,
                type: "tool_result",
                content: text,
                timestamp: nowIso(),
                toolUseId: String(b.tool_use_id),
                ...(isError ? { isError: true } : {}),
              },
            ]);
          }
        }
        continue;
      }

      if (m.type === "result") {
        if (m.session_id) engineSessionId = String(m.session_id);
        // Usage accumulates across EVERY result message: a steered run has one
        // per turn, and reading only the last under-reports the whole run.
        usageTotal = addResultUsage(usageTotal, m);
        sawUsage = true;

        if (m.is_error || m.subtype !== "success") {
          const detail: string =
            (typeof m.result === "string" && m.result) ||
            (Array.isArray(m.errors) && m.errors.join(", ")) ||
            String(m.subtype || "SDK run failed");
          const usageLimit = isClaudeUsageLimitError(detail, true);
          if (usageLimit && account) markExhausted(account.id, nativeModel);
          handle.steer = undefined;
          inputDone = true;
          releaseSteers();
          terminal = {
            type: "error",
            content: `claude-direct: ${detail}`,
            provider: PROVIDER,
            model: nativeModel,
            ...(usageLimit ? { usageLimitExhausted: true } : {}),
          };
          break;
        }

        // A successful CLI result can still BE a usage-limit notice.
        if (isClaudeUsageLimitError(String(m.result || ""), false)) {
          if (account) markExhausted(account.id, nativeModel);
          handle.steer = undefined;
          inputDone = true;
          releaseSteers();
          terminal = {
            type: "error",
            content: `claude-direct: ${String(m.result)}`,
            provider: PROVIDER,
            model: nativeModel,
            usageLimitExhausted: true,
          };
          break;
        }

        if (steerPending.length) {
          // More to say: release the held steer, keep the query alive.
          releaseSteers();
          yield { type: "usage_snapshot", usage: { ...usageTotal } };
          continue;
        }

        // Finish. Stop accepting steers in the SAME tick as the decision, so a
        // steer arriving now returns false and run-session queues it for the
        // next turn instead of losing it in the closing window.
        handle.steer = undefined;
        inputDone = true;
        releaseSteers();
        terminal = {
          type: "done",
          sessionId: engineSessionId,
          result: (typeof m.result === "string" && m.result) || lastText || undefined,
          provider: PROVIDER,
          model: nativeModel,
          ...(sawUsage ? { usage: { ...usageTotal } } : {}),
        };
        break;
      }
      // Every other SDK message kind (status, hooks, task notifications,
      // partials) is engine-internal.
    }

    handle.steer = undefined;
    inputDone = true;
    releaseSteers();

    if (abort.signal.aborted) {
      // A user cancel ends QUIETLY — no terminal event, the generator just
      // returns. A terminal error here would take run-session's full failure
      // path: a persisted "Run failed" chip, lastRunError/Needs-input state,
      // and a parent notified that a worker a human deliberately stopped
      // FAILED. The finally records the cancelled audit closer.
      reachedTerminal = true;
      return;
    }

    if (!terminal) {
      terminal = {
        type: "error",
        content: "claude-direct: SDK stream ended without a result message",
        provider: PROVIDER,
        model: nativeModel,
      };
    }
    reachedTerminal = true;
    endTurn({
      ok: terminal.type === "done",
      account: account?.name,
      sdk_session_id: engineSessionId,
      saw_init: sawInit,
      ...(terminal.type === "done"
        ? {
            input_tokens: usageTotal.inputTokens,
            output_tokens: usageTotal.outputTokens,
            cache_read_input_tokens: usageTotal.cacheReadTokens,
            total_cost_usd: usageTotal.costUsd,
          }
        : { error: terminal.content }),
    });
    yield terminal;
  } catch (e: any) {
    if (abort.signal.aborted) {
      // A cancel that surfaced as a throw is still a user cancel — same quiet
      // end as the terminal branch above.
      reachedTerminal = true;
      return;
    }
    const message: string = e?.message || String(e);
    // Honor the flag on pre-init throws (dry pool): their distinctive text
    // never matches the classifier.
    const usageLimit =
      e?.usageLimitExhausted === true || isClaudeUsageLimitError(message, true);
    // Sideline ONLY on provider-attributed exhaustion. This catch also sees
    // non-provider throws (fs, journal, SDK init), and a stray shape in one of
    // those must not sideline a healthy account for the next hour.
    if (usageLimit && account && e?.usageLimitExhausted !== true) {
      markExhausted(account.id, nativeModel);
    }
    reachedTerminal = true;
    endTurn({ ok: false, account: account?.name, sdk_session_id: engineSessionId, error: message });
    yield {
      type: "error",
      content: message.startsWith("claude-direct:") ? message : `claude-direct: ${message}`,
      provider: PROVIDER,
      model: nativeModel,
      ...(usageLimit ? { usageLimitExhausted: true } : {}),
    };
  } finally {
    endTurn({
      ok: false,
      sdk_session_id: engineSessionId,
      status: abort.signal.aborted ? "cancelled" : "abandoned",
    });
    handle.steer = undefined;
    // Consumer teardown without a terminal (hot-reload chaos, shutdown):
    // nothing survives a restart, so stop the orphaned in-process turn rather
    // than letting it burn tokens with no consumer.
    if (!reachedTerminal && !abort.signal.aborted) abort.abort();
    for (const key of registeredKeys) {
      if (activeRuns.get(key) === handle) activeRuns.delete(key);
    }
    // The journal survives ONLY a mid-turn teardown (boot's continuation
    // re-prompt); a reached terminal or a user cancel clears it.
    if (journal?.osSessionId && (reachedTerminal || abort.signal.aborted)) {
      journalClear(runKey);
    }
  }
}

// ── Adapter object ───────────────────────────────────────────────────────────

/**
 * The EngineAdapter view of this engine. Dispatch consumes the loose exports
 * above (the shape pi established and agent-runner's fan-outs already call);
 * this object is the same surface in the contract's shape, for callers that
 * want one value per engine.
 *
 * `reattach` is null and `activeDetachedRunCount` is 0 BY DESIGN: SDK runs are
 * direct children of this process, so nothing survives a restart and the
 * journal deliberately carries no serverKey — boot takes the continuation
 * re-prompt path instead.
 */
export const claudeDirectAdapter: EngineAdapter = {
  name: "claude-direct",
  startTurn: runClaudeDirect,
  steer: steerClaudeDirectRun,
  cancel: cancelClaudeDirectRun,
  isBusy: isClaudeDirectBusy,
  async reattach(
    _run: ActiveRunRecord,
    _handlers?: { onAskUser?: EngineAskHandler }
  ): Promise<AsyncIterable<StreamEvent> | null> {
    return null;
  },
  activeDetachedRunCount: () => 0,
};

// ── Scripted smoke harness ───────────────────────────────────────────────────

/** The model the smoke turn runs on — cheap, and pool coverage is widest. */
const SMOKE_MODEL = "claude/anthropic/claude-sonnet-5";

export interface ClaudeDirectSmokeOptions {
  /** Prompt for the scripted turn (default: a one-word reply probe). */
  prompt?: string;
  /** Wiring probe: never execute a turn even when the engine is on — no
   *  account pick, no SDK spawn. (With the engine OFF every call is already a
   *  dry run: runClaudeDirect stops at its config gate.) */
  dryRun?: boolean;
  /** Wall-time cap for the turn (default 120s, clamped 5s–10min). On expiry
   *  the run is cancelled via the normal abort path, which ends the turn
   *  quietly — an abort is not a usage-limit shape, so the account is never
   *  markExhausted'd. */
  timeoutMs?: number;
  /** Model override so an operator can probe a specific model. A provided id
   *  that doesn't resolve is an explicit error, never a silent fallback. */
  model?: string;
}

export interface ClaudeDirectSmokeResult {
  /** True only for a real turn that reached its terminal `done` in time — or
   *  for an explicit dryRun probe with the engine enabled. */
  ok: boolean;
  enabled: boolean;
  /** True when no real turn was executed (engine off, or dryRun requested). */
  dryRun: boolean;
  /** Human-readable explanation whenever ok is false or no turn ran. */
  reason?: string;
  /** Throwaway unified session id (`os-test-claude-direct-*`) — it never gets
   *  a session file, so it can't appear in the UI session list. */
  sessionId: string;
  engineSessionId?: string;
  model: string;
  eventTypes: string[];
  text: string;
  error?: string;
  usage?: TurnUsage;
  timedOut: boolean;
  durationMs: number;
  /** transcript_events rows the store holds for the throwaway session after
   *  the turn — proves the store-write path end to end; 0 on dry runs. */
  storeRows: number;
}

/**
 * One tiny scripted turn against a throwaway session id
 * (`os-test-claude-direct-*`), for post-restart verification. With the engine
 * disabled this is a pure dry run: runClaudeDirect yields its config-gate
 * error before touching accounts or the SDK, so no quota is ever consumed. The
 * private `claude-direct-smoke` journal kind passes the run gate only while
 * the module-scoped bypass is armed here. Never throws; a real turn is
 * hard-capped at `timeoutMs` wall time.
 */
export async function runClaudeDirectSmokeTurn(
  opts: ClaudeDirectSmokeOptions = {}
): Promise<ClaudeDirectSmokeResult> {
  const prompt = opts.prompt || "Reply with exactly the single word: ok";
  const timeoutMs = Math.max(5_000, Math.min(opts.timeoutMs ?? 120_000, 600_000));
  const enabled = claudeDirectEnabled();
  const started = Date.now();

  if (opts.model && "error" in resolveClaudeDirectModel(opts.model)) {
    return {
      ok: false,
      enabled,
      dryRun: !!opts.dryRun,
      reason: `not a model the claude engine can run: ${opts.model}`,
      sessionId: "",
      model: opts.model,
      eventTypes: [],
      text: "",
      timedOut: false,
      durationMs: Date.now() - started,
      storeRows: 0,
    };
  }
  const smokeModel = opts.model || SMOKE_MODEL;
  const sessionId = `os-test-claude-direct-${Date.now().toString(36)}`;
  const storeRowsFor = (id: string): number => {
    try {
      return transcriptStore().getLastSeq(id);
    } catch {
      return 0;
    }
  };

  if (enabled && opts.dryRun) {
    return {
      ok: true,
      enabled,
      dryRun: true,
      reason:
        "dry run requested — the engine is enabled but no turn was executed (no account pick, no SDK spawn)",
      sessionId,
      model: smokeModel,
      eventTypes: [],
      text: "",
      timedOut: false,
      durationMs: Date.now() - started,
      storeRows: 0,
    };
  }

  const cwd = `${CLAUDE_DIRECT_STATE_DIR}/smoke`;
  if (enabled) {
    try {
      mkdirSync(cwd, { recursive: true });
    } catch {}
  }
  const eventTypes: string[] = [];
  let text = "";
  let error: string | undefined;
  let usage: TurnUsage | undefined;
  let engineSessionId: string | undefined;
  let done = false;
  let timedOut = false;
  // Wall clamp: runClaudeDirect registers the run under the unified session id
  // before the SDK spawns, so cancelClaudeDirectRun reaches it. A cancel ends
  // the turn quietly, so `done` stays false and `timedOut` is the signal.
  const timer = setTimeout(() => {
    timedOut = true;
    cancelClaudeDirectRun(sessionId);
  }, timeoutMs);
  smokeGateBypass++;
  try {
    for await (const ev of runClaudeDirect(
      {
        prompt,
        cwd,
        mode: "ask",
        // Smoke probe: no connectors needed to prove the engine answers.
        mcpServers: [],
        journal: { osSessionId: sessionId, kind: SMOKE_KIND },
      },
      smokeModel
    )) {
      eventTypes.push(ev.type);
      if (ev.type === "init") engineSessionId = ev.sessionId;
      if (ev.type === "text_chunk") text += ev.text || "";
      if (ev.type === "error") error = ev.content;
      if (ev.type === "done") {
        usage = ev.usage;
        done = true;
      }
    }
  } catch (e) {
    // runClaudeDirect yields errors rather than throwing; belt-and-braces so
    // the in-process caller (admin route) can never blow up off this path.
    error = String((e as Error)?.message || e);
  } finally {
    smokeGateBypass--;
    clearTimeout(timer);
  }
  return {
    ok: done && !timedOut && !error,
    enabled,
    dryRun: !enabled,
    reason: !enabled
      ? "the claude engine is disabled (~/.opensession-engines.json) — the gate error below is the expected dry-run result; no account or SDK use happened"
      : timedOut
        ? `smoke turn exceeded the ${timeoutMs}ms wall cap and was cancelled`
        : undefined,
    sessionId,
    engineSessionId,
    model: smokeModel,
    eventTypes,
    text,
    error,
    usage,
    timedOut,
    durationMs: Date.now() - started,
    // Store rows prove the write path for REAL turns only; the disabled dry
    // path must not open the transcript store at all.
    storeRows: enabled ? storeRowsFor(sessionId) : 0,
  };
}
