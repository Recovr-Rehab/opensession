import { describe, expect, it } from "bun:test";
import { buildFeedRows } from "./feed-rows";
import type { WorktreeRow } from "./pr-rows";
import type { RecentCommit } from "./api";

const pr = (over: Partial<WorktreeRow> = {}): WorktreeRow => ({
	key: "https://github.com/tellahq/tella-fusion/pull/12",
	title: "Export presets",
	repo: "tella-fusion",
	branch: "presets",
	url: "https://github.com/tellahq/tella-fusion/pull/12",
	state: "MERGED",
	number: 12,
	updatedAt: "2026-08-14T09:00:00Z",
	archived: false,
	person: "kent",
	...over,
});

const commit = (over: Partial<RecentCommit> = {}): RecentCommit => ({
	repo: "opensession",
	sha: "a1b2c3d4e5f6",
	title: "Feed: show what shipped without a PR",
	url: "https://github.com/tellahq/opensession/commit/a1b2c3d4e5f6",
	author: "Kent de Bruin",
	person: "kent",
	committedAt: "2026-08-14T10:00:00Z",
	additions: 40,
	deletions: 3,
	...over,
});

describe("buildFeedRows", () => {
	it("sorts merges and commits together, newest first", () => {
		const rows = buildFeedRows(
			[pr({ updatedAt: "2026-08-14T11:00:00Z", key: "later-pr", number: 13 }), pr()],
			[commit()],
		);
		expect(rows.map((row) => row.kind)).toEqual(["pr", "commit", "pr"]);
	});

	it("names a PR by number and a commit by short sha", () => {
		const [commitRow, prRow] = buildFeedRows([pr()], [commit()]).sort((a, b) =>
			a.kind.localeCompare(b.kind),
		);
		expect(commitRow.ref).toBe("a1b2c3d");
		expect(prRow.ref).toBe("#12");
	});

	it("keeps the workspace behind a merge so the row can open it", () => {
		const session = { id: "os-1" } as any;
		const [row] = buildFeedRows([pr({ session })], []);
		expect(row.session).toBe(session);
	});

	it("keys a commit by repo and sha, so two repos can't collide", () => {
		const rows = buildFeedRows([], [commit(), commit({ repo: "other" })]);
		expect(new Set(rows.map((row) => row.key)).size).toBe(2);
	});
});
