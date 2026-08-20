#!/usr/bin/env bun
/**
 * Git credential helper for github.com remotes in simple mode.
 *
 * Wired per-checkout by configureGithubCredentialHelper (src/server/routes/
 * setup-repos.ts) so ambient `git fetch`/`git push` after a private clone
 * authenticate with the currently connected account's token, resolved at use
 * time and never persisted in `.git/config`. The clone's own GIT_ASKPASS covers
 * only the clone itself; without this helper the tokenless remote left behind
 * fails every later fetch/push, since simple mode has no `gh auth login` and git
 * does not read GH_TOKEN.
 *
 * Helper contract: key=value lines on stdin until a blank line. For `get` on
 * github.com we answer username `x-access-token` (the App/user-token username)
 * plus the sole account's token; store/erase are no-ops (the password is
 * derived, nothing to persist). Anything foreign — a non-github host, operator
 * mode where `soleGithubAccount()` is null, or no connected account — prints
 * nothing and exits 0 so git falls through to its other helpers rather than
 * failing the whole operation.
 */

import { soleGithubAccount } from "../packages/core/opensession-server/src/server/github-auth";

const action = process.argv[2];
if (action !== "get") process.exit(0);

const attrs: Record<string, string> = {};
for (const line of (await Bun.stdin.text()).split("\n")) {
  if (!line) break;
  const eq = line.indexOf("=");
  if (eq > 0) attrs[line.slice(0, eq)] = line.slice(eq + 1);
}

if (attrs.protocol !== "https" || attrs.host !== "github.com") process.exit(0);

const token = soleGithubAccount()?.env.GH_TOKEN;
if (!token) process.exit(0);

process.stdout.write(`username=x-access-token\npassword=${token}\n`);
