import { beforeEach, describe, expect, test } from "bun:test";
import { setSessionTitles } from "./markdown";
import {
	applyComposerSessionEdit,
	composerDisplayOffset,
	projectComposerSessions,
} from "./composer-session-projection";

const ID = "os-01a006d8-eddd-7000-bca2-b010caf2d8e7";

describe("composer session projection", () => {
	beforeEach(() => setSessionTitles([[ID, "Clean pasted session links"]]));

	test("shows the title while retaining the canonical id", () => {
		const projected = projectComposerSessions(`Compare ${ID} now`);
		expect(projected.displayText).toBe("Compare Clean pasted session links now");
		expect(projected.canonicalText).toBe(`Compare ${ID} now`);
		expect(projected.sessions).toEqual([
			{
				start: 8,
				end: 34,
				id: ID,
				canonicalStart: 8,
				canonicalEnd: 47,
				label: "Clean pasted session links",
			},
		]);
	});

	test("keeps edits outside a token in canonical text", () => {
		const projected = projectComposerSessions(`Compare ${ID} now`);
		expect(
			applyComposerSessionEdit(
				projected,
				"Please compare Clean pasted session links now",
			).canonicalText,
		).toBe(`Please compare ${ID} now`);
	});

	test("removes the whole token when its title is edited", () => {
		const projected = projectComposerSessions(`Compare ${ID} now`);
		expect(
			applyComposerSessionEdit(
				projected,
				"Compare Clean pasted sesion links now",
			).canonicalText,
		).toBe("Compare  now");
	});

	test("also removes plain text selected beside a token", () => {
		const projected = projectComposerSessions(`Compare ${ID} now`);
		const next = "Compare now";
		expect(
			applyComposerSessionEdit(projected, next, 8, 8).canonicalText,
		).toBe(next);
	});

	test("maps a canonical caret past the token into display text", () => {
		const projected = projectComposerSessions(`Compare ${ID} now`);
		expect(composerDisplayOffset(projected, 47)).toBe(34);
		expect(composerDisplayOffset(projected, 51)).toBe(38);
	});

	test("leaves session ids inside code untouched", () => {
		expect(projectComposerSessions(`\`${ID}\``).displayText).toBe(`\`${ID}\``);
		expect(
			projectComposerSessions(`\`\`\`\n${ID}\n\`\`\``).displayText,
		).toBe(`\`\`\`\n${ID}\n\`\`\``);
	});

	test("turns a newly pasted id into a named token on the next projection", () => {
		const empty = projectComposerSessions("Compare ");
		const canonical = applyComposerSessionEdit(empty, `Compare ${ID}`).canonicalText;
		expect(canonical).toBe(`Compare ${ID}`);
		expect(projectComposerSessions(canonical).displayText).toBe(
			"Compare Clean pasted session links",
		);
	});
});
