import { describe, expect, test } from "bun:test";
import {
	sortActiveByCreation,
	workspaceLifecycle,
	workspaceLifecycleFacts,
	type LifecycleRow,
} from "./sidebar-lifecycle";
import type { UnifiedSession, Workspace } from "./types";

const NOW = Date.parse("2026-08-20T12:00:00.000Z");

function session(
	id: string,
	extra: Partial<UnifiedSession> = {},
): UnifiedSession {
	return {
		id,
		source: "opensession",
		branch: null,
		worktreeDir: null,
		startedBy: "Michiel",
		title: id,
		lastActivity: "2026-08-20T10:00:00.000Z",
		createdAt: "2026-08-20T09:00:00.000Z",
		isRunning: false,
		...extra,
	} as UnifiedSession;
}

function row(
	sessions: UnifiedSession[],
	extra: Partial<LifecycleRow> = {},
): LifecycleRow {
	return {
		key: "workspace:one",
		workspace: {
			id: "one",
			name: "One",
			createdBy: "Michiel",
			createdAt: "2026-08-20T08:00:00.000Z",
		} as Workspace,
		createdAt: sessions[0]?.createdAt ?? "",
		lastActivity: sessions[0]?.lastActivity ?? "",
		running: false,
		status: "pending",
		sessions,
		...extra,
	};
}

const prefs = {
	now: NOW,
	autoSettleDays: 3 as const,
	autoSettlePrs: true,
};

describe("workspace lifecycle", () => {
	test("explicit settle holds until newer work arrives", () => {
		const facts = workspaceLifecycleFacts(row([session("one")]));
		expect(
			workspaceLifecycle(
				facts,
				{ state: "settled", at: "2026-08-20T11:00:00.000Z" },
				prefs,
			),
		).toMatchObject({ settled: true, reason: "explicit" });

		const newer = workspaceLifecycleFacts(
			row([
				session("one", { lastActivity: "2026-08-20T11:30:00.000Z" }),
			]),
		);
		expect(
			workspaceLifecycle(
				newer,
				{ state: "settled", at: "2026-08-20T11:00:00.000Z" },
				prefs,
			).settled,
		).toBe(false);
	});

	test("running, queued and needs-input work stay active", () => {
		for (const blocked of [
			row([session("running", { isRunning: true })], { running: true }),
			row([session("queued", { queuedCount: 1 })]),
			row([session("question", { waitingForInput: true })], {
				status: "needsinput",
			}),
		]) {
			const facts = workspaceLifecycleFacts(blocked);
			expect(
				workspaceLifecycle(
					facts,
					{ state: "settled", at: "2026-08-20T11:00:00.000Z" },
					prefs,
				).settled,
			).toBe(false);
		}
	});

	test("inactivity settles after the configured boundary but an open PR blocks it", () => {
		const stale = session("stale", {
			lastActivity: "2026-08-16T11:59:59.000Z",
		});
		expect(
			workspaceLifecycle(workspaceLifecycleFacts(row([stale])), undefined, prefs),
		).toMatchObject({ settled: true, reason: "inactive" });

		const open = session("open", {
			lastActivity: stale.lastActivity,
			prUrl: "https://github.com/tellahq/app/pull/1",
			prNumber: 1,
			prState: "OPEN",
		});
		expect(
			workspaceLifecycle(workspaceLifecycleFacts(row([open])), undefined, prefs)
				.settled,
		).toBe(false);
	});

	test("unsettle restarts the inactivity window", () => {
		const facts = workspaceLifecycleFacts(
			row([
				session("old", { lastActivity: "2026-08-01T10:00:00.000Z" }),
			]),
		);
		const override = {
			state: "active" as const,
			at: "2026-08-20T11:00:00.000Z",
		};
		expect(workspaceLifecycle(facts, override, prefs).settled).toBe(false);
		expect(
			workspaceLifecycle(facts, override, {
				...prefs,
				now: Date.parse("2026-08-24T11:00:01.000Z"),
			}),
		).toMatchObject({ settled: true, reason: "inactive" });
	});

	test("all known PRs must be terminal and an active override suppresses the same terminal set", () => {
		const merged = session("merged", {
			prUrl: "https://github.com/tellahq/app/pull/1",
			prNumber: 1,
			prState: "MERGED",
			prUpdatedAt: "2026-08-20T11:00:00.000Z",
		});
		const closed = session("closed", {
			prUrl: "https://github.com/tellahq/app/pull/2",
			prNumber: 2,
			prState: "CLOSED",
			prUpdatedAt: "2026-08-20T11:05:00.000Z",
		});
		const facts = workspaceLifecycleFacts(row([merged, closed]));
		expect(workspaceLifecycle(facts, undefined, prefs)).toMatchObject({
			settled: true,
			reason: "pull-request",
		});
		expect(
			workspaceLifecycle(
				facts,
				{
					state: "active",
					at: "2026-08-20T11:10:00.000Z",
					terminalSignature: facts.terminalPrSignature!,
				},
				prefs,
			).settled,
		).toBe(false);

		const withOpen = workspaceLifecycleFacts(
			row([
				merged,
				session("open", {
					prUrl: "https://github.com/tellahq/app/pull/3",
					prNumber: 3,
					prState: "OPEN",
				}),
			]),
		);
		expect(workspaceLifecycle(withOpen, undefined, prefs).settled).toBe(false);
	});

	test("stable Active ordering uses workspace creation and deterministic keys", () => {
		const rows = [
			row([session("old")], {
				key: "workspace:old",
				workspace: {
					id: "old",
					name: "Old",
					createdBy: "Michiel",
					createdAt: "2026-08-18T08:00:00.000Z",
				},
			}),
			row([session("new")], {
				key: "workspace:new",
				workspace: {
					id: "new",
					name: "New",
					createdBy: "Michiel",
					createdAt: "2026-08-20T08:00:00.000Z",
				},
			}),
		];
		const facts = new Map(
			rows.map((value) => [value.key, workspaceLifecycleFacts(value)]),
		);
		expect(sortActiveByCreation(rows, facts).map((value) => value.key)).toEqual([
			"workspace:new",
			"workspace:old",
		]);
	});
});
