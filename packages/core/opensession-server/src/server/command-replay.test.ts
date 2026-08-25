import { describe, expect, test } from "bun:test";
import { markReplayedCommandResult } from "./command-replay";

describe("markReplayedCommandResult", () => {
	test("marks a duplicate session create result", () => {
		expect(
			markReplayedCommandResult({
				type: "session_created",
				id: "os-old",
				workspaceId: "ws-old",
			}),
		).toEqual({
			type: "session_created",
			id: "os-old",
			workspaceId: "ws-old",
			replayed: true,
		});
	});

	test("leaves other stored command results unchanged", () => {
		const result = { status: "queued" };
		expect(markReplayedCommandResult(result)).toBe(result);
		expect(markReplayedCommandResult(undefined)).toBeUndefined();
	});
});
