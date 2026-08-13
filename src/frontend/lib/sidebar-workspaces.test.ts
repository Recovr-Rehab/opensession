import { describe, expect, test } from "bun:test";
import {
	isAskWorkspace,
	isScratchWorkspace,
	spawnedSessionBelongsInSidebar,
	workspaceRowOwnsSession,
} from "./sidebar-workspaces";

describe("isScratchWorkspace", () => {
	test("recognizes a workspace containing scratch sessions", () => {
		expect(isScratchWorkspace([{ mode: "scratch" }, { mode: "scratch" }])).toBe(
			true,
		);
	});

	test("does not treat repo-backed or empty workspaces as scratch", () => {
		expect(isScratchWorkspace([{ mode: "scratch" }, { mode: "code" }])).toBe(
			false,
		);
		expect(isScratchWorkspace([])).toBe(false);
	});
});

describe("isAskWorkspace", () => {
	test("recognizes a workspace of repo-less ask sessions", () => {
		expect(
			isAskWorkspace([
				{ mode: "ask", repoLess: true },
				{ mode: "ask", repoLess: true },
			]),
		).toBe(true);
	});

	test("a repo-scoped ask session stays in its repo's band", () => {
		// The regression this guards: thousands of older ask sessions record no
		// repo yet sit in a real checkout, so a `!repo` test would empty every
		// project band into the Ask band. Only the stored decision counts.
		expect(isAskWorkspace([{ mode: "ask" }])).toBe(false);
		expect(isAskWorkspace([{ mode: "ask", repoLess: false }])).toBe(false);
	});

	test("scratch is repo-less but is not Ask", () => {
		expect(isAskWorkspace([{ mode: "scratch", repoLess: true }])).toBe(false);
	});

	test("a mixed or empty workspace is not an Ask workspace", () => {
		expect(
			isAskWorkspace([
				{ mode: "ask", repoLess: true },
				{ mode: "code" },
			]),
		).toBe(false);
		expect(isAskWorkspace([])).toBe(false);
	});
});

describe("spawnedSessionBelongsInSidebar", () => {
	test("keeps an unclaimed spawned deep link out of the sidebar", () => {
		expect(spawnedSessionBelongsInSidebar({ spawnedBy: "parent" }, false, false)).toBe(
			false,
		);
	});

	test("includes spawned sessions that need attention or were claimed", () => {
		const session = { spawnedBy: "parent" };
		expect(spawnedSessionBelongsInSidebar(session, true, false)).toBe(true);
		expect(spawnedSessionBelongsInSidebar(session, false, true)).toBe(true);
	});
});

describe("workspaceRowOwnsSession", () => {
	test("selects the parent workspace for an automation tab", () => {
		expect(
			workspaceRowOwnsSession(
				{ key: "workspace:ws-1", workspace: { id: "ws-1" }, sessions: [{ id: "main" }] },
				{ id: "automation", workspaceId: "ws-1", worktreeDir: "/tmp/worktree" },
			),
		).toBe(true);
	});

	test("selects a standalone shared-worktree parent", () => {
		expect(
			workspaceRowOwnsSession(
				{ key: "wt:/tmp/worktree", workspace: null, sessions: [{ id: "main" }] },
				{ id: "automation", workspaceId: null, worktreeDir: "/tmp/worktree" },
			),
		).toBe(true);
	});

	test("does not select an unrelated workspace", () => {
		expect(
			workspaceRowOwnsSession(
				{ key: "workspace:ws-2", workspace: { id: "ws-2" }, sessions: [{ id: "other" }] },
				{ id: "automation", workspaceId: "ws-1", worktreeDir: "/tmp/worktree" },
			),
		).toBe(false);
	});
});
