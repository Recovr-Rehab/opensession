/**
 * Browser-based "Sign in with Claude" for account setup and reconnection.
 *
 * New accounts use this OAuth grant for both model runs and usage polling.
 * Existing setup-token accounts can attach the same grant for usage without
 * changing the long-lived token their runs already use.
 *
 * This flow mints a token family Open Session owns exclusively: an
 * authorization-code + PKCE login against Anthropic's public Claude Code
 * client id. The user opens the authorize URL on any device, signs into the
 * matching Claude account, and pastes back the code Anthropic displays. We
 * exchange it and store the credentials in ~/.opensession-claude-oauth/
 * (0600), in the same claudeAiOauth shape as ~/.claude/.credentials.json so
 * the existing usage-refresh machinery consumes the file unchanged. A
 * separate OAuth grant never disturbs the CLI's or claude-plan's logins:
 * refresh rotation only invalidates tokens within the same family.
 *
 * Pending logins are parked on globalThis so a hot reload mid-flow doesn't
 * lose the PKCE verifier between "open this URL" and the code paste.
 */

import { chmodSync, mkdirSync, rmSync } from "fs";
import { writeFileAtomic } from "./shared/atomic-write";
import { stateDir } from "./paths";
import {
  addOauthAccount,
  getAccountById,
  setAccountUsageCredentials,
  type ClaudeAccountPublic,
} from "./claude-accounts";

const AUTHORIZE_URL = "https://claude.ai/oauth/authorize";
const TOKEN_URL = "https://console.anthropic.com/v1/oauth/token";
const REDIRECT_URI = "https://console.anthropic.com/oauth/code/callback";
// Claude Code's public OAuth client id — same one the CLI logs in with.
const CLIENT_ID = "9d1c250a-e61b-44d9-88ed-5944d1962f5e";
// The scope set Claude Code's own login flow requests through this client id;
// user:profile is the one usage polling actually needs.
const SCOPE = "org:create_api_key user:profile user:inference";
// Authorization codes are short-lived; drop stale attempts.
const LOGIN_TTL_MS = 15 * 60 * 1000;

interface PendingLogin {
  id: string;
  accountId: string;
  createAccount: boolean;
  verifier: string;
  createdAt: number;
}

export interface ClaudeLoginStart {
  id: string;
  url: string;
  accountName: string;
}

const pending: Map<string, PendingLogin> = ((globalThis as any).__claudeOauthLogins ??=
  new Map());

function prune(): void {
  const now = Date.now();
  for (const [id, l] of pending) {
    if (now - l.createdAt > LOGIN_TTL_MS) pending.delete(id);
  }
}

function b64url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64url");
}

/** Where a signed-in account's credentials live — one file per account id. */
export function claudeOauthCredentialsPath(accountId: string): string {
  return `${stateDir("claude-oauth")}/${accountId}.json`;
}

/** Begin a PKCE sign-in for a new account or an existing pool account. */
export async function startClaudeLogin(
  accountId?: string
): Promise<ClaudeLoginStart | { error: string }> {
  prune();
  const account = accountId ? getAccountById(accountId) : undefined;
  if (accountId && !account) return { error: "Unknown account" };
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(32)));
  const challenge = b64url(
    new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)))
  );
  const login: PendingLogin = {
    id: crypto.randomUUID(),
    accountId: account?.id || crypto.randomUUID(),
    createAccount: !account,
    verifier,
    createdAt: Date.now(),
  };
  pending.set(login.id, login);
  const url = `${AUTHORIZE_URL}?${new URLSearchParams({
    code: "true",
    client_id: CLIENT_ID,
    response_type: "code",
    redirect_uri: REDIRECT_URI,
    scope: SCOPE,
    code_challenge: challenge,
    code_challenge_method: "S256",
    state: verifier,
  })}`;
  return { id: login.id, url, accountName: account?.name || "Claude account" };
}

/**
 * Exchange the pasted `code#state` for tokens and attach them to the login's
 * account. On an exchange failure the attempt stays alive so the user can fix
 * a mangled paste without restarting the flow.
 */
export async function completeClaudeLogin(
  id: string,
  pastedCode: string
): Promise<{ account: ClaudeAccountPublic } | { error: string }> {
  prune();
  const login = pending.get(id);
  if (!login) return { error: "Sign-in attempt expired — start again." };
  const cleaned = pastedCode.replace(/\s+/g, "");
  const [code, state] = cleaned.split("#");
  if (!code) return { error: "Paste the full code Anthropic showed after sign-in." };

  let res: Response;
  try {
    res = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        grant_type: "authorization_code",
        code,
        state: state || "",
        client_id: CLIENT_ID,
        redirect_uri: REDIRECT_URI,
        code_verifier: login.verifier,
      }),
      signal: AbortSignal.timeout(15_000),
    });
  } catch (e: any) {
    return { error: `Token exchange failed: ${e?.message || e}` };
  }
  if (!res.ok) {
    const detail = (await res.text().catch(() => "")).slice(0, 200);
    return { error: `Token exchange failed (HTTP ${res.status})${detail ? `: ${detail}` : ""}` };
  }
  const body: any = await res.json().catch(() => null);
  if (!body?.access_token || !body?.refresh_token) {
    return { error: "Token exchange returned no usable tokens." };
  }

  const account = login.createAccount ? undefined : getAccountById(login.accountId);
  if (!login.createAccount && !account) {
    pending.delete(id);
    return { error: "The account this sign-in was for no longer exists." };
  }
  const email: string | undefined = body.account?.email_address || undefined;
  // Usage data from the wrong subscription is actively misleading. Refuse a
  // mismatched sign-in instead of silently attaching it.
  if (account?.email && email && account.email.toLowerCase() !== email.toLowerCase()) {
    pending.delete(id);
    return {
      error: `Signed into ${email}, but this pool account is ${account.email}. Sign in with the matching Claude account and try again.`,
    };
  }

  mkdirSync(stateDir("claude-oauth"), { recursive: true, mode: 0o700 });
  const path = claudeOauthCredentialsPath(login.accountId);
  writeFileAtomic(
    path,
    JSON.stringify(
      {
        claudeAiOauth: {
          accessToken: body.access_token,
          refreshToken: body.refresh_token,
          expiresAt: Date.now() + (Number(body.expires_in) || 28_800) * 1000,
          scopes: typeof body.scope === "string" ? body.scope.split(" ") : undefined,
        },
      },
      null,
      2
    ) + "\n"
  );
  chmodSync(path, 0o600);
  pending.delete(id);

  if (login.createAccount) {
    const added = await addOauthAccount({
      id: login.accountId,
      token: body.access_token,
      credentialsPath: path,
      email,
    });
    if ("error" in added) {
      rmSync(path, { force: true });
      return added;
    }
    console.log(`[claude-oauth-login] ${added.name} signed in and registered`);
    return { account: added };
  }

  const updated = setAccountUsageCredentials(login.accountId, path, email);
  if (!updated) return { error: "The account this sign-in was for no longer exists." };
  console.log(`[claude-oauth-login] ${updated.name} reconnected${email ? ` (${email})` : ""}`);
  return { account: updated };
}

export function cancelClaudeLogin(id: string): boolean {
  return pending.delete(id);
}
