/**
 * Minimal code.storage REST client (https://code.storage/docs/reference/api/overview.md).
 *
 * Base URL: `https://api.<org>.code.storage/api` (overridable via
 * `integrations.codeStorage.apiBase`), Bearer auth with self-signed JWTs
 * (auth.ts). Tokens are cached per (repo, scopes) and re-minted near expiry.
 *
 * Response types describe only the fields we consume; the API returns more.
 * Repo ids can contain "/" and must occupy one path segment
 * (`pierre/example` → `/repos/pierre%2Fexample/...`).
 */

import { codeStorageConfig, type CodeStorageConfig } from "../config";
import { mintCsJwt, type CsScope } from "./auth";

const TIMEOUT_MS = 30_000;
const TOKEN_TTL_S = 15 * 60;
// Re-mint when a cached token has less than this left, so an in-flight
// request never crosses `exp`.
const TOKEN_MIN_REMAINING_S = 60;

const tokenCache = new Map<string, { token: string; exp: number }>();

function requireConfig(): CodeStorageConfig {
  const cfg = codeStorageConfig();
  if (!cfg) throw new Error("code.storage is not configured (integrations.codeStorage)");
  return cfg;
}

async function bearer(repo: string | undefined, scopes: CsScope[]): Promise<string> {
  const cfg = requireConfig();
  const key = `${cfg.org}|${repo ?? ""}|${[...scopes].sort().join(",")}`;
  const now = Math.floor(Date.now() / 1000);
  const cached = tokenCache.get(key);
  if (cached && cached.exp - now > TOKEN_MIN_REMAINING_S) return cached.token;
  const token = await mintCsJwt({ org: cfg.org, repo, scopes, ttlSeconds: TOKEN_TTL_S });
  tokenCache.set(key, { token, exp: now + TOKEN_TTL_S });
  return token;
}

type Query = Record<string, string | number | boolean | string[] | undefined>;

async function csFetch(
  path: string,
  opts: { scopes: CsScope[]; repo?: string; method?: string; query?: Query; body?: unknown },
): Promise<Response> {
  const cfg = requireConfig();
  const url = new URL(cfg.apiBase + path);
  for (const [k, v] of Object.entries(opts.query ?? {})) {
    if (v === undefined) continue;
    for (const item of Array.isArray(v) ? v : [v]) url.searchParams.append(k, String(item));
  }
  const method = opts.method || "GET";
  const res = await fetch(url, {
    method,
    headers: {
      authorization: `Bearer ${await bearer(opts.repo, opts.scopes)}`,
      ...(opts.body !== undefined ? { "content-type": "application/json" } : {}),
    },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) {
    // RFC 9457 problem details with a legacy `error` mirror of `detail`.
    let detail = "";
    try {
      const err = (await res.json()) as { detail?: string; error?: string };
      detail = err.detail || err.error || "";
    } catch {}
    throw new Error(
      `code.storage ${method} ${path} failed: ${res.status}${detail ? ` — ${detail}` : ""}`,
    );
  }
  return res;
}

const repoPath = (repoId: string) => `/repos/${encodeURIComponent(repoId)}`;

// ---------------------------------------------------------------------------
// Response shapes (fields we consume)
// ---------------------------------------------------------------------------

export interface CsRepoSummary {
  /** Internal id, e.g. "repo_7f2b3d9". */
  repo_id: string;
  /** Repository URL path — matches the JWT `repo` claim, e.g. "acme/widget". */
  url: string;
  default_branch: string;
  created_at: string;
  /** Upstream sync configuration, when the repo mirrors e.g. GitHub. */
  base_repo?: { provider: string; owner?: string; name?: string };
}

export interface CsBranch {
  name: string;
  head_sha?: string;
  created_at?: string;
  cursor?: string;
}

export interface CsCommit {
  sha: string;
  parent_shas: string[];
  message: string;
  author_name: string;
  author_email: string;
  committer_name: string;
  committer_email: string;
  date: string;
}

export interface CsCommitPage {
  commits: CsCommit[];
  has_more: boolean;
  next_cursor?: string;
}

export interface CsDiffFile {
  /** Repository-relative path (new location for renames). */
  path: string;
  old_path?: string;
  /** Git status code: A, M, D, R, C, or T. */
  state: string;
  /** Raw unified diff content. */
  raw: string;
  bytes: number;
  is_eof: boolean;
  additions?: number;
  deletions?: number;
}

/** Entry suppressed from inline content by server-side large-file filtering. */
export interface CsFilteredFile {
  path: string;
  state: string;
  bytes: number;
}

export interface CsDiffStats {
  additions: number;
  deletions: number;
  changes: number;
  files: number;
}

export interface CsBranchDiff {
  branch: string;
  base?: string;
  files: CsDiffFile[];
  filtered_files?: CsFilteredFile[];
  merge_base_sha?: string;
  stats?: CsDiffStats;
}

export interface CsCommitDiff {
  sha: string;
  files: CsDiffFile[];
  filtered_files?: CsFilteredFile[];
  merge_base_sha?: string;
  stats?: CsDiffStats;
}

export interface CsMergeResult {
  /** merge_commit, fast_forward, no_op, squash, or unknown. */
  result: string;
  /** Resulting commit SHA (target tip after the merge). */
  commit_sha?: string;
  merge_base_sha?: string;
  promoted_commits?: number;
  target?: { branch: string; old_sha?: string; new_sha?: string };
}

export interface CsMergePreview {
  /** "clean" or "conflicted". */
  status: string;
  conflict_paths?: string[];
  merge_base_sha?: string;
  source_branch?: string;
  source_tip_sha?: string;
  target_branch?: string;
  target_tip_sha?: string;
  conflicts?: Array<{
    path: string;
    base?: CsConflictBlob;
    ours?: CsConflictBlob;
    theirs?: CsConflictBlob;
    result?: CsConflictBlob;
  }>;
}

export interface CsConflictBlob {
  binary: boolean;
  truncated: boolean;
  content?: string;
  oid?: string;
}

export interface CsCreatedRepo {
  repo_id: string;
  http_url: string;
  message: string;
}

// ---------------------------------------------------------------------------
// Endpoints
// ---------------------------------------------------------------------------

/** GET /repos (org:read). Follows cursors to return the full listing. */
export async function listRepos(q?: string): Promise<CsRepoSummary[]> {
  const repos: CsRepoSummary[] = [];
  let cursor: string | undefined;
  do {
    const res = await csFetch("/repos", {
      scopes: ["org:read"],
      query: { q, cursor, limit: 100 },
    });
    const page = (await res.json()) as {
      repos: CsRepoSummary[];
      has_more: boolean;
      next_cursor?: string;
    };
    repos.push(...page.repos);
    cursor = page.has_more ? page.next_cursor : undefined;
  } while (cursor);
  return repos;
}

/** POST /repos (repo:write) — the new repo's id comes from the JWT `repo` claim. */
export async function createRepo(
  repoId: string,
  opts?: { defaultBranch?: string },
): Promise<CsCreatedRepo> {
  const res = await csFetch("/repos", {
    scopes: ["repo:write"],
    repo: repoId,
    method: "POST",
    body: opts?.defaultBranch ? { default_branch: opts.defaultBranch } : {},
  });
  return (await res.json()) as CsCreatedRepo;
}

/** GET /repos/{repo} (git:read). */
export async function getRepo(repoId: string): Promise<CsRepoSummary> {
  const res = await csFetch(repoPath(repoId), { scopes: ["git:read"], repo: repoId });
  return (await res.json()) as CsRepoSummary;
}

/** GET /repos/{repo}/branches (git:read). Follows cursors. */
export async function listBranches(repoId: string): Promise<CsBranch[]> {
  const branches: CsBranch[] = [];
  let cursor: string | undefined;
  do {
    const res = await csFetch(`${repoPath(repoId)}/branches`, {
      scopes: ["git:read"],
      repo: repoId,
      query: { cursor, limit: 100 },
    });
    const page = (await res.json()) as {
      branches: CsBranch[];
      has_more: boolean;
      next_cursor?: string;
    };
    branches.push(...page.branches);
    cursor = page.has_more ? page.next_cursor : undefined;
  } while (cursor);
  return branches;
}

/** POST /repos/{repo}/branches/create (git:write). */
export async function createBranch(
  repoId: string,
  targetBranch: string,
  opts?: { baseBranch?: string; baseRef?: string; force?: boolean },
): Promise<{ target_branch: string; commit_sha?: string; message: string }> {
  const res = await csFetch(`${repoPath(repoId)}/branches/create`, {
    scopes: ["git:write"],
    repo: repoId,
    method: "POST",
    body: {
      target_branch: targetBranch,
      ...(opts?.baseBranch ? { base_branch: opts.baseBranch } : {}),
      ...(opts?.baseRef ? { base_ref: opts.baseRef } : {}),
      ...(opts?.force ? { force: true } : {}),
    },
  });
  return (await res.json()) as { target_branch: string; commit_sha?: string; message: string };
}

/** DELETE /repos/{repo}/branches (git:write). The default branch is protected. */
export async function deleteBranch(
  repoId: string,
  name: string,
): Promise<{ name: string; message: string }> {
  const res = await csFetch(`${repoPath(repoId)}/branches`, {
    scopes: ["git:write"],
    repo: repoId,
    method: "DELETE",
    body: { name },
  });
  return (await res.json()) as { name: string; message: string };
}

/**
 * POST /repos/{repo}/merge (git:write) — the review model's "merge the branch"
 * action (code.storage has no pull requests). Pass `expectedTargetSha` for a
 * strict target-tip precondition; without it the gateway retries stale tips.
 */
export async function mergeBranch(
  repoId: string,
  opts: {
    sourceBranch: string;
    targetBranch: string;
    /** Default "merge" (merge commit when needed). */
    strategy?: "merge" | "ff_only" | "ff_prefer";
    commitMessage?: string;
    expectedTargetSha?: string;
    squash?: boolean;
    /** Required by the API for merge-commit strategies. */
    author?: { name: string; email: string };
  },
): Promise<CsMergeResult> {
  const res = await csFetch(`${repoPath(repoId)}/merge`, {
    scopes: ["git:write"],
    repo: repoId,
    method: "POST",
    body: {
      source_branch: opts.sourceBranch,
      target_branch: opts.targetBranch,
      strategy: opts.strategy ?? "merge",
      ...(opts.commitMessage ? { commit_message: opts.commitMessage } : {}),
      ...(opts.expectedTargetSha ? { expected_target_sha: opts.expectedTargetSha } : {}),
      ...(opts.squash ? { squash: true } : {}),
      ...(opts.author ? { author: opts.author } : {}),
    },
  });
  return (await res.json()) as CsMergeResult;
}

/** GET /repos/{repo}/merge/preview (git:read) — conflict preview, no refs touched. */
export async function previewMerge(
  repoId: string,
  sourceBranch: string,
  targetBranch: string,
  opts?: { includeContent?: boolean },
): Promise<CsMergePreview> {
  const res = await csFetch(`${repoPath(repoId)}/merge/preview`, {
    scopes: ["git:read"],
    repo: repoId,
    query: {
      source_branch: sourceBranch,
      target_branch: targetBranch,
      ...(opts?.includeContent ? { include_content: true } : {}),
    },
  });
  return (await res.json()) as CsMergePreview;
}

/** GET /repos/{repo}/commits (git:read). One page; pass `cursor` to continue. */
export async function listCommits(
  repoId: string,
  opts?: { branch?: string; path?: string; cursor?: string; limit?: number },
): Promise<CsCommitPage> {
  const res = await csFetch(`${repoPath(repoId)}/commits`, {
    scopes: ["git:read"],
    repo: repoId,
    query: { branch: opts?.branch, path: opts?.path, cursor: opts?.cursor, limit: opts?.limit },
  });
  return (await res.json()) as CsCommitPage;
}

/** GET /repos/{repo}/commit (git:read). `sha` may be a branch, short or full SHA. */
export async function getCommit(repoId: string, sha: string): Promise<CsCommit> {
  const res = await csFetch(`${repoPath(repoId)}/commit`, {
    scopes: ["git:read"],
    repo: repoId,
    query: { sha },
  });
  return ((await res.json()) as { commit: CsCommit }).commit;
}

/** GET /repos/{repo}/diff (git:read) — a single commit's diff. */
export async function getCommitDiff(
  repoId: string,
  sha: string,
  opts?: { baseSha?: string; paths?: string[] },
): Promise<CsCommitDiff> {
  const res = await csFetch(`${repoPath(repoId)}/diff`, {
    scopes: ["git:read"],
    repo: repoId,
    query: { sha, baseSha: opts?.baseSha, path: opts?.paths },
  });
  return (await res.json()) as CsCommitDiff;
}

/**
 * GET /repos/{repo}/branches/diff (git:read) — head branch vs base, every
 * change reviewable before a merge. This is the PR-diff equivalent.
 */
export async function getBranchDiff(
  repoId: string,
  base: string,
  head: string,
  opts?: { paths?: string[] },
): Promise<CsBranchDiff> {
  const res = await csFetch(`${repoPath(repoId)}/branches/diff`, {
    scopes: ["git:read"],
    repo: repoId,
    query: { branch: head, base, path: opts?.paths },
  });
  return (await res.json()) as CsBranchDiff;
}

/** GET /repos/{repo}/file (git:read). Returns the blob as UTF-8 text. */
export async function getFile(
  repoId: string,
  path: string,
  opts?: { ref?: string },
): Promise<string> {
  const res = await csFetch(`${repoPath(repoId)}/file`, {
    scopes: ["git:read"],
    repo: repoId,
    query: { path, ref: opts?.ref },
  });
  return await res.text();
}
