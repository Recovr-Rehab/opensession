import { describe, expect, test } from "bun:test";
import type { UnifiedSession } from "./types";
import type { WsRow } from "./sidebar-types";
import {
	classifySidebarPlacement,
	placeSidebarRows,
	rowsAtPlacement,
	type SidebarPlacement,
} from "./sidebar-placement";

function session(
	id: string,
	overrides: Partial<UnifiedSession> = {},
): UnifiedSession {
	return {
		id,
		startedBy: "Michiel",
		isRunning: false,
		...overrides,
	} as UnifiedSession;
}

function row(
	key: string,
	sessions: UnifiedSession[],
	overrides: Partial<WsRow> = {},
): WsRow {
	return {
		key,
		workspace: null,
		name: key,
		sessions,
		status: "pending",
		lastActivity: "2026-08-16T00:00:00Z",
		createdAt: "2026-08-16T00:00:00Z",
		unread: false,
		running: false,
		owner: "michiel",
		...overrides,
	};
}

const context = {
	currentUser: "Michiel",
	personFilter: "me",
	snoozed: false,
	inStatusScope: true,
};

describe("sidebar row placement", () => {
	test("assigns every row to exactly one primary band", () => {
		const rows = [
			row(
				"snoozed",
				[
					session("snoozed", {
						startedBy: "Kent",
						reviewRequest: {
							to: "Michiel",
							by: "Kent",
							at: "2026-08-16T00:00:00Z",
						},
					}),
				],
				{ owner: "kent" },
			),
			row(
				"needs",
				[
					session("needs", {
						startedBy: "Kent",
						reviewRequest: {
							to: "Michiel",
							by: "Kent",
							at: "2026-08-16T00:00:00Z",
						},
					}),
				],
				{ owner: "kent" },
			),
			row("approved", [
				session("approved", {
					reviewRequest: {
						to: "Kent",
						by: "Michiel",
						at: "2026-08-16T00:00:00Z",
					},
					prReviewDecision: "APPROVED",
				}),
			]),
			row("awaiting", [
				session("awaiting", {
					reviewRequest: {
						to: "Kent",
						by: "Michiel",
						at: "2026-08-16T00:00:00Z",
					},
				}),
			]),
			row(
				"completed",
				[
					session("completed", {
						startedBy: "Kent",
						reviewRequest: {
							to: "Michiel",
							by: "Kent",
							at: "2026-08-16T00:00:00Z",
							accepted: {
								by: "Michiel",
								at: "2026-08-16T01:00:00Z",
							},
						},
					}),
				],
				{ owner: "kent" },
			),
			row("status", [session("status")]),
			row("outside", [session("outside")], { owner: "kent" }),
		];
		const placed = placeSidebarRows(rows, (candidate) => ({
			...context,
			snoozed: candidate.key === "snoozed",
			inStatusScope: candidate.key !== "outside",
		}));
		const placements: SidebarPlacement[] = [
			"snoozed",
			"needs-review",
			"approved-review",
			"awaiting-review",
			"completed-review",
			"status",
			"outside",
		];
		const keys = placements.flatMap((placement) =>
			rowsAtPlacement(placed, placement).map((candidate) => candidate.key),
		);

		expect(
			Object.fromEntries(placed.map((entry) => [entry.row.key, entry.placement])),
		).toEqual({
			snoozed: "snoozed",
			needs: "needs-review",
			approved: "approved-review",
			awaiting: "awaiting-review",
			completed: "completed-review",
			status: "status",
			outside: "outside",
		});
		expect(keys.sort()).toEqual(rows.map((candidate) => candidate.key).sort());
		expect(new Set(keys).size).toBe(rows.length);
	});

	test("keeps an outstanding GitHub request ahead of another approval", () => {
		const candidate = row(
			"requested-and-approved",
			[
				session("requested-and-approved", {
					startedBy: "Kent",
					prReviewRequested: ["michiel"],
					prReviewDecision: "APPROVED",
					reviewRequest: {
						to: "Kent",
						by: "Michiel",
						at: "2026-08-16T00:00:00Z",
					},
				}),
			],
			{ owner: "kent" },
		);

		expect(classifySidebarPlacement(candidate, context)).toBe("needs-review");
	});

	test("preserves source order within each placement", () => {
		const rows = ["newest", "middle", "oldest"].map((key) =>
			row(key, [session(key)]),
		);
		const placed = placeSidebarRows(rows, () => context);

		expect(rowsAtPlacement(placed, "status").map((candidate) => candidate.key)).toEqual([
			"newest",
			"middle",
			"oldest",
		]);
	});
});
