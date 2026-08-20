/**
 * GitHub webhook delivery with NO exposed inbound port — the outbound analogue
 * of Slack Socket Mode.
 *
 * The `cli/gh-webhook` gh extension (`gh webhook forward`) opens an OUTBOUND
 * connection to GitHub and forwards received webhook deliveries to a local URL.
 * We point it at the loopback webhook server's existing `POST /github/webhook`
 * handler, so the delivery path becomes GitHub → gh (outbound) → the same
 * handler that a public inbound webhook would hit. Real payloads, real time,
 * zero inbound exposure.
 *
 * The forwarded POST is signed with `--secret=<GITHUB_WEBHOOK_SECRET>`, the same
 * secret the handler already verifies, so nothing about the handler changes.
 *
 * Gating mirrors the Slack transport switch: run the forwarder only when there
 * is no public inbound webhook URL (the simple / no-exposure install) or when
 * `GITHUB_WEBHOOK_FORWARD` forces it. When a public URL IS configured, the
 * inbound HTTP webhook stays authoritative and this stays off. Either way the
 * reconcile sweep (`reconcile.ts`) remains the fire-once backstop.
 *
 * Nothing here is armed at import — `startGithubWebhookForward()` is called from
 * the github agent's `startup()` and `stopGithubWebhookForward()` from its
 * `shutdown()`. Reading env/config at import is fine; spawning is not.
 */

import { configuredIntegration, configuredRepos, configuredServer } from "../../server/config";
import { WEBHOOK_FORWARD_EVENTS } from "./constants";

// ── Gating ───────────────────────────────────────────────────

/** A public base URL means a real inbound webhook is reachable; loopback means
 *  the simple / no-exposure case where the outbound forwarder earns its keep. */
export function isPublicUrl(base: string): boolean {
  try {
    const host = new URL(base).hostname.toLowerCase();
    return (
      host !== "127.0.0.1" &&
      host !== "localhost" &&
      host !== "::1" &&
      host !== "0.0.0.0" &&
      host !== ""
    );
  } catch {
    return false;
  }
}

/**
 * Pure gating decision. `GITHUB_WEBHOOK_FORWARD` is an explicit override (only
 * the literal "true" enables, matching the integration enable-flag asymmetry);
 * unset falls back to "forward when there is no public inbound URL".
 */
export function shouldForward(opts: { flag?: string | null; publicBaseUrl: string }): boolean {
  if (opts.flag != null) return opts.flag === "true";
  return !isPublicUrl(opts.publicBaseUrl);
}

export function githubWebhookForwardEnabled(): boolean {
  return shouldForward({
    flag: process.env.GITHUB_WEBHOOK_FORWARD ?? null,
    publicBaseUrl: configuredServer().publicBaseUrl,
  });
}

// ── Targets + command construction ───────────────────────────

/** `gh webhook forward` takes a single scope. One `--org` process covers a
 *  whole org; otherwise one `--repo` process per configured repo. */
export function computeTargets(
  repos: Array<{ ghRepo?: string }>,
  org?: string | null,
): { org?: string; repos: string[] } {
  const orgStr = (org || "").trim();
  if (orgStr) return { org: orgStr, repos: [] };
  const ghRepos = [
    ...new Set(
      repos
        .map((r) => (r.ghRepo || "").trim())
        .filter((r) => r.length > 0),
    ),
  ];
  return { repos: ghRepos };
}

/** The configured forward org, from `integrations.github.webhookForwardOrg` or
 *  `GITHUB_WEBHOOK_FORWARD_ORG`. Empty string when unset. */
export function configuredForwardOrg(): string {
  const cfg = configuredIntegration("github").webhookForwardOrg;
  if (typeof cfg === "string" && cfg.trim()) return cfg.trim();
  return (process.env.GITHUB_WEBHOOK_FORWARD_ORG || "").trim();
}

export function forwardTargets(): { org?: string; repos: string[] } {
  return computeTargets(Object.values(configuredRepos()), configuredForwardOrg());
}

/** The loopback URL of the existing `/github/webhook` handler. */
export function forwardUrl(): string {
  return `http://127.0.0.1:${configuredServer().webhookPort}/github/webhook`;
}

/**
 * Build one `gh webhook forward` argv. Pure — the whole surface (scope, events,
 * url, secret) is derived from its inputs so it can be asserted in tests.
 */
export function buildForwardCommand(opts: {
  repo?: string;
  org?: string;
  events: readonly string[];
  url: string;
  secret?: string;
}): string[] {
  const scope = opts.org ? `--org=${opts.org}` : `--repo=${opts.repo}`;
  const args = [
    "gh",
    "webhook",
    "forward",
    scope,
    `--events=${opts.events.join(",")}`,
    `--url=${opts.url}`,
  ];
  if (opts.secret) args.push(`--secret=${opts.secret}`);
  return args;
}

// ── gh + extension availability ──────────────────────────────

export type GhRunner = (args: string[]) => Promise<{ code: number; stdout: string }>;

const defaultRun: GhRunner = async (args) => {
  const proc = Bun.spawn(args, { stdout: "pipe", stderr: "ignore", stdin: "ignore" });
  const stdout = await new Response(proc.stdout).text();
  const code = await proc.exited;
  return { code, stdout };
};

/** Detect whether `gh` is authenticated-enough to run and whether the
 *  `cli/gh-webhook` extension is installed. Runner injectable for tests. */
export async function detectGhWebhook(
  run: GhRunner = defaultRun,
): Promise<{ gh: boolean; extension: boolean }> {
  const version = await run(["gh", "--version"]).catch(() => ({ code: 1, stdout: "" }));
  if (version.code !== 0) return { gh: false, extension: false };
  const list = await run(["gh", "extension", "list"]).catch(() => ({ code: 1, stdout: "" }));
  const extension = list.code === 0 && /gh-webhook/i.test(list.stdout);
  return { gh: true, extension };
}

/**
 * Ensure `gh webhook forward` can run: gh present, extension installed. If gh
 * is present but the extension is missing, attempt a one-time install. Returns
 * false (with ONE clear log line) when unavailable so the caller falls back to
 * the reconcile sweep instead of crashing.
 */
export async function ensureGhWebhook(run: GhRunner = defaultRun): Promise<boolean> {
  const { gh, extension } = await detectGhWebhook(run);
  if (!gh) {
    console.warn(
      "[github-forward] gh CLI not found or not authenticated — install GitHub CLI, run `gh auth login` and `gh extension install cli/gh-webhook`; falling back to the reconcile sweep",
    );
    return false;
  }
  if (extension) return true;
  console.log("[github-forward] cli/gh-webhook not installed — attempting `gh extension install cli/gh-webhook`");
  const install = await run(["gh", "extension", "install", "cli/gh-webhook"]).catch(() => ({
    code: 1,
    stdout: "",
  }));
  if (install.code === 0) return true;
  console.warn(
    "[github-forward] `gh extension install cli/gh-webhook` failed — install it manually; falling back to the reconcile sweep",
  );
  return false;
}

// ── Subprocess lifecycle ─────────────────────────────────────

const MAX_BACKOFF_MS = 30_000;
/** A forwarder that stays up this long is healthy; reset its backoff. */
const HEALTHY_UPTIME_MS = 60_000;

interface Running {
  label: string;
  args: string[];
  proc: ReturnType<typeof Bun.spawn>;
}

interface ForwardState {
  running: Running[];
  stopped: boolean;
  started: boolean;
  attempts: Map<string, number>;
}

// Park state on globalThis so a `bun --hot` re-evaluation reuses the SAME
// registry instead of spawning a second set of forwarders (the module-scoped
// arrays would otherwise reset to empty and lose the live child handles).
const g = globalThis as unknown as { __ghWebhookForward?: ForwardState };
const state: ForwardState = (g.__ghWebhookForward ??= {
  running: [],
  stopped: false,
  started: false,
  attempts: new Map(),
});

function spawnForwarder(label: string, args: string[]): void {
  if (state.stopped) return;
  const startedAt = Date.now();
  let proc: ReturnType<typeof Bun.spawn>;
  try {
    proc = Bun.spawn(args, { stdout: "inherit", stderr: "inherit", stdin: "ignore" });
  } catch (e) {
    console.error(`[github-forward] failed to spawn forwarder for ${label}:`, e);
    scheduleRestart(label, args);
    return;
  }
  const entry: Running = { label, args, proc };
  state.running.push(entry);

  void proc.exited.then((code) => {
    state.running = state.running.filter((r) => r !== entry);
    if (state.stopped) return;
    // A long, healthy run clears the backoff so a much-later crash restarts fast.
    if (Date.now() - startedAt >= HEALTHY_UPTIME_MS) state.attempts.delete(label);
    console.warn(`[github-forward] forwarder for ${label} exited (code ${code})`);
    scheduleRestart(label, args);
  });
}

function scheduleRestart(label: string, args: string[]): void {
  if (state.stopped) return;
  const n = (state.attempts.get(label) || 0) + 1;
  state.attempts.set(label, n);
  const delay = Math.min(MAX_BACKOFF_MS, 1000 * 2 ** Math.min(n - 1, 5));
  const wait = Math.round(delay / 2 + Math.random() * (delay / 2));
  console.log(`[github-forward] restarting forwarder for ${label} in ${wait}ms`);
  setTimeout(() => spawnForwarder(label, args), wait);
}

/**
 * Arm the outbound forwarder. No-op unless gating says so. Idempotent: a second
 * call (or a hot reload) while forwarders are live does nothing.
 */
export async function startGithubWebhookForward(): Promise<void> {
  if (!githubWebhookForwardEnabled()) return;
  if (state.started && state.running.length > 0) return; // already running

  const available = await ensureGhWebhook();
  if (!available) return; // reconcile sweep is the backstop

  const secret = process.env.GITHUB_WEBHOOK_SECRET || "";
  if (!secret) {
    console.warn(
      "[github-forward] GITHUB_WEBHOOK_SECRET unset — forwarded deliveries will fail the handler's signature check; set it to match the Slack agent",
    );
  }

  const { org, repos } = forwardTargets();
  const url = forwardUrl();
  const events = WEBHOOK_FORWARD_EVENTS;

  const commands: Array<{ label: string; args: string[] }> = [];
  if (org) {
    commands.push({ label: `org:${org}`, args: buildForwardCommand({ org, events, url, secret }) });
  } else {
    for (const repo of repos) {
      commands.push({ label: `repo:${repo}`, args: buildForwardCommand({ repo, events, url, secret }) });
    }
  }

  if (commands.length === 0) {
    console.warn(
      "[github-forward] no ghRepo (or org) configured — nothing to forward; the reconcile sweep remains the backstop",
    );
    return;
  }

  state.stopped = false;
  state.started = true;
  for (const c of commands) spawnForwarder(c.label, c.args);
  console.log(
    `[github-forward] forwarding GitHub webhooks over an outbound gh connection → ${url} (${commands.map((c) => c.label).join(", ")})`,
  );
}

/** Kill every forwarder and stop restarting. Safe when nothing is running. */
export function stopGithubWebhookForward(): void {
  state.stopped = true;
  state.started = false;
  for (const r of state.running) {
    try {
      r.proc.kill();
    } catch {}
  }
  state.running = [];
  state.attempts.clear();
}

/** Health snapshot for the github agent's `health()`. */
export function githubWebhookForwardStatus(): Record<string, unknown> {
  return {
    enabled: githubWebhookForwardEnabled(),
    running: state.running.map((r) => r.label),
  };
}
