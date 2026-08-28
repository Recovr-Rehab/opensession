/**
 * Dispatch target for GitHub PR webhooks. GithubAgent owns
 * `POST /github/webhook` and forwards PR events here for review, auto-fix, and
 * simplify behaviors.
 *
 * Defensive: never throws into the webhook handler; all behaviors are fired
 * fire-and-forget (GitHub's 10s webhook timeout).
 */
import { listAutomations, fireAutomationsForEvent } from "../../server/automations";
import { defaultRepo, isGithubBotLogin } from "../../server/config";
import { isTrustedGithubLogin } from "../../server/shared/user-mappings";
import {
  PR_EVENT_KEY,
  PR_MERGED_EVENT_KEY,
  DOCS_SYNC_BRANCH_PREFIX,
  REVIEW_AUTOMATION_NAME,
  repoForFullName,
  prKey,
  LABEL_REVIEW,
  LABEL_AUTOFIX,
  LABEL_SIMPLIFY,
  LABEL_ADVERSARIAL,
  labelMatches,
} from "./constants";
import { runReview, type PrRef, type ReviewConfig, type ReviewResult } from "./review";
import { clearHandoff, isHandoffActive, maybeHandoffFindings } from "./handoff";
import {
  isLockHeld,
  readPrState,
  updatePrState,
  type GithubPrState,
} from "./state";
import { nextReviewDebounce, reviewDebounceDelay } from "./review-debounce";
import { loadReviewOptions, titleHasSkipKeyword } from "./review-options";
import { DEFAULT_REVIEW_PROMPT } from "./prompts";
import { automaticReviewEventAllowed } from "./public-review";

let onSessionInvalidate: (() => void) | undefined;
export function setGithubSessionInvalidate(cb: () => void): void {
  onSessionInvalidate = cb;
}

// The shared GitHub webhook route fires pull_request_review payloads at a
// handler the Slack agent registers while building its routes. Unset otherwise.
let onPullRequestReview: ((payload: any) => void) | undefined;
export function setGithubPullRequestReviewHandler(
  cb: ((payload: any) => void) | undefined,
): void {
  onPullRequestReview = cb;
}
export function firePullRequestReview(payload: any): void {
  onPullRequestReview?.(payload);
}

const REVIEW_ACTIONS = new Set(["opened", "reopened", "synchronize", "ready_for_review"]);

interface PrPayload {
  number: number;
  html_url?: string;
  draft?: boolean;
  state?: string;
  title?: string;
  head?: { ref?: string; sha?: string; repo?: { full_name?: string } };
  user?: { login?: string };
  labels?: Array<{ name: string }>;
  merged?: boolean;
  merged_at?: string;
  merged_by?: { login?: string };
}

function prRef(pr: PrPayload, ghRepo?: string): PrRef | null {
  if (!pr || typeof pr.number !== "number" || !pr.head?.ref) return null;
  return {
    number: pr.number,
    headRef: pr.head.ref,
    headSha: pr.head.sha || "",
    title: pr.title || `PR #${pr.number}`,
    ...(ghRepo ? { ghRepo } : {}),
  };
}

/** Resolve review config from the seeded automation (its enabled flag + prompt/model). */
export function resolveReviewConfig(): { autoEnabled: boolean; config: ReviewConfig } {
  const automation = listAutomations().find((a) => a.eventKey === PR_EVENT_KEY);
  return {
    autoEnabled: !!automation?.enabled,
    config: {
      prompt: automation?.prompt || DEFAULT_REVIEW_PROMPT,
      model: automation?.model,
    },
  };
}

export async function handleGithubPrEvent(event: string, payload: any): Promise<void> {
  try {
    // Multi-repo: any repo in the config registry participates (the GitHub-side
    // webhook config is the outer gate). Unconfigured repos are dropped.
    const eventRepo = payload?.repository?.full_name
      ? repoForFullName(payload.repository.full_name)
      : null;
    if (payload?.repository?.full_name && !eventRepo) return;
    const ghRepo: string | undefined = eventRepo?.ghRepo;
    const isDefaultRepo = !ghRepo || ghRepo.toLowerCase() === defaultRepo().ghRepo.toLowerCase();

    // Our bot account shows up as `sender` both when we comment/review AND when we
    // push (auto-fix/simplify/mention commits land as a `synchronize`). We must not
    // react to those self-triggers — but we DO want to review PRs the bot *opens*
    // (e.g. automated security fixes). So apply the guard per-event below, not blanket.
    const senderLogin: string = payload?.sender?.login || "";
    const senderIsBot = !!senderLogin && isGithubBotLogin(senderLogin);
    const senderIsTrusted = isTrustedGithubLogin(senderLogin);

    // @mention replies on PR comments (inline + conversation). Never react to our own
    // comments/reviews (mention.ts also re-checks the author + our hidden markers).
    if (event === "issue_comment" || event === "pull_request_review_comment") {
      // Butler's Vercel preview-table edits (from our bot account) carry no
      // mention and need no reaction — the session header's Preview environment button
      // already surfaces the preview URL + Ready state, so we don't inject a
      // redundant session notification. They fall through to the self-trigger guard.
      if (senderIsBot) return;
      const { handleMention } = await import("./mention");
      void handleMention(event === "issue_comment" ? "issue" : "review", payload).catch((e) =>
        console.error("[github] handleMention failed:", e),
      );
      return;
    }

    // Deploy workflow completions → notify sessions waiting on a merged PR's deploy.
    if (event === "workflow_run") {
      const actorLogin: string = payload?.workflow_run?.actor?.login || senderLogin;
      if (!isGithubBotLogin(actorLogin) && !isTrustedGithubLogin(actorLogin)) {
        console.warn(`[github] Ignoring workflow run from untrusted @${actorLogin || "unknown"}`);
        return;
      }
      const { handleDeployWorkflowRun } = await import("./session-notify");
      void handleDeployWorkflowRun(payload).catch((e) =>
        console.error("[github] handleDeployWorkflowRun failed:", e),
      );
      return;
    }

    if (event !== "pull_request") return;

    const pr = payload.pull_request as PrPayload;
    const ref = prRef(pr, ghRepo);
    if (!ref) return;
    const action: string = payload.action || "";
    const baseRepoName = String(payload?.repository?.full_name || ghRepo || "").toLowerCase();
    const headRepoName = String(pr.head?.repo?.full_name || "").toLowerCase();
    const externalFork = !!headRepoName && !!baseRepoName && headRepoName !== baseRepoName;

    // ── Label actions ── (ignore labels we applied to ourselves)
    if (action === "labeled") {
      if (senderIsBot) return;
      if (!senderIsTrusted) {
        console.warn(
          `[github] Ignoring label command on PR #${pr.number} from untrusted @${senderLogin || "unknown"}`,
        );
        return;
      }
      const label: string = payload.label?.name || "";
      const requestedBy: string = payload.sender?.login || "";
      if (labelMatches(label, LABEL_REVIEW)) {
        void fireReview(ref, true);
      } else if (externalFork) {
        console.warn(
          `[github] Ignoring write-capable label ${label || "(unknown)"} on external PR #${pr.number}`,
        );
      } else if (labelMatches(label, LABEL_AUTOFIX)) {
        // A human re-applying the label is a fresh mandate — reset the sweep's
        // per-SHA retry budget so it can babysit this new attempt too.
        updatePrState(pr.number, ref.headRef, (s) => {
          if (s.reconcile) { s.reconcile.autofixAttempts = 0; s.reconcile.autofixSha = undefined; }
          // Dispatch below is intentionally async. Persist the actor first so a
          // shutdown after this webhook is acknowledged cannot make reconcile
          // restart the run under the checkout's fallback git identity.
          s.pendingAutoFix = { requestedBy, receivedAt: new Date().toISOString() };
        }, ghRepo);
        void fireAutoFix(ref, requestedBy);
      } else if (labelMatches(label, LABEL_SIMPLIFY)) {
        void fireSimplify(ref, requestedBy);
      } else if (labelMatches(label, LABEL_ADVERSARIAL)) {
        void fireAdversarial(ref, requestedBy);
      }
      return;
    }

    // Closed (merged or not): a pending debounced review would fire against a
    // dead PR — cancel it, and drop any handoff round tracking.
    if (action === "closed") {
      cancelPendingReview(ref);
      clearHandoff(pr.number, ghRepo);
    }

    // ── Merge → notify linked sessions + fire configured docs-sync ──
    if (action === "closed" && pr.merged) {
      const mergedBy: string = pr.merged_by?.login || senderLogin;
      if (!isGithubBotLogin(mergedBy) && !isTrustedGithubLogin(mergedBy)) {
        console.warn(
          `[github] Ignoring merge automation for PR #${pr.number} by untrusted @${mergedBy || "unknown"}`,
        );
        return;
      }
      // Feedback learning on every configured repo: final outcome sweep for our
      // review comments (open+current at merge = the author ignored them), and
      // — for PRs that look like bug fixes — blame the fixed lines to find
      // reviewed PRs whose bug we missed (reviewer false negatives).
      import("./github-rest")
        .then(async (m) => {
          const threads = await m.listReviewThreads(pr.number, ghRepo);
          const { harvestThreadOutcomes, harvestReplySignals } = await import("./feedback");
          harvestThreadOutcomes(ghRepo, pr.number, threads, /*prClosed*/ true);
          await harvestReplySignals(ghRepo, pr.number, threads);
        })
        .catch((e) => console.warn(`[github] merge feedback sweep failed for #${pr.number}:`, e));
      import("./missed-bugs")
        .then((m) => m.analyzeMergedPrForMissedBugs(payload))
        .catch((e) => console.warn(`[github] missed-bug analysis failed for #${pr.number}:`, e));
      if (!isDefaultRepo) return; // docs-sync/SEO/session-notify are default-repo flows
      import("./session-notify")
        .then((m) => m.notifyMergedPrSessions(payload))
        .catch((e) => console.error("[github] notifyMergedPrSessions failed:", e));
      // Docs-sync: review the merged PR for user-facing changes and update the
      // Mintlify docs. Skip only the docs-sync automation's OWN PRs (they land on
      // `auto-docs-sync-*` branches) so it can never loop on itself. Do NOT skip by
      // author: agent-authored feature PRs may also contain user-facing changes.
      const headRef = pr.head?.ref || "";
      if (headRef.startsWith(DOCS_SYNC_BRANCH_PREFIX)) {
        // A docs-sync PR itself was merged — don't re-fire docs-sync (loop), but
        // tick its Slack announcement done, like Mintlify used to.
        const { markDocsSyncPrMerged } = await import("./docs-sync-notify");
        void markDocsSyncPrMerged(pr.number).catch((e) =>
          console.error(`[github] markDocsSyncPrMerged failed for #${pr.number}:`, e),
        );
      } else {
        const payload = JSON.stringify({
          prNumber: pr.number,
          title: pr.title || `PR #${pr.number}`,
          headRef,
          author: pr.user?.login || "",
        });
        const fired = fireAutomationsForEvent(PR_MERGED_EVENT_KEY, payload);
        if (fired) console.log(`[github] PR #${pr.number} merged → fired ${fired} docs-sync automation(s)`);
      }
      return;
    }

    // ── Open / update actions → review when opted in and non-draft ──
    if (REVIEW_ACTIONS.has(action)) {
      // External fork updates may start only the isolated, read-only public
      // review path. Same-repository events retain the trusted-sender gate.
      if (!automaticReviewEventAllowed({ senderIsBot, senderIsTrusted, externalFork })) {
        console.warn(
          `[github] Ignoring ${action} on PR #${pr.number} from untrusted @${senderLogin || "unknown"}`,
        );
        return;
      }
      if (pr.draft) return; // skip drafts until ready_for_review
      // Opt-out keyword in the title (per-repo .os-review.json; read from the
      // repo's main checkout — no PR worktree exists yet). Label-forced and
      // manual reviews still run; only the automatic path honors it.
      const skipOpts = loadReviewOptions(eventRepo?.repo || defaultRepo().repo);
      if (titleHasSkipKeyword(pr.title || "", skipOpts)) {
        console.log(`[github] PR #${pr.number} title carries a skip keyword — no auto review`);
        return;
      }
      // A `synchronize` from the bot is our own push (auto-fix/simplify/mention) —
      // skip it so we don't review our own work mid-loop. But reviewing a PR the bot
      // *opened* (opened/reopened/ready_for_review) is fine: read-only, no push, no loop.
      // Carve-out: while a handoff fix round is active, a bot-credentialed push IS
      // the owning session's fix (sessions without per-user GitHub auth push as the
      // bot) — it must be re-reviewed or the handoff loop never closes.
      if (senderIsBot && action === "synchronize" && !isHandoffActive(pr.number, ghRepo)) return;
      const labeled = (pr.labels || []).some((l) => labelMatches(l.name, LABEL_REVIEW));
      const { autoEnabled } = resolveReviewConfig();
      if (labeled || autoEnabled) {
        // Pushes debounce (hot PRs got one review per push — #4913: 20 pushes
        // ≈ $131/day of review spend on 2026-07-17); first reviews of a PR
        // stay immediate.
        if (action === "synchronize") scheduleDebouncedReview(ref);
        else void fireReview(ref, false);
      }
    }
  } catch (e) {
    console.error("[github] handleGithubPrEvent error:", e);
  }
}

export async function fireReview(
  ref: PrRef,
  _byLabel: boolean,
): Promise<ReviewResult | null> {
  const { config } = resolveReviewConfig();
  const result = await runReview(ref, config, onSessionInvalidate).catch((e) => {
    console.error(`[github] runReview failed for PR #${ref.number}:`, e);
    return null;
  });
  // Unsatisfied review → hand the findings to the session that owns the branch
  // (its push re-enters this cycle). Satisfied/skipped reviews no-op inside.
  if (!result?.publicReview) await maybeHandoffFindings(ref, result);
  return result;
}

// ── Push → review debounce ───────────────────────────────────────────────────
// Each `synchronize` (re)arms a quiet-period timer per PR, so a burst of pushes
// costs one review while a continuous pusher is still reviewed within the
// max-wait cap. The accepted intent is persisted before the webhook returns;
// only the timer lives in memory. Startup restores that timer, closing the gap
// where a deployment could acknowledge a push and then forget to review it.
const REVIEW_DEBOUNCE_MS = parseInt(process.env.OPENSESSION_REVIEW_DEBOUNCE_MS || "240000");
const REVIEW_DEBOUNCE_MAX_WAIT_MS = parseInt(
  process.env.OPENSESSION_REVIEW_DEBOUNCE_MAX_MS || "900000",
);
const REVIEW_DEBOUNCE_RETRY_MS = 15_000;
const PENDING_REVIEW_MAX_AGE_MS = 24 * 60 * 60 * 1000;

type PendingReview = {
  timer: ReturnType<typeof setTimeout>;
  firstPushAt: number;
};
const pendingReviewDebounce: Map<string, PendingReview> = ((globalThis as any)
  .__githubReviewDebounce ??= new Map());

/** Is a debounced review pending for this PR key? (reconcile.ts probe — a
 *  pending fire means the webhook path owns this PR's next review.) */
export function hasPendingDebouncedReview(key: string): boolean {
  return pendingReviewDebounce.has(key);
}

function persistPendingReview(ref: PrRef, firstPushAt: number, dueAt: number): void {
  updatePrState(
    ref.number,
    ref.headRef,
    (s) => {
      s.pendingReview = {
        headRef: ref.headRef,
        headSha: ref.headSha,
        title: ref.title,
        firstPushAt: new Date(firstPushAt).toISOString(),
        dueAt: new Date(dueAt).toISOString(),
      };
    },
    ref.ghRepo,
  );
}

function clearPersistedPendingReview(ref: PrRef, expectedHeadSha?: string): void {
  const state = readPrState(ref.number, ref.ghRepo);
  if (!state?.pendingReview) return;
  updatePrState(
    ref.number,
    ref.headRef,
    (s) => {
      if (expectedHeadSha && s.pendingReview?.headSha !== expectedHeadSha) return;
      s.pendingReview = undefined;
    },
    ref.ghRepo,
  );
}

function cancelPendingReview(ref: PrRef): void {
  const key = prKey(ref.number, ref.ghRepo);
  const pending = pendingReviewDebounce.get(key);
  if (pending) clearTimeout(pending.timer);
  pendingReviewDebounce.delete(key);
  clearPersistedPendingReview(ref);
}

function armDebouncedReview(ref: PrRef, firstPushAt: number, dueAt: number): void {
  const key = prKey(ref.number, ref.ghRepo);
  const existing = pendingReviewDebounce.get(key);
  if (existing) clearTimeout(existing.timer);

  let pending: PendingReview;
  const timer = setTimeout(() => {
    if (pendingReviewDebounce.get(key) !== pending) return;
    if (isLockHeld("review", ref.number, ref.ghRepo)) {
      armDebouncedReview(ref, firstPushAt, Date.now() + REVIEW_DEBOUNCE_RETRY_MS);
      return;
    }

    console.log(`[github] debounced review firing for PR #${ref.number}`);
    void fireReview(ref, false).then(
      (result) => {
        if (pendingReviewDebounce.get(key) !== pending) return;
        const reviewed = readPrState(ref.number, ref.ghRepo)?.reviewedShas.includes(
          ref.headSha,
        );
        if (!result && !reviewed) {
          armDebouncedReview(ref, firstPushAt, Date.now() + REVIEW_DEBOUNCE_RETRY_MS);
          return;
        }
        pendingReviewDebounce.delete(key);
        clearPersistedPendingReview(ref, ref.headSha);
      },
      (error) => {
        console.error(`[github] debounced review failed for PR #${ref.number}:`, error);
        if (pendingReviewDebounce.get(key) === pending)
          armDebouncedReview(ref, firstPushAt, Date.now() + REVIEW_DEBOUNCE_RETRY_MS);
      },
    );
  }, reviewDebounceDelay(dueAt, Date.now()));

  pending = { timer, firstPushAt };
  pendingReviewDebounce.set(key, pending);
}

function scheduleDebouncedReview(ref: PrRef): void {
  const key = prKey(ref.number, ref.ghRepo);
  const inMemory = pendingReviewDebounce.get(key);
  const persistedFirstPushAt = Date.parse(
    readPrState(ref.number, ref.ghRepo)?.pendingReview?.firstPushAt || "",
  );
  const now = Date.now();
  const firstPushAt =
    inMemory?.firstPushAt ??
    (Number.isFinite(persistedFirstPushAt) ? persistedFirstPushAt : undefined);
  const timing = nextReviewDebounce(
    firstPushAt,
    now,
    REVIEW_DEBOUNCE_MS,
    REVIEW_DEBOUNCE_MAX_WAIT_MS,
  );
  persistPendingReview(ref, timing.firstPushAt, timing.dueAt);
  armDebouncedReview(ref, timing.firstPushAt, timing.dueAt);
}

/** Restore accepted synchronize events without scanning GitHub or depending on
 * the optional fleet-wide reconcile sweep. */
export function restorePendingDebouncedReviews(states: GithubPrState[]): void {
  const now = Date.now();
  for (const state of states) {
    const marker = state.pendingReview;
    if (!marker) continue;
    const ref: PrRef = {
      number: state.prNumber,
      headRef: marker.headRef || state.headRef,
      headSha: marker.headSha,
      title: marker.title || `PR #${state.prNumber}`,
      ...(state.ghRepo ? { ghRepo: state.ghRepo } : {}),
    };
    const firstPushAt = Date.parse(marker.firstPushAt);
    const dueAt = Date.parse(marker.dueAt);
    if (
      !Number.isFinite(firstPushAt) ||
      !Number.isFinite(dueAt) ||
      now - firstPushAt > PENDING_REVIEW_MAX_AGE_MS ||
      state.reviewedShas.includes(marker.headSha)
    ) {
      clearPersistedPendingReview(ref, marker.headSha);
      continue;
    }
    armDebouncedReview(ref, firstPushAt, dueAt);
    console.log(`[github] restored pending review for PR #${state.prNumber}`);
  }
}

export async function fireAutoFix(ref: PrRef, requestedBy: string): Promise<void> {
  const { runAutoFix } = await import("./autofix");
  await runAutoFix(ref, requestedBy, onSessionInvalidate).catch((e) =>
    console.error(`[github] runAutoFix failed for PR #${ref.number}:`, e),
  );
}

async function fireSimplify(ref: PrRef, requestedBy: string): Promise<void> {
  const { runSimplify } = await import("./simplify");
  await runSimplify(ref, requestedBy, onSessionInvalidate).catch((e) =>
    console.error(`[github] runSimplify failed for PR #${ref.number}:`, e),
  );
}

async function fireAdversarial(ref: PrRef, requestedBy: string): Promise<void> {
  const { runAdversarial } = await import("./adversarial");
  await runAdversarial(ref, requestedBy, onSessionInvalidate).catch((e) =>
    console.error(`[github] runAdversarial failed for PR #${ref.number}:`, e),
  );
}
