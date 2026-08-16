import { describe, expect, test } from "bun:test";
import { resolveSessionRepoContext, resolveWorktreeTarget } from "./session-repos";
import { getRepo } from "./worktree";

const session = {
	repo: "opensession",
	worktreeDir: "/home/ubuntu/projects/opensession",
	branch: "master",
	attachedRepos: [
		{
			repo: "tella-fusion",
			dir: "/home/ubuntu/worktrees/tella-fusion-task",
			branch: "task",
		},
		{
			repo: "infra",
			dir: "/home/ubuntu/worktrees/infra-task",
			branch: "task",
		},
	],
};

describe("resolveSessionRepoContext", () => {
	test("defaults to the primary repo", () => {
		expect(resolveSessionRepoContext(session)?.repo).toBe("opensession");
	});

	test("selects an attached repo explicitly", () => {
		expect(resolveSessionRepoContext(session, "tella-fusion")).toEqual({
			repo: "tella-fusion",
			dir: "/home/ubuntu/worktrees/tella-fusion-task",
			branch: "task",
			primary: false,
		});
	});

	test("infers exactly one attached worktree from a delegated prompt", () => {
		const resolved = resolveSessionRepoContext(
			session,
			undefined,
			"Review the changes in /home/ubuntu/worktrees/tella-fusion-task and report findings.",
		);
		expect(resolved?.repo).toBe("tella-fusion");
	});

	test("keeps the primary when a prompt is ambiguous", () => {
		const resolved = resolveSessionRepoContext(
			session,
			undefined,
			"Compare /home/ubuntu/worktrees/tella-fusion-task with /home/ubuntu/worktrees/infra-task.",
		);
		expect(resolved?.repo).toBe("opensession");
	});

	test("rejects an explicit repo the parent does not carry", () => {
		expect(resolveSessionRepoContext(session, "gitops")).toBeNull();
	});
});

describe("resolveWorktreeTarget", () => {
	const hostDir = process.cwd();
	const target = {
		repo: "opensession",
		worktreeDir: hostDir,
		attachedRepos: [
			{ repo: "tella-fusion", dir: "/home/ubuntu/worktrees/gone", branch: "task" },
		],
	};

	test("resolves the primary worktree by default", () => {
		expect(resolveWorktreeTarget(target)).toEqual({
			repoId: "opensession",
			dir: hostDir,
			primary: true,
			defaultBranch: getRepo("opensession").defaultBranch,
			reachable: true,
		});
	});

	test("resolves an attached repo by id, unreachable when its dir is gone", () => {
		const attached = resolveWorktreeTarget(target, "tella-fusion");
		expect(attached?.dir).toBe("/home/ubuntu/worktrees/gone");
		expect(attached?.primary).toBe(false);
		expect(attached?.reachable).toBe(false);
	});

	test("returns null for a repo the session does not carry", () => {
		expect(resolveWorktreeTarget(target, "gitops")).toBeNull();
	});

	test("counts a volume-mode primary workspace with no host dir as reachable", () => {
		const volume = {
			repo: "opensession",
			worktreeDir: "/workspace/opensession",
			sandbox: { workspace: "volume" },
			attachedRepos: target.attachedRepos,
		};
		expect(resolveWorktreeTarget(volume)?.reachable).toBe(true);
		// The remote exception is the primary repo's only: attached repos are
		// always host worktrees.
		expect(resolveWorktreeTarget(volume, "tella-fusion")?.reachable).toBe(false);
	});

	test("returns null for a scratch session with no worktree", () => {
		expect(resolveWorktreeTarget({ repo: "opensession", worktreeDir: null })).toBeNull();
	});

	test("infers the repo id from the worktree path when the session has none", () => {
		const resolved = resolveWorktreeTarget({ worktreeDir: hostDir });
		expect(resolved?.repoId).toBe("opensession");
		expect(resolved?.primary).toBe(true);
	});
});
