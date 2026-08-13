import { describe, expect, it } from "bun:test";
import {
	activeSessionWorktrees,
	idleSessionWorktrees,
	type WorktreeActivitySession,
} from "./worktree-reaper";

const NOW = Date.parse("2026-08-08T12:00:00Z");
const CUTOFF = NOW - 7 * 86_400_000;
const ACTIVE_CUTOFF = NOW - 6 * 3_600_000;

function session(
	dir: string,
	opts: Partial<WorktreeActivitySession> = {},
): WorktreeActivitySession {
	return {
		worktreeDir: dir,
		attachedRepos: [],
		lastActivity: "2026-07-31T00:00:00Z",
		isRunning: false,
		...opts,
	};
}

describe("idleSessionWorktrees", () => {
	it("parks a checkout whose owning session is older than the cutoff", () => {
		const idle = idleSessionWorktrees([session("/worktrees/old")], CUTOFF);
		expect(idle.has("/worktrees/old")).toBe(true);
	});

	it("keeps recent and running sessions", () => {
		const idle = idleSessionWorktrees(
			[
				session("/worktrees/recent", {
					lastActivity: "2026-08-08T00:00:00Z",
				}),
				session("/worktrees/running", { isRunning: true }),
			],
			CUTOFF,
		);
		expect(idle.has("/worktrees/recent")).toBe(false);
		expect(idle.has("/worktrees/running")).toBe(false);
	});

	it("lets one recent or running owner protect a shared checkout", () => {
		const idle = idleSessionWorktrees(
			[
				session("/worktrees/shared"),
				session("/worktrees/shared", {
					lastActivity: "2026-08-07T00:00:00Z",
				}),
			],
			CUTOFF,
		);
		expect(idle.has("/worktrees/shared")).toBe(false);
	});

	it("tracks attached repo worktrees", () => {
		const idle = idleSessionWorktrees(
			[
				session("/worktrees/primary", {
					attachedRepos: [
						{ repo: "secondary", branch: "topic", dir: "/worktrees/attached" },
					],
				}),
			],
			CUTOFF,
		);
		expect(idle.has("/worktrees/primary")).toBe(true);
		expect(idle.has("/worktrees/attached")).toBe(true);
	});

	it("fails closed when session activity is malformed", () => {
		const idle = idleSessionWorktrees(
			[session("/worktrees/unknown", { lastActivity: "not-a-date" })],
			CUTOFF,
		);
		expect(idle.has("/worktrees/unknown")).toBe(false);
	});
});

describe("activeSessionWorktrees", () => {
	it("holds a checkout whose session was touched inside the window", () => {
		const active = activeSessionWorktrees(
			[session("/worktrees/live", { lastActivity: "2026-08-08T11:00:00Z" })],
			ACTIVE_CUTOFF,
		);
		expect(active.has("/worktrees/live")).toBe(true);
	});

	it("releases a checkout whose session went quiet before the window", () => {
		const active = activeSessionWorktrees(
			[session("/worktrees/quiet", { lastActivity: "2026-08-08T02:00:00Z" })],
			ACTIVE_CUTOFF,
		);
		expect(active.has("/worktrees/quiet")).toBe(false);
	});

	it("fails closed on running and malformed sessions", () => {
		const active = activeSessionWorktrees(
			[
				session("/worktrees/running", { isRunning: true }),
				session("/worktrees/unknown", { lastActivity: "not-a-date" }),
			],
			ACTIVE_CUTOFF,
		);
		expect(active.has("/worktrees/running")).toBe(true);
		expect(active.has("/worktrees/unknown")).toBe(true);
	});

	it("lets one recent owner hold a shared checkout, and covers attached repos", () => {
		const active = activeSessionWorktrees(
			[
				session("/worktrees/shared"),
				session("/worktrees/shared", {
					lastActivity: "2026-08-08T11:30:00Z",
					attachedRepos: [
						{ repo: "secondary", branch: "topic", dir: "/worktrees/attached" },
					],
				}),
			],
			ACTIVE_CUTOFF,
		);
		expect(active.has("/worktrees/shared")).toBe(true);
		expect(active.has("/worktrees/attached")).toBe(true);
	});

	it("never claims a worktree no session owns", () => {
		const active = activeSessionWorktrees([], ACTIVE_CUTOFF);
		expect(active.has("/worktrees/orphan")).toBe(false);
	});
});
