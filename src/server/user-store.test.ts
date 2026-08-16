import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { writeJsonAtomic } from "./shared/atomic-write";
import { getPins, setPins } from "./pins";
import { getLanes, setLanes } from "./lanes";
import { getPersonalPrompt, setPersonalPrompt } from "./personal-prompts";

// Every per-user store resolves its dir per call, so pointing the state root
// at a scratch dir keeps these off the real ~/.opensession-* state.
const root = mkdtempSync(`${tmpdir()}/user-store-test-`);
const previousRoot = process.env.OPENSESSION_STATE_DIR;
process.env.OPENSESSION_STATE_DIR = root;

afterAll(() => {
	if (previousRoot === undefined) delete process.env.OPENSESSION_STATE_DIR;
	else process.env.OPENSESSION_STATE_DIR = previousRoot;
	rmSync(root, { recursive: true, force: true });
});

/** Write a file under the spelling a store used before the shared filename. */
function seedLegacy(store: string, stem: string, value: unknown): void {
	const dir = `${root}/.opensession-${store}`;
	mkdirSync(dir, { recursive: true });
	writeJsonAtomic(`${dir}/${stem}.json`, value);
}

describe("per-user flat-file stores", () => {
	beforeEach(() => {
		for (const store of ["pins", "lanes", "personal-prompts"]) {
			rmSync(`${root}/.opensession-${store}`, { recursive: true, force: true });
		}
	});

	test("round-trips one user's state", () => {
		setPins("Kent", ["os-1", "os-2"]);
		expect(getPins("Kent")).toEqual(["os-1", "os-2"]);
		expect(getPins("Michiel")).toEqual([]);
	});

	// The reason the filename carries a hash: these two are different people.
	test("lossy filename characters cannot merge two users", () => {
		setPins("a/b", ["os-1"]);
		setPins("a_b", ["os-2"]);
		expect(getPins("a/b")).toEqual(["os-1"]);
		expect(getPins("a_b")).toEqual(["os-2"]);
	});

	// Live state was written under the plain slug; it must still resolve.
	test("reads state left under the legacy plain-slug filename", () => {
		seedLegacy("pins", "Michiel", { pins: ["os-legacy"] });
		expect(getPins("Michiel")).toEqual(["os-legacy"]);
		seedLegacy("lanes", "Michiel", { lanes: { "os-legacy": "review" } });
		expect(getLanes("Michiel")).toEqual({ "os-legacy": "review" });
	});

	test("the first write moves a legacy user onto the shared filename", () => {
		seedLegacy("pins", "Michiel", { pins: ["os-legacy"] });
		setPins("Michiel", ["os-legacy", "os-new"]);
		expect(getPins("Michiel")).toEqual(["os-legacy", "os-new"]);
	});

	// A legacy file must never resurrect state the user has since cleared.
	test("clearing wins over the legacy copy", () => {
		seedLegacy("pins", "Michiel", { pins: ["os-legacy"] });
		setPins("Michiel", []);
		expect(getPins("Michiel")).toEqual([]);
	});

	test("personal prompts still read their identity-keyed legacy file", () => {
		seedLegacy("personal-prompts", "user-kentaro", { prompt: "be terse" });
		expect(getPersonalPrompt("Kentaro")).toBe("be terse");
		setPersonalPrompt("Kentaro", "be terser");
		expect(getPersonalPrompt("Kentaro")).toBe("be terser");
	});

	test("a nameless user stores nothing", () => {
		expect(setPersonalPrompt("", "ignored")).toBe("");
		expect(getPersonalPrompt("")).toBe("");
	});

	test("a missing store reads as empty", () => {
		expect(getPins("Nobody")).toEqual([]);
		expect(getLanes("Nobody")).toEqual({});
		expect(getPersonalPrompt("Nobody")).toBe("");
	});
});
