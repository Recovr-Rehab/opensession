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

	test("me keeps yours and the ones addressed to nobody", () => {
		expect(automationInPersonLens(mine, "me", "Kent")).toBe(true);
		expect(automationInPersonLens(house, "me", "Kent")).toBe(true);
		expect(automationInPersonLens(theirs, "me", "Kent")).toBe(false);
	});

	test("an automation with no audience set behaves as it always did", () => {
		// The migration promise: until someone names people, every lens that
		// isn't a specific teammate still shows the whole band.
		const untouched = {};
		expect(automationInPersonLens(untouched, "me", "Kent")).toBe(true);
		expect(automationInPersonLens(untouched, "everyone", "Kent")).toBe(true);
	});

	test("a teammate lens keeps only theirs, not the house ones", () => {
		expect(automationInPersonLens(theirs, "michiel", "Kent")).toBe(true);
		expect(automationInPersonLens(mine, "michiel", "Kent")).toBe(false);
		expect(automationInPersonLens(house, "michiel", "Kent")).toBe(false);
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

	test("recipients is optional on the wire", () => {
		expect(automationInPersonLens({}, "unassigned", "Kent")).toBe(true);
		expect(automationInPersonLens({}, "michiel", "Kent")).toBe(false);
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
