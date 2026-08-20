/**
 * Git credential helper for github.com remotes.
 *
 * Registered per checkout by setup-repos.ts and reached through the stable
 * `opensession github-credential` command. The run-scoped GH_TOKEN wins in
 * operator mode; personal simple mode falls back to its sole stored account.
 * Neither credential is written to git config or a remote URL.
 */

import { soleGithubAccount } from "../../packages/core/opensession-server/src/server/github-auth";

export function githubCredentialResponse(action: string | undefined, input: string): string {
  if (action !== "get") return "";

  const attrs: Record<string, string> = {};
  for (const line of input.split("\n")) {
    if (!line) break;
    const eq = line.indexOf("=");
    if (eq > 0) attrs[line.slice(0, eq)] = line.slice(eq + 1);
  }
  if (attrs.protocol !== "https" || attrs.host !== "github.com") return "";

  const token = process.env.GH_TOKEN || soleGithubAccount()?.env.GH_TOKEN;
  return token ? `username=x-access-token\npassword=${token}\n` : "";
}

export async function githubCredentialHelper(action: string | undefined): Promise<number> {
  process.stdout.write(githubCredentialResponse(action, await Bun.stdin.text()));
  return 0;
}
