import { describe, expect, test } from "bun:test";
import type { UnifiedSession } from "./types";
import {
	collapsePrLinkSessions,
	prLinksMatch,
	sessionHasPr,
	sessionPrApproved,
	sessionPrMerged,
	sessionPrPresentation,
	sessionUsesPrLink,
} from "./session-prs";

function session(overrides: Partial<UnifiedSession>): UnifiedSession {
	return {
		id: "bks-test",
		claudeSessionId: null,
		source: "opensession",
		branch: "feature",
		worktreeDir: "/tmp/feature",
		startedBy: "test",
		title: "Test",
		lastActivity: "2026-07-28T00:00:00Z",
		createdAt: "2026-07-28T00:00:00Z",
		isRunning: false,
		transcriptPath: null,
		...overrides,
	};
}

describe("session PR lifecycle", () => {
	test("ignores attached branches that have no pull request", () => {
		const value = session({
			prState: "MERGED",
			prs: [
				{
					repo: "tella-fusion",
					branch: "feature",
					source: "primary",
					number: 5016,
					state: "MERGED",
				},
				{
					repo: "shared-infra",
					branch: "infra-feature",
					source: "attached",
				},
			],
		});

		expect(sessionPrMerged(value)).toBe(true);
		expect(sessionPrApproved(value)).toBe(true);
	});

	test("keeps a multi-PR session unfinished while an actual PR is open", () => {
		const value = session({
			prs: [
				{
					repo: "tella-fusion",
					branch: "feature",
					source: "primary",
					number: 1,
					state: "MERGED",
				},
				{
					repo: "shared-infra",
					branch: "infra-feature",
					source: "attached",
					number: 2,
					state: "OPEN",
				},
			],
		});

		expect(sessionPrMerged(value)).toBe(false);
		expect(sessionPrApproved(value)).toBe(false);
	});

	test("keeps a known PR with unknown state unfinished", () => {
		const value = session({
			prState: "MERGED",
			prs: [
				{
					repo: "tella-fusion",
					branch: "feature",
					source: "primary",
					number: 1,
					state: "MERGED",
				},
				{
					repo: "shared-infra",
					branch: "infra-feature",
					source: "linked",
					number: 2,
				},
			],
		});

		expect(sessionPrMerged(value)).toBe(false);
		expect(sessionPrApproved(value)).toBe(false);
	});

	test("keeps a bare explicit PR link unfinished", () => {
		const value = session({
			prState: "MERGED",
			prs: [
				{
					repo: "tella-fusion",
					branch: "feature",
					source: "primary",
					number: 1,
					state: "MERGED",
				},
				{
					repo: "shared-infra",
					branch: "infra-feature",
					source: "linked",
				},
			],
		});

		expect(sessionPrMerged(value)).toBe(false);
		expect(sessionPrApproved(value)).toBe(false);
	});
});

describe("session PR presentation", () => {
	test("promotes a sole linked PR when the session branch has no PR", () => {
		const linked = {
			repo: "tella-fusion",
			branch: "i-want-to-add-a-browse",
			source: "linked" as const,
			number: 5426,
			url: "https://github.com/tellahq/tella-fusion/pull/5426",
		};

		expect(sessionPrPresentation([linked])).toEqual({
			primary: linked,
			additional: [],
		});
	});

	test("keeps multiple linked PRs in the additional stack", () => {
		const linked = [
			{
				repo: "tella-fusion",
				branch: "feature-one",
				source: "linked" as const,
				number: 1,
			},
			{
				repo: "shared-infra",
				branch: "feature-two",
				source: "linked" as const,
				number: 2,
			},
		];

		expect(sessionPrPresentation(linked)).toEqual({ additional: linked });
	});

	test("keeps a branch-derived PR primary when additional PRs exist", () => {
		const primary = {
			repo: "tella-fusion",
			branch: "feature",
			source: "primary" as const,
			number: 1,
		};
		const linked = {
			repo: "shared-infra",
			branch: "infra-feature",
			source: "linked" as const,
			number: 2,
		};

		expect(sessionPrPresentation([primary, linked])).toEqual({
			primary,
			additional: [linked],
		});
	});
});

describe("sessionHasPr", () => {
	test("counts a PR opened on a branch the session doesn't own", () => {
		expect(
			sessionHasPr(
				session({
					branch: undefined,
					worktreeDir: undefined,
					prs: [
						{
							repo: "tella-fusion",
							branch: "someone-elses-branch",
							source: "discovered",
							number: 5548,
							state: "OPEN",
						},
					],
				}),
			),
		).toBe(true);
	});

	test("a bare attached branch is not a PR", () => {
		expect(
			sessionHasPr(
				session({
					prs: [
						{ repo: "shared-infra", branch: "infra-feature", source: "attached" },
					],
				}),
			),
		).toBe(false);
	});

	test("a session with no PR at all", () => {
		expect(sessionHasPr(session({}))).toBe(false);
	});
});

describe("PR link search", () => {
	test("represents a PR-backed workspace with its human session", () => {
		const human = session({
			id: "human",
			workspaceId: "ws-1",
			claudeSessionId: "human-run",
			createdAt: "2026-08-01T00:00:00Z",
			lastActivity: "2026-08-02T00:00:00Z",
		});
		const review = session({
			id: "review",
			workspaceId: "ws-1",
			automation: "github-pr-review",
			claudeSessionId: "review-run",
			createdAt: "2026-08-02T00:00:00Z",
			lastActivity: "2026-08-03T00:00:00Z",
		});

		expect(collapsePrLinkSessions([review, human])).toEqual([human]);
	});

	test("keeps matches from separate workspaces", () => {
		const first = session({ id: "first", workspaceId: "ws-1" });
		const second = session({ id: "second", workspaceId: "ws-2" });

		expect(collapsePrLinkSessions([first, second])).toEqual([first, second]);
	});

	test("matches a primary PR from a pasted GitHub tab URL", () => {
		const value = session({
			prUrl: "https://github.com/tellahq/tella-fusion/pull/5513",
		});

		expect(
			sessionUsesPrLink(
				value,
				"https://github.com/tellahq/tella-fusion/pull/5513/files?diff=split",
			),
		).toBe(true);
	});

	test("matches additional and manually linked PRs", () => {
		const value = session({
			prs: [
				{
					repo: "shared-infra",
					branch: "infra-feature",
					source: "attached",
					number: 126,
					url: "https://github.com/tellahq/shared-infra/pull/126",
				},
			],
			linkedPrs: [
				{
					repo: "tella-mac",
					branch: "desktop-feature",
					url: "https://github.com/tellahq/tella-mac/pull/22",
				},
			],
		});

		expect(sessionUsesPrLink(value, "https://github.com/tellahq/shared-infra/pull/126")).toBe(true);
		expect(sessionUsesPrLink(value, "https://github.com/tellahq/tella-mac/pull/22/")).toBe(true);
		expect(sessionUsesPrLink(value, "https://github.com/tellahq/tella-mac/pull/23")).toBe(false);
	});

	test("matches an associated PR whose cached URL is missing", () => {
		const value = session({
			prs: [
				{
					repo: "shared-infra",
					branch: "infra-feature",
					source: "discovered",
					number: 126,
				},
			],
		});

		expect(
			sessionUsesPrLink(
				value,
				"https://github.com/tellahq/shared-infra/pull/126",
			),
		).toBe(true);
	});

	test("matches the pull request row for the same normalized URL", () => {
		expect(
			prLinksMatch(
				"https://github.com/tellahq/tella-fusion/pull/5513/checks",
				"https://github.com/tellahq/tella-fusion/pull/5513",
			),
		).toBe(true);
	});
});
