/**
 * Git credential helper for github.com remotes.
 *
 * Registered per checkout by setup-repos.ts and reached through the stable
 * `opensession github-credential` command. A run-scoped GH_TOKEN wins. Without
 * one, the checkout's recorded non-secret username selects its stored account;
 * personal simple mode can also fall back to its sole account. No token is
 * written to git config or a remote URL.
 */

import {
  githubCredentialForLogin,
  soleGithubAccount,
} from "../../packages/core/opensession-server/src/server/github-auth";

export function githubCredentialResponse(
  action: string | undefined,
  input: string,
  credentialForLogin = githubCredentialForLogin,
): string {
  if (action !== "get") return "";

  const attrs: Record<string, string> = {};
  for (const line of input.split("\n")) {
    if (!line) break;
    const eq = line.indexOf("=");
    if (eq > 0) attrs[line.slice(0, eq)] = line.slice(eq + 1);
  }
  if (attrs.protocol !== "https" || attrs.host !== "github.com") return "";

  const login = attrs.username?.trim();
  const token =
    process.env.GH_TOKEN ||
    (login ? credentialForLogin(login)?.env.GH_TOKEN : undefined) ||
    soleGithubAccount()?.env.GH_TOKEN;
  return token ? `username=x-access-token\npassword=${token}\n` : "";
}

export async function githubCredentialHelper(action: string | undefined): Promise<number> {
  process.stdout.write(githubCredentialResponse(action, await Bun.stdin.text()));
  return 0;
}
