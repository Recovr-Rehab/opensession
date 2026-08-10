/**
 * The `?archived=` slices of GET /api/sessions.
 *
 * Two things are worth pinning here. The variant parse decides whether a
 * client sees the whole list or none of it, and its failure mode is an empty
 * screen rather than an error. And the slim archived row is a CONTRACT with
 * the surfaces that render it — Archived.tsx, the sidebar's archived badge and
 * the tab strip's history menu — so a field quietly dropped from the row shows
 * up as blank text in the UI, not as a type error.
 */

import { describe, expect, test } from "bun:test";
import type { UnifiedSession } from "../types";
import { archivedIndexRow, sessionsVariant } from "./sessions";

function variantOf(query: string) {
	return sessionsVariant(new URL(`http://x/api/sessions${query}`).searchParams);
}

function archivedSession(over: Partial<UnifiedSession> = {}): UnifiedSession {
	return {
		id: "os-019fea32-b27e-7000-9131-0f5484659833",
		claudeSessionId: "ses_1",
		source: "opensession",
		branch: "feature/thing",
		worktreeDir: "/home/ubuntu/worktrees/thing",
		startedBy: "Ada",
		title: "Make the thing faster",
		lastActivity: "2026-08-09T10:05:00.000Z",
		createdAt: "2026-08-09T09:00:00.000Z",
		isRunning: false,
		transcriptPath: "/transcripts/ses_1.jsonl",
		mode: "code",
		repo: "opensession",
		workspaceId: "ws-1",
		archived: true,
		archivedReason: "idle",
		...over,
	};
}

describe("sessionsVariant", () => {
	test("no parameters means the whole list", () => {
		expect(variantOf("")).toBe("include");
	});

	test("an unrecognised value degrades to the whole list, not an empty one", () => {
		expect(variantOf("?archived=yes")).toBe("include");
		expect(variantOf("?archived=")).toBe("include");
		// slim is meaningless without `only`, and must not imply it.
		expect(variantOf("?slim=1")).toBe("include");
	});

	test("exclude and only select their slice", () => {
		expect(variantOf("?archived=exclude")).toBe("exclude");
		expect(variantOf("?archived=only")).toBe("only");
		expect(variantOf("?archived=only&slim=1")).toBe("only-slim");
	});
});

describe("archivedIndexRow", () => {
	test("carries what the Archived surfaces render", () => {
		const row = archivedIndexRow(archivedSession());
		// Archived.tsx renders these; the sidebar badge filters on startedBy
		// and repo; the tab strip's history menu groups on workspaceId or a
		// shared worktreeDir and sorts on lastActivity.
		expect(row).toMatchObject({
			id: "os-019fea32-b27e-7000-9131-0f5484659833",
			title: "Make the thing faster",
			source: "opensession",
			mode: "code",
			startedBy: "Ada",
			lastActivity: "2026-08-09T10:05:00.000Z",
			archivedReason: "idle",
			repo: "opensession",
			workspaceId: "ws-1",
			worktreeDir: "/home/ubuntu/worktrees/thing",
		});
	});

	test("is archived by construction, so client filters still match", () => {
		// The row only ever comes from the archived slice, and the clients that
		// merge it into their session list filter on `archived`.
		expect(archivedIndexRow(archivedSession()).archived).toBe(true);
	});

	test("drops the weight nobody reads on those surfaces", () => {
		const row = archivedIndexRow(
			archivedSession({
				walkthrough: { title: "Demo", body: "x".repeat(400) } as never,
				prs: [{ repo: "opensession", branch: "feature/thing" }] as never,
				prTitle: "Make the thing faster",
				attachedRepos: [{ project: "tella-fusion" }] as never,
			}),
		);
		for (const fat of ["walkthrough", "prs", "prTitle", "attachedRepos"])
			expect(row).not.toHaveProperty(fat);
	});

	test("omits absent fields rather than spending bytes on nulls", () => {
		const row = archivedIndexRow(
			archivedSession({
				startedBy: null,
				mode: undefined,
				repo: undefined,
				workspaceId: null,
				worktreeDir: null,
				archivedReason: undefined,
			}),
		);
		for (const absent of [
			"startedBy",
			"mode",
			"repo",
			"workspaceId",
			"worktreeDir",
			"archivedReason",
		])
			expect(row).not.toHaveProperty(absent);
	});

	test("keeps the first external ref's kind, which is the repo fallback", () => {
		// sessionRepo() files a repo-less feed session under its feed rather
		// than the default repo — the kind is the whole reason it can.
		const row = archivedIndexRow(
			archivedSession({
				repo: undefined,
				externalRefs: [
					{ kind: "tella-video", id: "vid_1" },
					{ kind: "plain", id: "th_1" },
				] as never,
			}),
		);
		expect(row.externalRefs).toEqual([{ kind: "tella-video" }]);
	});

	test("carries alias ids so a link naming an old id still resolves", () => {
		const row = archivedIndexRow(
			archivedSession({ aliasIds: ["bks-019f0000-0000-7000-0000-000000000000"] }),
		);
		expect(row.aliasIds).toEqual([
			"bks-019f0000-0000-7000-0000-000000000000",
		]);
	});
});
