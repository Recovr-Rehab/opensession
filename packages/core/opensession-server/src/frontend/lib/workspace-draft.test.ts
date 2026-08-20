import { describe, expect, test } from "bun:test";
import { workspaceDraftPatch } from "./workspace-draft";

const UPDATED_AT = "2026-08-20T12:00:00.000Z";

describe("workspace draft patches", () => {
	test("empty text removes the parked draft", () => {
		expect(workspaceDraftPatch("", UPDATED_AT, "Kent", true)).toEqual({
			draft: null,
		});
	});

	test("whitespace-only text also removes the parked draft", () => {
		expect(workspaceDraftPatch("  \n\t", UPDATED_AT)).toEqual({ draft: null });
	});

	test("nonempty text remains a draft with its naming state", () => {
		expect(
			workspaceDraftPatch("  Keep the spacing  ", UPDATED_AT, "Kent", false),
		).toEqual({
			draft: {
				text: "  Keep the spacing  ",
				updatedAt: UPDATED_AT,
				by: "Kent",
				autoName: false,
			},
		});
	});
});
