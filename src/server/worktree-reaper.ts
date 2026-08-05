/**
 * Worktree reaper — removes worktrees whose work is already merged (or whose
 * PR is closed), and sweeps husks left behind by earlier failed removals.
 *
 * In-process port (2026-08-05) of the external `cleanup-closed-worktrees`
 * cron, generalized over every registered repo. The worktree-hygiene family:
 *  - sweepArchivedWorktrees (worktree.ts): session-driven — archived 14d+.
 *  - disk-gc.ts: reclaims rust target/ caches from worktrees we KEEP.
 *  - this module: git-driven — the branch's work is done, the tree is gone.
 *
 * Lessons inherited from the cron (see its history, kept here so they never
 * regress):
 *  - Remove via the worktree's OWNING repo, read from its .git pointer — a
 *    fixed `git -C <main>` targeted the wrong checkout and no-oped.
 *  - Primary done-signal is "tip is an ancestor of origin/<defaultBranch>"
 *    (git-local, catches zero-commit trees); PR state (merged/closed) is the
 *    fallback that catches squash-merges, where the tip is never an ancestor.
 *  - cargo/wasm target/ files can be root-owned (built in docker), so plain
 *    rm fails half-way and leaves corpses — sudo fallback, plus the husk
 *    sweep for corpses already on disk.
 *
 * SAFETY (never destroy real work):
 *  - Independent clones (a real .git DIRECTORY) are skipped outright — only
 *    git-worktrees (.git FILE) are managed.
 *  - Uncommitted changes or commits on no remote ref → skip (2026-07-02:
 *    a merged branch's worktree held uncommitted follow-up work and a forced
 *    removal wiped it).
 *  - A worktree that is the cwd of ANY live process is spared — unlike
 *    disk-gc's build-only check, because removing the whole tree breaks even
 *    a passive session process sitting in it.
 *  - Husks are only swept when no nested repo inside has dirty/unpushed work.
 */

import {
	type Dirent,
	existsSync,
	readdirSync,
	readFileSync,
	readlinkSync,
	statSync,
} from "node:fs";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { $ } from "bun";
import { githubRequest } from "../agents/github/github-rest";
import { audit } from "./audit";
import type { Repo } from "./config";
import { configuredPaths, configuredServer } from "./config";
import { stopPreview } from "./preview";
import { canonicalPath, REPOS } from "./worktree";

const worktreesDir = () => configuredPaths().worktreesDir;

const MINUTE = 60_000;
const SWEEP_INTERVAL_MS = 60 * MINUTE;
const FIRST_SWEEP_DELAY_MS = 10 * MINUTE; // staggered after disk-gc's 5m

/** Infrastructure worktrees, never session trees (same set as disk-gc). */
const PROTECTED_SUFFIXES = ["-warm-template", "-ask-checkout"];

export interface ReapResult {
	removed: string[];
	husksSwept: string[];
	skipped: {
		inUse: number;
		dirty: number;
		unpushed: number;
		huskWithWork: number;
	};
}

/** Worktree dirs that are the cwd of ANY live process. Null = /proc unreadable
 *  (non-Linux) — callers must skip the sweep rather than guess. */
function worktreesWithProcesses(root: string): Set<string> | null {
	let pids: string[];
	try {
		pids = readdirSync("/proc").filter((p) => /^\d+$/.test(p));
	} catch {
		return null;
	}
	const inUse = new Set<string>();
	const prefix = `${root}/`;
	for (const pid of pids) {
		let cwd: string;
		try {
			cwd = readlinkSync(`/proc/${pid}/cwd`);
		} catch {
			continue;
		}
		if (!cwd.startsWith(prefix)) continue;
		const name = cwd.slice(prefix.length).split("/")[0];
		if (name) inUse.add(join(root, name));
	}
	return inUse;
}

/** The registered repo owning this worktree, from its .git pointer. */
function ownerRepo(dir: string): { repo: Repo; gitdir: string } | null {
	let pointer: string;
	try {
		pointer = readFileSync(join(dir, ".git"), "utf8");
	} catch {
		return null;
	}
	const gitdir = pointer.replace(/^gitdir:\s*/, "").trim();
	const ownerPath = canonicalPath(gitdir.split("/.git/worktrees/")[0] ?? "");
	for (const repo of Object.values(REPOS)) {
		if (canonicalPath(repo.repo) === ownerPath) return { repo, gitdir };
	}
	return null;
}

/** Negative-result cache for the PR fallback: a parked branch with no
 *  merged/closed PR stays that way for hours, and the sweep runs hourly over
 *  ~hundreds of them — without this every sweep re-asks GitHub about every
 *  parked branch. Positive results act immediately and skip the cache. */
const noPrCache = new Map<string, number>();
const NO_PR_TTL_MS = 6 * 60 * 60_000;

/** PR state fallback for squash-merged branches (tip never becomes an
 *  ancestor). Returns a reap reason, or null when no merged/closed PR. */
async function closedPrReason(
	repo: Repo,
	branch: string,
): Promise<string | null> {
	if (!repo.ghRepo) return null;
	const key = `${repo.ghRepo}#${branch}`;
	const cachedAt = noPrCache.get(key);
	if (cachedAt && Date.now() - cachedAt < NO_PR_TTL_MS) return null;
	const owner = repo.ghRepo.split("/")[0];
	const res = await githubRequest<
		{ number: number; state: string; merged_at: string | null }[]
	>(
		"GET",
		`/repos/${repo.ghRepo}/pulls?head=${owner}:${encodeURIComponent(branch)}&state=closed&per_page=1`,
	);
	if (!res.ok) return null; // API trouble → no verdict, never a cached one
	const pr = res.data?.[0];
	if (!pr) {
		noPrCache.set(key, Date.now());
		return null;
	}
	return `PR #${pr.number} ${pr.merged_at ? "merged" : "closed"}`;
}

/** Does any real (non-node_modules) git repo inside `dir` hold dirty or
 *  unpushed work? sudo because husk contents can be root-owned. */
async function huskHasWork(dir: string): Promise<boolean> {
	const found =
		await $`sudo find ${dir} -name .git -not -path "*/node_modules/*"`
			.nothrow()
			.text();
	for (const g of found.split("\n").filter(Boolean)) {
		const repoDir = g.replace(/\/\.git$/, "");
		const dirty = await $`sudo git -C ${repoDir} status --porcelain`
			.nothrow()
			.text();
		if (dirty.trim()) return true;
		const unpushed =
			await $`sudo git -C ${repoDir} log --oneline @ --not --remotes`
				.nothrow()
				.text();
		if (unpushed.trim()) return true;
	}
	return false;
}

/** Archive the branch's linked Slack channel via the slack module's webhook
 *  route (its state is closure-local, so the HTTP seam is the interface —
 *  and unlike the old cron, we send the secret it requires). Best-effort. */
async function archiveSlackChannel(slug: string): Promise<void> {
	const secret = process.env.WORKTREE_HOOK_SECRET;
	if (!secret) return;
	try {
		await fetch(
			`http://127.0.0.1:${configuredServer().webhookPort}/worktree/archive-channel`,
			{
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					"x-worktree-secret": secret,
				},
				body: JSON.stringify({ branch: slug }),
				signal: AbortSignal.timeout(10_000),
			},
		);
	} catch {}
}

async function removeDir(repo: Repo, dir: string): Promise<boolean> {
	try {
		await stopPreview(dir);
	} catch {}
	await $`git -C ${repo.repo} worktree remove --force ${dir}`.quiet().nothrow();
	if (existsSync(dir))
		await rm(dir, { recursive: true, force: true }).catch(() => {});
	// Root-owned cargo/wasm build output defeats a plain rm.
	if (existsSync(dir)) await $`sudo rm -rf ${dir}`.nothrow().quiet();
	await $`git -C ${repo.repo} worktree prune`.quiet().nothrow();
	return !existsSync(dir);
}

/** One reaper pass over every directory in the worktrees root. */
export async function sweepWorktreeReaper(
	opts: { dryRun?: boolean } = {},
): Promise<ReapResult> {
	const root = worktreesDir();
	const result: ReapResult = {
		removed: [],
		husksSwept: [],
		skipped: { inUse: 0, dirty: 0, unpushed: 0, huskWithWork: 0 },
	};

	const inUse = worktreesWithProcesses(root);
	if (!inUse) {
		console.warn(
			"[worktree-reaper] cannot read /proc — skipping (never reap without the in-use check)",
		);
		return result;
	}

	let entries: Dirent[];
	try {
		entries = readdirSync(root, { withFileTypes: true }).filter((e) =>
			e.isDirectory(),
		);
	} catch {
		return result;
	}

	const debug = process.env.OPENSESSION_REAPER_DEBUG === "1";
	const fetched = new Set<string>();
	for (const e of entries) {
		// Dotdirs in the worktrees root are infrastructure, not session trees
		// (.warm-spares = the warm-template dep spares, .claude = CLI state).
		if (e.name.startsWith(".")) continue;
		const dir = join(root, e.name);
		if (debug) console.log(`[worktree-reaper] considering ${e.name}`);
		if (PROTECTED_SUFFIXES.some((s) => e.name.endsWith(s))) continue;
		if (inUse.has(dir)) {
			result.skipped.inUse++;
			continue;
		}
		// Independent clone (real .git directory) — never auto-remove.
		let gitEntry: "file" | "dir" | "none" = "none";
		try {
			gitEntry = statSync(join(dir, ".git")).isDirectory() ? "dir" : "file";
		} catch {}
		if (gitEntry === "dir") continue;
		const isWorktreePointer = gitEntry === "file";
		const owner = ownerRepo(dir);
		const gitOk =
			isWorktreePointer &&
			(await $`git -C ${dir} rev-parse --is-inside-work-tree`.quiet().nothrow())
				.exitCode === 0;

		// A healthy worktree of a repo we don't manage (not in the registry) is
		// not ours to reap OR to call a husk — leave it alone entirely.
		if (gitOk && !owner) continue;

		if (!gitOk) {
			// Husk: a corpse from an earlier failed removal (dead .git pointer, or
			// no .git at all). Only swept when it hides no work AND is old enough
			// that nothing is coming back for it — a "husk" can also be a
			// mis-nested but freshly created worktree wrapper (seen 2026-08-05).
			let mtimeMs = 0;
			try {
				mtimeMs = statSync(dir).mtimeMs;
			} catch {}
			if (Date.now() - mtimeMs < 7 * 86_400_000) continue;
			if (await huskHasWork(dir)) {
				result.skipped.huskWithWork++;
				console.log(
					`[worktree-reaper] SKIP husk ${e.name}: nested repo has dirty/unpushed work`,
				);
				continue;
			}
			if (opts.dryRun) {
				console.log(`[worktree-reaper] would sweep husk ${e.name}`);
				result.husksSwept.push(e.name);
				continue;
			}
			await $`sudo rm -rf ${dir}`.nothrow().quiet();
			if (!existsSync(dir)) {
				result.husksSwept.push(e.name);
				console.log(`[worktree-reaper] swept husk ${e.name}`);
				audit({ event: "worktree_reap", dir, kind: "husk" });
			}
			continue;
		}

		if (!owner) continue; // narrowing only — the gitOk && !owner case exited above
		const repo = owner.repo;
		const branch = (
			await $`git -C ${dir} rev-parse --abbrev-ref HEAD`.quiet().nothrow()
		)
			.text()
			.trim();
		if (!branch) continue;

		// Refresh the base ref once per repo so the ancestry test is accurate.
		if (!fetched.has(repo.id)) {
			fetched.add(repo.id);
			await $`git -C ${repo.repo} fetch origin ${repo.defaultBranch} -q`
				.nothrow()
				.quiet();
		}

		let reason: string | null = null;
		const ancestor =
			await $`git -C ${dir} merge-base --is-ancestor HEAD origin/${repo.defaultBranch}`
				.quiet()
				.nothrow();
		if (ancestor.exitCode === 0) reason = `tip in origin/${repo.defaultBranch}`;
		else reason = await closedPrReason(repo, branch);
		if (!reason) continue;

		const dirty = (await $`git -C ${dir} status --porcelain`.quiet().nothrow())
			.text()
			.trim();
		if (dirty) {
			result.skipped.dirty++;
			console.log(
				`[worktree-reaper] SKIP ${e.name} (${reason}): uncommitted changes`,
			);
			continue;
		}
		const unpushed = (
			await $`git -C ${dir} log --oneline HEAD --not --remotes`
				.quiet()
				.nothrow()
		)
			.text()
			.trim();
		if (unpushed) {
			result.skipped.unpushed++;
			console.log(
				`[worktree-reaper] SKIP ${e.name} (${reason}): unpushed commits`,
			);
			continue;
		}

		if (opts.dryRun) {
			console.log(`[worktree-reaper] would reap ${e.name} (${reason})`);
			result.removed.push(e.name);
			continue;
		}

		console.log(`[worktree-reaper] reaping ${e.name} (${reason})`);
		const slug = e.name.startsWith(`${repo.wtPrefix}-`)
			? e.name.slice(repo.wtPrefix.length + 1)
			: branch;
		await archiveSlackChannel(slug);
		await $`tmux kill-session -t ${slug}`.nothrow().quiet();
		if (await removeDir(repo, dir)) {
			result.removed.push(e.name);
			audit({ event: "worktree_reap", dir, branch, repo: repo.id, reason });
		} else {
			console.warn(`[worktree-reaper] could not fully remove ${dir}`);
		}
	}

	if (result.removed.length || result.husksSwept.length) {
		audit({
			event: "worktree_reap_sweep",
			removed: result.removed.length,
			husks: result.husksSwept.length,
			skipped: result.skipped,
		});
		console.log(
			`[worktree-reaper] sweep done: ${result.removed.length} reaped, ` +
				`${result.husksSwept.length} husk(s) swept ` +
				`(skipped: ${result.skipped.inUse} in-use, ${result.skipped.dirty} dirty, ${result.skipped.unpushed} unpushed)`,
		);
	}
	return result;
}

let sweepTimer: ReturnType<typeof setInterval> | null = null;

/** Start the hourly reap. Call once from the __opensessionBooted block. */
export function startWorktreeReaper(): void {
	if (sweepTimer) return;
	if (process.env.OPENSESSION_WORKTREE_REAPER === "0") {
		console.log("[worktree-reaper] disabled (OPENSESSION_WORKTREE_REAPER=0)");
		return;
	}
	const run = () =>
		void sweepWorktreeReaper().catch((e) =>
			console.error("[worktree-reaper] sweep failed:", e),
		);
	setTimeout(run, FIRST_SWEEP_DELAY_MS);
	sweepTimer = setInterval(run, SWEEP_INTERVAL_MS);
	console.log(
		`[worktree-reaper] started (every ${Math.round(SWEEP_INTERVAL_MS / MINUTE)}m)`,
	);
}
