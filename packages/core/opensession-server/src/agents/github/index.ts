/**
 * GitHub PR agent: automated review + auto-fix + simplify for the configured repos.
 *
 * Owns the single GitHub webhook route (`POST /github/webhook`): verify the
 * signature, dedup deliveries, and forward events to `handleGithubPrEvent`
 * (webhook.ts). The route lives here, not the Slack agent, so it exists whenever
 * the GitHub agent runs, including a GitHub-only install and the outbound
 * `gh webhook forward` path that targets it. PR-review notifications into Slack
 * are an optional handler the Slack agent registers. This module also owns
 * lifecycle: seeding the disabled review automation, recovering interrupted
 * auto-fix loops on restart, health, and a secret-gated manual trigger.
 */
import { configuredIntegration, defaultRepo, personaName } from "../../server/config";
import type { AgentModule } from "../types";
import {
  MAX_WEBHOOK_BODY_BYTES,
  RequestBodyTooLargeError,
  readRequestTextWithinLimit,
  webhookBodyTooLargeResponse,
} from "../../server/shared/bounded-body";
import { verifyGitHubSignature } from "../../server/shared/signature";
import {
  isGithubDeliveryProcessed,
  markGithubDeliveryProcessed,
  incrementGithubWebhooks,
} from "../slack/state";
import {
  listAutomations,
  createAutomation,
  saveAutomation,
} from "../../server/automations";
import { githubConfigured } from "./github-rest";
import {
  PR_EVENT_KEY,
  REVIEW_AUTOMATION_NAME,
  PR_MERGED_EVENT_KEY,
  DOCS_SYNC_AUTOMATION_NAME,
} from "./constants";
import { DEFAULT_REVIEW_PROMPT } from "./prompts";
import { DEFAULT_GITHUB_FLOW_MCP_SERVERS } from "./run";
import {
  setGithubSessionInvalidate,
  resolveReviewConfig,
  handleGithubPrEvent,
  firePullRequestReview,
} from "./webhook";
import {
  listPrStates,
  activeCodeLoops,
  clearPendingMention,
  clearRecoveryMarker,
  planRecovery,
  recoveryMarkerAt,
  type GithubPrState,
  type RecoveryKind,
} from "./state";
import { feedbackStats } from "./feedback";
import type { PrRef } from "./review";
import { githubWebhookForwardStatus } from "./webhook-forward";

const GITHUB_WEBHOOK_SECRET = process.env.GITHUB_WEBHOOK_SECRET || "";

/** Seed the review automation (disabled) if it doesn't exist yet. Keyed on eventKey. */
function ensureReviewAutomation(): void {
  const existing = listAutomations().find((a) => a.eventKey === PR_EVENT_KEY);
  if (existing) {
    // One-time backfill: this record predates PR flows reading `mcpServers`
    // (githubFlowMcpServers in run.ts). Leaving it unset changes no behavior —
    // unset already resolves to the same default — but the Automations UI
    // renders unset as "all connectors", which would now be a lie. Write the
    // effective list so the settings screen matches what the runs actually get.
    if (existing.mcpServers === undefined) {
      saveAutomation({ ...existing, mcpServers: [...DEFAULT_GITHUB_FLOW_MCP_SERVERS] });
      console.log(
        `[github] Backfilled review automation MCP allowlist: ${DEFAULT_GITHUB_FLOW_MCP_SERVERS.join(", ")}`,
      );
    }
    return;
  }
  const created = createAutomation({
    name: REVIEW_AUTOMATION_NAME,
    prompt: DEFAULT_REVIEW_PROMPT,
    schedule: "",
    mode: "ask",
    createdBy: `${personaName()} (github agent)`,
    eventKey: PR_EVENT_KEY,
    mcpServers: [...DEFAULT_GITHUB_FLOW_MCP_SERVERS],
  });
  if ("error" in created) {
    console.error(`[github] Failed to seed review automation:`, created.error);
    return;
  }
  // Seed it OFF — start label-only; flip on in the Automations UI to review every non-draft PR.
  saveAutomation({ ...created, enabled: false });
  console.log(`[github] Seeded review automation "${REVIEW_AUTOMATION_NAME}" (disabled)`);
}

/**
 * Seed the docs-sync automation if it doesn't exist yet. Keyed on eventKey.
 * Code mode: each merged PR runs a headless session in a fresh worktree that
 * updates the Mintlify docs and opens a PR. Seeded ENABLED — this is the live
 * replacement for the old Mintlify-hosted docs-sync workflow. Toggle it in the
 * Automations UI.
 */
function ensureDocsSyncAutomation(): void {
  const prompt = configuredIntegration("github").docsSyncPrompt;
  if (typeof prompt !== "string" || !prompt.trim()) return;
  const existing = listAutomations().find((a) => a.eventKey === PR_MERGED_EVENT_KEY);
  if (existing) return;
  const created = createAutomation({
    name: DOCS_SYNC_AUTOMATION_NAME,
    prompt: prompt.trim(),
    schedule: "",
    mode: "code",
    repo: defaultRepo().id,
    createdBy: `${personaName()} (github agent)`,
    eventKey: PR_MERGED_EVENT_KEY,
  });
  if ("error" in created) {
    console.error(`[github] Failed to seed docs-sync automation:`, created.error);
    return;
  }
  console.log(`[github] Seeded docs-sync automation "${DOCS_SYNC_AUTOMATION_NAME}" (enabled)`);
}

/** Fire the one recovery `planRecovery` picked for this PR. */
async function fireRecovery(s: GithubPrState, kind: RecoveryKind): Promise<void> {
  switch (kind) {
    case "auto-fix": {
      console.log(`[github] Recovering interrupted auto-fix loop for PR #${s.prNumber}`);
      const { runAutoFix } = await import("./autofix");
      const ref: PrRef = { number: s.prNumber, headRef: s.headRef, headSha: "", title: `PR #${s.prNumber}`, ...(s.ghRepo ? { ghRepo: s.ghRepo } : {}) };
      void runAutoFix(ref, s.autoFix?.requestedBy || "", undefined, /*resuming*/ true, s.autoFix?.steer).catch((e) =>
        console.error(`[github] auto-fix recovery failed for PR #${s.prNumber}:`, e),
      );
      return;
    }
    case "run": {
      const run = s.activeRun!;
      console.log(`[github] Recovering interrupted ${run.kind} for PR #${s.prNumber}`);
      const { triggerPrAction } = await import("./trigger");
      void triggerPrAction(run.kind, s.prNumber, run.requestedBy, run.steer, s.ghRepo).catch((e) =>
        console.error(`[github] ${run.kind} recovery failed for PR #${s.prNumber}:`, e),
      );
      return;
    }
    case "mention": {
      const m = s.activeMention!;
      console.log(`[github] Recovering interrupted mention for PR #${s.prNumber}`);
      const { runConversationalMention } = await import("./mention");
      void runConversationalMention(
        { prNumber: s.prNumber, author: m.author, body: m.body, kind: m.kind, replyToId: m.replyToId, inline: m.inline, ghRepo: s.ghRepo },
        /*recovering*/ true,
      ).catch((e) => console.error(`[github] mention recovery failed for PR #${s.prNumber}:`, e));
      return;
    }
    case "pending-mention": {
      const p = s.pendingMention!;
      console.log(`[github] Recovering dropped mention for PR #${s.prNumber} (from @${p.author})`);
      const { dispatchMention } = await import("./mention");
      void dispatchMention({
        prNumber: s.prNumber,
        kind: p.kind,
        body: p.body,
        author: p.author,
        replyToId: p.replyToId,
        inline: p.inline,
        ghRepo: s.ghRepo,
      })
        .catch((e) => console.error(`[github] dropped-mention recovery failed for PR #${s.prNumber}:`, e))
        .finally(() => clearPendingMention(s.prNumber, s.ghRepo));
      return;
    }
  }
}

/**
 * Re-enter the work a restart interrupted: auto-fix loops, one-shot actions
 * (review/simplify/adversarial), conversational @mentions, and mentions that
 * were received but dropped before their run could self-persist — the classic
 * case being a webhook that landed during shutdown drain (acked 200, so GitHub
 * won't redeliver).
 *
 * ONE pass over the state files, at most one run fired per PR. These markers
 * legitimately coexist — auto-fix arms `autoFix.active` and its gate review arms
 * `activeRun` — so per-marker sweeps used to fire two runs for the same PR after
 * every restart. planRecovery picks the outermost live marker; the nested ones
 * belong to runs the resumed one starts again itself.
 */
async function recoverInterrupted(): Promise<void> {
  for (const s of listPrStates()) {
    const { fire, stale } = planRecovery(s);
    for (const kind of stale) {
      const label = kind === "run" ? s.activeRun?.kind || "run" : kind;
      console.log(
        `[github] Clearing stale ${label} recovery flag for PR #${s.prNumber} (from ${recoveryMarkerAt(s, kind) || "unknown"})`,
      );
      clearRecoveryMarker(s, kind);
    }
    if (!fire) continue;
    // The fired run owns the PR; its mention receipt is bookkeeping it supersedes.
    if (fire !== "pending-mention" && s.pendingMention) clearPendingMention(s.prNumber, s.ghRepo);
    await fireRecovery(s, fire);
  }
}

export class GithubAgent implements AgentModule {
  name = "github";
  private readonly onSessionInvalidate?: () => void;

  constructor(opts?: { onSessionInvalidate?: () => void }) {
    this.onSessionInvalidate = opts?.onSessionInvalidate;
  }

  getRoutes(): Map<string, (req: Request, url: URL) => Promise<Response>> {
    const routes = new Map<string, (req: Request, url: URL) => Promise<Response>>();

    // Manual trigger for testing: POST /github-pr/<secret> { prNumber, headRef, headSha?, behavior, requestedBy? }
    routes.set("POST /github-pr/*", async (req, url) => {
      const m = url.pathname.match(/^\/github-pr\/([^/]+)$/);
      if (!m || !GITHUB_WEBHOOK_SECRET || m[1] !== GITHUB_WEBHOOK_SECRET) {
        return Response.json({ error: "Not found" }, { status: 404 });
      }
      let body: any = {};
      try {
        body = JSON.parse(await readRequestTextWithinLimit(req, 64 * 1024));
      } catch (error) {
        if (error instanceof RequestBodyTooLargeError) return webhookBodyTooLargeResponse(64 * 1024);
      }
      const prNumber = Number(body?.prNumber);
      const headRef = String(body?.headRef || "").trim();
      const behavior = String(body?.behavior || "review");
      if (!prNumber || !headRef) return Response.json({ error: "prNumber and headRef required" }, { status: 400 });
      const manualGhRepo = typeof body?.ghRepo === "string" && body.ghRepo.trim() ? body.ghRepo.trim() : undefined;
      const ref: PrRef = { number: prNumber, headRef, headSha: String(body?.headSha || ""), title: `PR #${prNumber}`, ...(manualGhRepo ? { ghRepo: manualGhRepo } : {}) };
      const requestedBy = String(body?.requestedBy || "");

      if (behavior === "autofix") {
        const { runAutoFix } = await import("./autofix");
        void runAutoFix(ref, requestedBy, this.onSessionInvalidate);
      } else if (behavior === "simplify") {
        const { runSimplify } = await import("./simplify");
        void runSimplify(ref, requestedBy, this.onSessionInvalidate);
      } else {
        const { runReview } = await import("./review");
        void runReview(ref, resolveReviewConfig().config, this.onSessionInvalidate);
      }
      return Response.json({ ok: true, behavior, prNumber });
    });

    // The single GitHub webhook. Owned here (not the Slack agent) so it exists
    // whenever the GitHub agent runs, including a GitHub-only install and the
    // outbound `gh webhook forward` path — both of which target this route.
    routes.set("POST /github/webhook", async (req) => {
      let body: string;
      try {
        body = await readRequestTextWithinLimit(req, MAX_WEBHOOK_BODY_BYTES);
      } catch (error) {
        if (error instanceof RequestBodyTooLargeError)
          return webhookBodyTooLargeResponse(MAX_WEBHOOK_BODY_BYTES);
        throw error;
      }
      const signature = req.headers.get("x-hub-signature-256") || "";
      if (!verifyGitHubSignature(body, signature, GITHUB_WEBHOOK_SECRET)) {
        console.error("[github] Invalid GitHub webhook signature");
        return Response.json({ error: "Invalid signature" }, { status: 401 });
      }
      // Reject replayed/redelivered webhooks by delivery id.
      const deliveryId = req.headers.get("x-github-delivery");
      if (deliveryId) {
        if (isGithubDeliveryProcessed(deliveryId))
          return Response.json({ ok: true, duplicate: true });
        markGithubDeliveryProcessed(deliveryId);
      }
      incrementGithubWebhooks();
      const event = req.headers.get("x-github-event") || "";
      const payload = JSON.parse(body);
      console.log(`[github] webhook: event=${event}, action=${payload.action}`);
      // Slack-specific PR-review notifications, only when that agent registered one.
      if (event === "pull_request_review") firePullRequestReview(payload);
      // Server-side PR cache sync + open-tab nudges (filters to PR events itself).
      import("../../server/pr-webhook")
        .then((m) => m.handlePrWebhookEvent(event, payload))
        .catch((e) => console.error("[github] pr-webhook dispatch failed:", e));
      // Review / auto-fix / simplify / @mention / merge notifications.
      if (
        event === "pull_request" ||
        event === "issue_comment" ||
        event === "pull_request_review_comment" ||
        event === "workflow_run"
      ) {
        void handleGithubPrEvent(event, payload);
      }
      return Response.json({ ok: true });
    });

    return routes;
  }

  async startup(): Promise<void> {
    if (!githubConfigured()) {
      console.warn("[github] GITHUB_API_TOKEN unset — review/fix/simplify can't post; agent idle");
    }
    if (!GITHUB_WEBHOOK_SECRET) {
      console.warn("[github] GITHUB_WEBHOOK_SECRET unset — PR webhooks won't be verified/forwarded");
    }
    if (this.onSessionInvalidate) setGithubSessionInvalidate(this.onSessionInvalidate);
    ensureReviewAutomation();
    ensureDocsSyncAutomation();
    await recoverInterrupted();
    // Safety net under all of the above: the webhook path is fire-once, so
    // work lost AFTER an event was consumed (debounce killed by a restart,
    // review dead on dry pools, missed delivery) is re-fired by the sweep.
    const { startReconcileSweep } = await import("./reconcile");
    startReconcileSweep();
    // Outbound webhook delivery for no-exposure installs: gh forwards GitHub
    // deliveries to the loopback /github/webhook over an outbound connection, so
    // no inbound port is opened. Self-gates on the public-URL signal; when a
    // public webhook URL is configured this is a no-op and the inbound HTTP
    // webhook stays authoritative. The reconcile sweep above backstops either.
    const { startGithubWebhookForward } = await import("./webhook-forward");
    void startGithubWebhookForward();
    // Cross-PR learning: periodically re-distill the per-repo learned review
    // rules from the feedback store's outcome signals.
    const { armLearnedRulesDistiller } = await import("./learned-rules");
    armLearnedRulesDistiller();
    const { autoEnabled } = resolveReviewConfig();
    console.log(`[github] Agent started — review automation ${autoEnabled ? "ENABLED (all non-draft PRs)" : "disabled (label-only)"}`);
  }

  async shutdown(): Promise<void> {
    // Auto-fix loop state is persisted to disk after each iteration; nothing to flush.
    const { stopGithubWebhookForward } = await import("./webhook-forward");
    stopGithubWebhookForward();
  }

  health(): Record<string, unknown> {
    const { autoEnabled } = resolveReviewConfig();
    return {
      status: githubConfigured() ? "operational" : "missing GITHUB_API_TOKEN",
      reviewAutomationEnabled: autoEnabled,
      trackedPrs: listPrStates().length,
      activeCodeLoops: activeCodeLoops(),
      reviewFeedback: feedbackStats(),
      webhookForward: githubWebhookForwardStatus(),
    };
  }
}
