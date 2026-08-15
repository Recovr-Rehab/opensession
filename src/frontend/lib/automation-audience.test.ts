import { describe, expect, test } from "bun:test";
import {
	automationInPersonLens,
	automationInRepoLens,
	recipientMatchesPerson,
} from "./automation-audience";

describe("recipientMatchesPerson", () => {
	test("matches the same person written three ways", () => {
		for (const written of ["Kent", "Kent de Bruin", "kentdebruin"])
			expect(recipientMatchesPerson(written, "kent")).toBe(true);
	});

	test("does not match a different teammate", () => {
		expect(recipientMatchesPerson("Michiel", "kent")).toBe(false);
		expect(recipientMatchesPerson("Kent", "michiel")).toBe(false);
	});

	test("empty on either side never matches", () => {
		expect(recipientMatchesPerson("", "kent")).toBe(false);
		expect(recipientMatchesPerson("Kent", "  ")).toBe(false);
	});
});

describe("automationInPersonLens", () => {
	const mine = { recipients: ["Kent"] };
	const theirs = { recipients: ["Michiel"] };
	const house = { recipients: [] };

	test("everyone keeps the whole band", () => {
		for (const a of [mine, theirs, house])
			expect(automationInPersonLens(a, "everyone", "Kent")).toBe(true);
	});

	test("me keeps only what reports to you", () => {
		expect(automationInPersonLens(mine, "me", "Kent")).toBe(true);
		expect(automationInPersonLens(theirs, "me", "Kent")).toBe(false);
		expect(automationInPersonLens(house, "me", "Kent")).toBe(false);
	});

	test("a teammate lens keeps only theirs", () => {
		expect(automationInPersonLens(theirs, "michiel", "Kent")).toBe(true);
		expect(automationInPersonLens(mine, "michiel", "Kent")).toBe(false);
	});

	test("unassigned is only the ones naming nobody", () => {
		expect(automationInPersonLens(house, "unassigned", "Kent")).toBe(true);
		expect(automationInPersonLens(mine, "unassigned", "Kent")).toBe(false);
	});

	test("signed out falls back to everything rather than an empty band", () => {
		for (const a of [mine, theirs, house]) {
			expect(automationInPersonLens(a, "me", "")).toBe(true);
			expect(automationInPersonLens(a, "me", "anonymous")).toBe(true);
		}
	});
});

describe("automationInRepoLens", () => {
	test("all keeps everything", () => {
		expect(automationInRepoLens({ repo: "opensession" }, "all")).toBe(true);
	});

	test("matches the automation's own repo", () => {
		expect(automationInRepoLens({ repo: "opensession" }, "opensession")).toBe(
			true,
		);
		expect(automationInRepoLens({ repo: "opensession" }, "tella-fusion")).toBe(
			false,
		);
	});

	test("matches through the workspace it files under", () => {
		expect(
			automationInRepoLens(
				{ repo: "opensession", workspaceRepo: "tella-fusion" },
				"tella-fusion",
			),
		).toBe(true);
	});
});
