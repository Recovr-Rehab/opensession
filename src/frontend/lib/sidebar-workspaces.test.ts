import { describe, expect, test } from "bun:test";
import {
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
