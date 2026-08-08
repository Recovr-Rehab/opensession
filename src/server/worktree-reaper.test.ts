import { describe, expect, it } from "bun:test";
import { idleSessionWorktrees, type WorktreeActivitySession } from "./worktree-reaper";

const NOW = Date.parse("2026-08-08T12:00:00Z");
const CUTOFF = NOW - 7 * 86_400_000;

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
