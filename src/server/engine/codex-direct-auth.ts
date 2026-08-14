/**
 * Auth + process isolation for the codex-direct engine.
 *
 * The engine runs the `codex` binary as a subprocess, and a codex process is
 * shaped entirely by its CODEX_HOME: credentials, config, MCP servers,
 * plugins, skills, memories and session rollouts all live there. So the whole
 * containment story is "which CODEX_HOME does the child get".
 *
 * We give it an ISOLATED one per account, under stateDir("codex-direct"),
 * never the account's own directory:
 *  - The registered ChatGPT accounts (`kind: "home"`) are LIVE codex CLI
 *    logins that humans and the legacy `--agent codex` tooling still use.
 *    Writing our per-run config, MCP servers and trust levels into them would
 *    mutate somebody's real codex install.
 *  - The reverse is just as bad: those directories carry whatever the human
 *    configured — their own MCP servers, plugins, skills, project trust
 *    levels — and an agent run must not silently inherit an unbounded config
 *    surface it never declared.
 *
 * ROTATION SAFETY (the same hazard opencode-openai-auth.ts documents at
 * length): OpenAI rotates the refresh token on every refresh, and the family
 * is shared between the codex CLI and opencode. An isolated home is a COPY, so
 * it must never be able to refresh. We seed it access-token-only, reusing
 * `buildSeededOpenaiAuth` — which reads the account's CODEX_HOME/auth.json,
 * refuses an already-expired access token, and returns the token plus its real
 * JWT expiry — and write codex's own auth.json shape with a deliberately
 * INVALID placeholder refresh token. The account's own directory stays the
 * single source of truth for refresh; a stale isolated home fails loudly with
 * a 400 instead of silently rotating the family out from under the CLI.
 * `last_refresh` is stamped at seed time (we re-seed every turn), so codex
 * sees a freshly-refreshed credential and has no reason to try.
 *
 * `id_token` rides along when present: it is an identity assertion codex reads
 * for plan/account display, not a rotating credential, so copying it carries
 * no rotation hazard.
 *
 * API-KEY ACCOUNTS ARE SUPPORTED (an explicit decision, unlike pi, which
 * dead-ends them): codex reads `OPENAI_API_KEY` from auth.json / the env for
 * `auth_mode: "apikey"`, so an api_key account seeds a key-only home and the
 * run bills the platform org. Not verified end-to-end — there is no api_key
 * account in the pool to test against — so the first real one should be
 * watched.
 *
 * The subprocess env is built here too, and is minimal by construction:
 * PATH/HOME/LANG/TERM + locale/proxy/TLS passthrough + CODEX_HOME. No Open
 * Session tokens, ever. MCP servers get their own credentials through the
 * injected MCP config (codex-direct-mcp.ts), not through this env.
 */

import { chmodSync, existsSync, mkdirSync, readFileSync } from "fs";
import { homeDir, stateDir } from "../paths";
import { writeFileAtomic } from "../shared/atomic-write";
import { buildSeededOpenaiAuth, OPENCODE_OPENAI_PLACEHOLDER_REFRESH } from "../opencode-openai-auth";
import type { CodexAccount } from "../codex-accounts";

/** State root: per-account isolated CODEX_HOMEs and the smoke scratch cwd. */
export const CODEX_DIRECT_STATE_DIR = stateDir("codex-direct");

/** Where an account's isolated home lives. Stable per account so codex's own
 *  `sessions/` rollouts accumulate in one place and `thread/resume` can find
 *  a thread started by an earlier turn. */
export function codexDirectHomeFor(accountId: string): string {
  return `${CODEX_DIRECT_STATE_DIR}/home/${accountId}`;
}

export type CodexDirectAuthMechanism = "oauth-subscription-seeded" | "api-key";

export interface CodexDirectAuthBinding {
  codexHome: string;
  mechanism: CodexDirectAuthMechanism;
  /** Extra env beyond the base minimal set (api-key accounts only). */
  extraEnv: Record<string, string>;
}

/** The auth.json codex reads for a ChatGPT-plan login. Only `access_token`
 *  and `account_id` (and the optional `id_token`) come from the account;
 *  `refresh_token` is the placeholder by construction. */
interface CodexAuthFile {
  auth_mode: "chatgpt" | "apikey";
  OPENAI_API_KEY: string | null;
  tokens: {
    id_token?: string;
    access_token: string;
    refresh_token: string;
    account_id?: string;
  } | null;
  last_refresh: string | null;
}

/** Read the account's own auth.json for the fields buildSeededOpenaiAuth does
 *  not return (today: id_token). Best-effort — a missing file was already
 *  reported by buildSeededOpenaiAuth. */
function sourceIdToken(account: CodexAccount): string | undefined {
  try {
    const src = JSON.parse(readFileSync(`${account.value}/auth.json`, "utf-8"));
    const id = src?.tokens?.id_token;
    return typeof id === "string" && id ? id : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Prepare (and re-seed) the isolated CODEX_HOME for an account. Called on
 * every turn so the home always carries the account's CURRENT access token.
 * Returns `{ error }` rather than throwing so the runner can surface a clean
 * terminal event.
 */
export function seedCodexDirectHome(
  account: CodexAccount
): CodexDirectAuthBinding | { error: string } {
  const codexHome = codexDirectHomeFor(account.id);
  try {
    mkdirSync(codexHome, { recursive: true, mode: 0o700 });
  } catch (e: any) {
    return { error: `could not create the isolated CODEX_HOME ${codexHome}: ${e?.message || e}` };
  }

  if (account.kind === "api_key") {
    const auth: CodexAuthFile = {
      auth_mode: "apikey",
      OPENAI_API_KEY: account.value,
      tokens: null,
      last_refresh: null,
    };
    writeAuth(codexHome, auth);
    return {
      codexHome,
      mechanism: "api-key",
      // Belt and braces: codex resolves an api key from either place.
      extraEnv: { OPENAI_API_KEY: account.value },
    };
  }

  const built = buildSeededOpenaiAuth(account);
  if ("error" in built) return { error: built.error };
  const idToken = sourceIdToken(account);
  const auth: CodexAuthFile = {
    auth_mode: "chatgpt",
    OPENAI_API_KEY: null,
    tokens: {
      ...(idToken ? { id_token: idToken } : {}),
      access_token: built.seeded.openai.access,
      // Deliberately invalid — see the module header. This copy must never be
      // able to rotate the shared refresh-token family.
      refresh_token: OPENCODE_OPENAI_PLACEHOLDER_REFRESH,
      ...(built.seeded.openai.accountId ? { account_id: built.seeded.openai.accountId } : {}),
    },
    // Stamped now: we re-seed per turn, so the credential codex sees IS fresh.
    last_refresh: new Date().toISOString(),
  };
  writeAuth(codexHome, auth);
  return { codexHome, mechanism: "oauth-subscription-seeded", extraEnv: {} };
}

function writeAuth(codexHome: string, auth: CodexAuthFile): void {
  const path = `${codexHome}/auth.json`;
  writeFileAtomic(path, `${JSON.stringify(auth, null, 2)}\n`);
  try {
    chmodSync(path, 0o600);
  } catch {}
}

/** Does an isolated home already exist? (Diagnostics / tests.) */
export function codexDirectHomeExists(accountId: string): boolean {
  return existsSync(`${codexDirectHomeFor(accountId)}/auth.json`);
}

/** Env vars that must pass through for the child to reach the network and
 *  render text correctly. Same list codex-usage.ts forwards. */
const PASSTHROUGH_ENV = [
  "LANG",
  "LC_ALL",
  "SSL_CERT_FILE",
  "SSL_CERT_DIR",
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "NO_PROXY",
  "http_proxy",
  "https_proxy",
  "no_proxy",
] as const;

/**
 * The subprocess env. Minimal and explicit: nothing from the server's env
 * file, no Open Session tokens, no MCP credentials (those ride the injected
 * MCP config). `extra` is for the caller's own additions — an api-key
 * account's OPENAI_API_KEY, a git identity for code-mode commits, an MCP
 * server's bearer — each of which the caller has to justify.
 */
export function codexDirectEnv(
  codexHome: string,
  extra: Record<string, string | undefined> = {}
): Record<string, string> {
  const env: Record<string, string> = {
    CODEX_HOME: codexHome,
    HOME: homeDir(),
    PATH: process.env.PATH || "/usr/local/bin:/usr/bin:/bin",
    TERM: process.env.TERM || "xterm-256color",
  };
  for (const key of PASSTHROUGH_ENV) {
    const value = process.env[key];
    if (value) env[key] = value;
  }
  for (const [key, value] of Object.entries(extra)) {
    if (value) env[key] = value;
  }
  return env;
}
