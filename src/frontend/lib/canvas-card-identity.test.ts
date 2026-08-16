import { describe, expect, test } from "bun:test";
import {
	canvasCardCollaborators,
	canvasCardCreator,
	canvasIdentityColor,
} from "./canvas-card-identity";
import type { UnifiedSession } from "./types";

function session(overrides: Partial<UnifiedSession> = {}): UnifiedSession {
	return {
		id: "session-1",
		claudeSessionId: null,
		source: "opensession",
		branch: null,
		worktreeDir: null,
		startedBy: null,
		title: "Test",
		lastActivity: "",
		createdAt: "",
		isRunning: false,
		transcriptPath: null,
		...overrides,
	};
}

describe("Canvas card identity", () => {
	test("uses the explicit creator before the legacy starter", () => {
		expect(
			canvasCardCreator(
				session({
					createdBy: "Michiel Westerbeek",
					createdByLogin: "happylinks",
					startedBy: "Kent",
				}),
			),
		).toEqual({
			kind: "person",
			name: "Michiel Westerbeek",
			login: "happylinks",
			color: canvasIdentityColor("happylinks"),
		});
	});

	test("treats an automation as the creator", () => {
		const creator = canvasCardCreator(
			session({ automation: "Daily review", automationId: "daily-review", startedBy: "Kent" }),
		);
		if (creator.kind !== "automation") throw new Error("expected automation creator");
		expect(creator.name).toBe("Daily review");
	});

	test("deduplicates live collaborators and leaves the creator out", () => {
		const collaborators = canvasCardCollaborators(
			session({ createdBy: "Michiel" }),
			[
				{ user: "Michiel Westerbeek", sessionId: "session-1" },
				{ user: "Kent", sessionId: "session-1" },
				{ user: "Kent de Bruin", sessionId: "session-1" },
				{ user: "John", sessionId: "other" },
			],
			"John",
		);
		expect(collaborators).toEqual(["Kent"]);
	});

	test("leaves the signed-in person's other devices out", () => {
		expect(
			canvasCardCollaborators(
				session({ createdBy: "Michiel" }),
				[
					{ user: "John", sessionId: "session-1" },
					{ user: "Kent", sessionId: "session-1" },
				],
				"John Smith",
			),
		).toEqual(["Kent"]);
	});

	test("keeps an automation color stable across display-name changes", () => {
		const before = canvasCardCreator(
			session({ automation: "Daily review", automationId: "daily-review" }),
		);
		const after = canvasCardCreator(
			session({ automation: "Morning review", automationId: "daily-review" }),
		);
		expect(before.color).toBe(after.color);
	});
});
