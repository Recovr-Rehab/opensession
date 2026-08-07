/**
 * Git-remote plumbing for code.storage checkouts.
 *
 * Remotes are plain HTTPS (`https://<org>.code.storage/<repoId>.git`) with
 * username "t" and a JWT password. Rather than embedding a token that expires
 * into the remote URL, checkouts get a URL-scoped git credential helper that
 * mints a fresh JWT per fetch/push (scripts/cs-credential.ts). URL-scoped
 * repo-local config wins over the global `credential.helper store` install.sh
 * sets, and never touches github.com flows.
 */

import { $ } from "bun";
import { existsSync } from "fs";
import { resolve as resolvePath } from "path";
import { codeStorageConfig, configuredRepos } from "../config";
import { authedRemoteUrl, remoteUrl } from "./auth";

const CREDENTIAL_SCRIPT = resolvePath(import.meta.dir, "../../../scripts/cs-credential.ts");

// https://<org>.code.storage/<repoId>(.git), with optional t:<jwt>@ userinfo.
// Multi-label hosts (api.<org>.code.storage) deliberately don't match.
const CS_REMOTE_RE = /^https:\/\/(?:t:[^@]*@)?([A-Za-z0-9][A-Za-z0-9-]*)\.code\.storage\/(.+?)(?:\.git)?\/?$/;

/** Recognize a code.storage remote URL → {org, repoId}, or null. */
export function parseCsRemote(url: string): { org: string; repoId: string } | null {
  const m = url.trim().match(CS_REMOTE_RE);
  if (!m) return null;
  const [, org, repoId] = m;
  if (!org || !repoId) return null;
  return { org, repoId };
}

/**
 * Point a checkout's code.storage credentials at the minting helper.
 * `useHttpPath` is required: without it git omits the request path, and the
 * helper needs it to scope the JWT's `repo` claim.
 */
export async function configureCsCredentialHelper(
  checkoutPath: string,
  org: string,
): Promise<void> {
  const section = `credential.https://${org}.code.storage`;
  await $`git -C ${checkoutPath} config ${section + ".helper"} ${`!bun ${CREDENTIAL_SCRIPT}`}`.quiet();
  await $`git -C ${checkoutPath} config ${section + ".useHttpPath"} true`.quiet();
}

/** Idempotent configureCsCredentialHelper: cheap read-before-write so boot
 *  adoption never churns .git/config (or its mtime) on already-wired repos. */
export async function ensureCsCredentialHelper(
  checkoutPath: string,
  org: string,
): Promise<void> {
  const current = (
    await $`git -C ${checkoutPath} config --get ${`credential.https://${org}.code.storage.helper`}`
      .quiet()
      .nothrow()
      .text()
  ).trim();
  if (current === `!bun ${CREDENTIAL_SCRIPT}`) return;
  await configureCsCredentialHelper(checkoutPath, org);
}

/**
 * Clone a code.storage repo for registration: clone with an embedded
 * short-lived JWT, then persist the credential-free remote and wire the
 * minting helper — so ambient `git fetch`/`git push` (worktree.ts et al.)
 * works from then on without a token ever landing in git config.
 */
export async function cloneCsCheckout(
  repoId: string,
  dest: string,
  org?: string,
): Promise<void> {
  const cfg = codeStorageConfig();
  if (!cfg) throw new Error("code.storage is not configured (integrations.codeStorage)");
  const theOrg = org || cfg.org;
  const authed = await authedRemoteUrl(repoId, { org: theOrg });
  const proc = Bun.spawn(["git", "clone", "--", authed, dest], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const timeout = setTimeout(() => proc.kill(9), 5 * 60_000);
  const [exitCode, stderr] = await Promise.all([
    proc.exited.finally(() => clearTimeout(timeout)),
    new Response(proc.stderr).text(),
  ]);
  if (exitCode !== 0) {
    // git may echo the clone URL (JWT included) into stderr — redact it.
    throw new Error(
      (stderr.trim() || "git clone failed").replace(/t:[A-Za-z0-9_.-]+@/g, "t:***@"),
    );
  }
  await $`git -C ${dest} remote set-url origin ${remoteUrl(theOrg, repoId)}`.quiet();
  await configureCsCredentialHelper(dest, theOrg);
}

/**
 * Boot adoption: make sure every registered code.storage repo's main checkout
 * has the credential helper wired (e.g. checkouts registered by hand, or
 * synced from another instance). No-op unless configured; best-effort per
 * repo so one bad checkout never blocks the rest.
 */
export async function adoptCsCheckouts(): Promise<void> {
  const cfg = codeStorageConfig();
  if (!cfg) return;
  for (const repo of Object.values(configuredRepos())) {
    if (repo.host !== "codestorage" || !existsSync(repo.repo)) continue;
    try {
      const origin = (
        await $`git -C ${repo.repo} remote get-url origin`.quiet().nothrow().text()
      ).trim();
      const org = parseCsRemote(origin)?.org || cfg.org;
      await ensureCsCredentialHelper(repo.repo, org);
    } catch (e) {
      console.warn(`[codestorage] credential-helper adoption failed for ${repo.id}:`, e);
    }
  }
}
