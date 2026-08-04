/**
 * Server-side repository setup — part of the /api/setup family (dispatched
 * from setup.ts):
 *
 *   GET  /api/setup/github/repos  — repos the instance's GitHub credential can
 *                                   see, for the registration picker.
 *   POST /api/setup/repos         — clone `owner/name` and register it in
 *                                   config.repos (generalizes the desktop-only
 *                                   flow in local-repos.ts to server installs).
 *
 * The desktop-only `GET/POST /api/repos` routes and their isLocalProfile()
 * fence are untouched — this is the server path.
 */

import { existsSync, mkdirSync, rmSync } from "fs";
import { audit } from "../audit";
import { configuredRepos, type RepoSection } from "../config";
import {
  persistRawConfig,
  rawConfig,
  withConfigMutationLock,
} from "../config-mutation";
import { githubCredentialForLogin } from "../github-auth";
import { homeDir } from "../paths";
import { isLocalProfile, localProfileRoot } from "../profile";
import { fetchWithTimeout } from "../shared/fetch-with-timeout";
import type { RouteContext } from "./context";
import { inspectRepo, localRepoId } from "./local-repos";

/** Strict: this value reaches a spawn argv (always array-spawned, never a
 *  shell string — the regex is belt AND suspenders). */
export const GITHUB_FULL_NAME_RE = /^[\w.-]+\/[\w.-]+$/;

export function validGithubFullName(value: unknown): value is string {
  return typeof value === "string" && GITHUB_FULL_NAME_RE.test(value);
}

// ── GitHub repo listing ──────────────────────────────────────────────────────

interface PickerRepo {
  fullName: string;
  private: boolean;
  description?: string;
  defaultBranch: string;
  registered: boolean;
  /** For pushed_at-desc sorting; stripped before responding. */
  pushedAt?: string;
}

const REPO_LIST_CAP = 300;
const REPO_CACHE_TTL_MS = 60_000;

/** 60s in-module cache keyed by credential principal, to keep the picker
 *  snappy across the setup page's refetches. */
const repoListCache = new Map<
  string,
  { at: number; payload: { source: "user" | "bot"; repos: PickerRepo[] } }
>();

async function githubJson(
  token: string,
  url: string,
): Promise<{ ok: boolean; status: number; body: any }> {
  const res = await fetchWithTimeout(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "opensession",
    },
  });
  return { ok: res.ok, status: res.status, body: await res.json().catch(() => null) };
}

function toPickerRepo(r: any, registeredNames: Set<string>): PickerRepo | null {
  const fullName = typeof r?.full_name === "string" ? r.full_name : null;
  if (!fullName) return null;
  return {
    fullName,
    private: r.private === true,
    ...(typeof r.description === "string" && r.description
      ? { description: r.description }
      : {}),
    defaultBranch: typeof r.default_branch === "string" ? r.default_branch : "main",
    registered: registeredNames.has(fullName.toLowerCase()),
    ...(typeof r.pushed_at === "string" ? { pushedAt: r.pushed_at } : {}),
  };
}

/** Registered ghRepo names, lowercased, for the picker's `registered` flag. */
function registeredGhRepos(): Set<string> {
  return new Set(
    Object.values(configuredRepos())
      .map((r) => r.ghRepo.toLowerCase())
      .filter(Boolean),
  );
}

/** PAT path: everything the token's user owns or is an org member of. */
async function listReposViaUserRepos(token: string): Promise<PickerRepo[]> {
  const registered = registeredGhRepos();
  const repos: PickerRepo[] = [];
  for (let page = 1; repos.length < REPO_LIST_CAP && page <= 5; page++) {
    const { ok, body } = await githubJson(
      token,
      `https://api.github.com/user/repos?per_page=100&affiliation=owner,organization_member&sort=pushed&page=${page}`,
    );
    if (!ok || !Array.isArray(body)) break;
    for (const r of body) {
      const repo = toPickerRepo(r, registered);
      if (repo) repos.push(repo);
    }
    if (body.length < 100) break;
  }
  return repos.slice(0, REPO_LIST_CAP);
}

/** GitHub App user-token path: union of the token's accessible installations.
 *  Returns null when the token isn't installation-scoped (classic OAuth/PAT)
 *  so the caller can fall back to /user/repos. */
async function listReposViaInstallations(token: string): Promise<PickerRepo[] | null> {
  const installations = await githubJson(
    token,
    "https://api.github.com/user/installations?per_page=100",
  );
  const list = installations.body?.installations;
  if (!installations.ok || !Array.isArray(list)) return null;
  const registered = registeredGhRepos();
  const repos: PickerRepo[] = [];
  for (const installation of list) {
    const id = installation?.id;
    if (typeof id !== "number") continue;
    for (let page = 1; repos.length < REPO_LIST_CAP && page <= 5; page++) {
      const { ok, body } = await githubJson(
        token,
        `https://api.github.com/user/installations/${id}/repositories?per_page=100&page=${page}`,
      );
      if (!ok || !Array.isArray(body?.repositories)) break;
      for (const r of body.repositories) {
        const repo = toPickerRepo(r, registered);
        if (repo) repos.push(repo);
      }
      if (body.repositories.length < 100) break;
    }
    if (repos.length >= REPO_LIST_CAP) break;
  }
  return repos.slice(0, REPO_LIST_CAP);
}

// ── Server-side clone + register ─────────────────────────────────────────────

async function runCommand(
  argv: string[],
  timeoutMs: number,
): Promise<{ exitCode: number; stderr: string }> {
  const proc = Bun.spawn(argv, {
    env: {
      ...process.env,
      GIT_SSH_COMMAND:
        process.env.GIT_SSH_COMMAND ||
        "ssh -o ConnectTimeout=20 -o ServerAliveInterval=10 -o ServerAliveCountMax=3",
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const timeout = setTimeout(() => proc.kill(9), timeoutMs);
  const [exitCode, stderr] = await Promise.all([
    proc.exited.finally(() => clearTimeout(timeout)),
    new Response(proc.stderr).text(),
  ]);
  return { exitCode, stderr: stderr.trim() };
}

/** Prefer `gh repo clone` (brings its own auth, leaves a clean tokenless
 *  remote); fall back to plain https `git clone`. NEVER embeds a credential
 *  in the persisted remote URL. Both paths get the full https URL (never the
 *  bare owner/name) so a `-`-prefixed name can't be parsed as a CLI flag. */
async function cloneGithubRepo(fullName: string, dest: string): Promise<void> {
  const url = `https://github.com/${fullName}.git`;
  const argv = Bun.which("gh")
    ? ["gh", "repo", "clone", url, dest]
    : ["git", "clone", "--", url, dest];
  const result = await runCommand(argv, 5 * 60_000);
  if (result.exitCode !== 0) {
    throw new Error(result.stderr || `${argv[0]} clone failed`);
  }
}

function checkoutsRoot(): string {
  return isLocalProfile()
    ? `${localProfileRoot()}/repos`
    : `${homeDir()}/checkouts`;
}

async function registerGithubRepo(input: {
  fullName: string;
  id?: string;
}): Promise<RepoSection & { id: string }> {
  const name = input.fullName.split("/")[1];
  const id = localRepoId(input.id?.trim() || name);
  if (configuredRepos()[id]) {
    const err = new Error(`Repository id already registered: ${id}`);
    (err as any).status = 409;
    throw err;
  }
  const root = checkoutsRoot();
  const dest = `${root}/${id}`;
  if (existsSync(dest)) {
    throw new Error(`Clone destination already exists: ${dest}`);
  }
  mkdirSync(root, { recursive: true });
  try {
    await cloneGithubRepo(input.fullName, dest);
    const inspected = await inspectRepo(dest);
    const config = rawConfig();
    const repos = {
      ...((config.repos && typeof config.repos === "object" && !Array.isArray(config.repos)
        ? config.repos
        : {}) as Record<string, RepoSection>),
    };
    const entry: RepoSection = {
      label: name,
      repo: inspected.path,
      wtPrefix: id,
      defaultBranch: inspected.defaultBranch,
      ghRepo: inspected.ghRepo || input.fullName,
      ...(Object.keys(configuredRepos()).length === 0 ? { default: true } : {}),
    };
    repos[id] = entry;
    config.repos = repos;
    persistRawConfig(config);
    audit({ kind: "setup_repo_register", repo: input.fullName, id, path: inspected.path });
    return { id, ...entry };
  } catch (error) {
    rmSync(dest, { recursive: true, force: true });
    throw error;
  }
}

// ── Routes ───────────────────────────────────────────────────────────────────

export async function handleSetupRepoRoutes(
  ctx: RouteContext,
): Promise<Response | undefined> {
  const { req, path } = ctx;

  if (path === "/backstage/api/setup/github/repos" && req.method === "GET") {
    // Credential preference: the signed-in user's stored GitHub token, else
    // the bot PAT, else an empty (but well-formed) answer.
    const userCredential = ctx.authUser?.login
      ? githubCredentialForLogin(ctx.authUser.login)
      : null;
    const token = userCredential?.env.GH_TOKEN || process.env.GITHUB_API_TOKEN;
    const source: "user" | "bot" | null = userCredential
      ? "user"
      : process.env.GITHUB_API_TOKEN
        ? "bot"
        : null;
    if (!token || !source) {
      return Response.json({ source: null, repos: [] });
    }
    const cacheKey = userCredential ? userCredential.principal : "bot";
    const cached = repoListCache.get(cacheKey);
    if (cached && Date.now() - cached.at < REPO_CACHE_TTL_MS) {
      return Response.json(cached.payload);
    }
    try {
      // App user tokens list via installations; anything else (PAT, classic
      // OAuth) via /user/repos. The installations call itself tells us which
      // kind we have — a non-App token gets an error and we fall back.
      const repos =
        (source === "user" ? await listReposViaInstallations(token) : null) ??
        (await listReposViaUserRepos(token));
      repos.sort((a, b) => (b.pushedAt || "").localeCompare(a.pushedAt || ""));
      const payload = {
        source,
        repos: repos.map(({ pushedAt: _pushedAt, ...repo }) => repo),
      };
      repoListCache.set(cacheKey, { at: Date.now(), payload });
      return Response.json(payload);
    } catch (e) {
      return Response.json(
        { error: e instanceof Error ? e.message : String(e) },
        { status: 502 },
      );
    }
  }

  if (path === "/backstage/api/setup/repos" && req.method === "POST") {
    const body = (await req.json().catch(() => null)) as {
      fullName?: unknown;
      id?: unknown;
    } | null;
    if (!validGithubFullName(body?.fullName)) {
      return Response.json(
        { error: "fullName must be a GitHub owner/name" },
        { status: 400 },
      );
    }
    if (body?.id !== undefined && (typeof body.id !== "string" || !body.id.trim())) {
      return Response.json({ error: "id must be a non-empty string" }, { status: 400 });
    }
    try {
      const repo = await withConfigMutationLock(() =>
        registerGithubRepo({
          fullName: body!.fullName as string,
          ...(typeof body!.id === "string" ? { id: body!.id } : {}),
        }),
      );
      return Response.json(repo, { status: 201 });
    } catch (e) {
      const status = (e as any)?.status === 409 ? 409 : 400;
      return Response.json(
        { error: e instanceof Error ? e.message : String(e) },
        { status },
      );
    }
  }

  return undefined;
}
