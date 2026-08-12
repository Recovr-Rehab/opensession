import { describe, expect, test } from "bun:test";
import {
	isScratchWorkspace,
	spawnedSessionBelongsInSidebar,
} from "./sidebar-workspaces";

describe("isScratchWorkspace", () => {
	test("recognizes a workspace containing scratch sessions", () => {
		expect(isScratchWorkspace([{ mode: "scratch" }, { mode: "scratch" }])).toBe(
			true,
		);
	});

	test("does not treat repo-backed or empty workspaces as scratch", () => {
		expect(isScratchWorkspace([{ mode: "scratch" }, { mode: "code" }])).toBe(
			false,
		);
		expect(isScratchWorkspace([])).toBe(false);
	});
});

describe("spawnedSessionBelongsInSidebar", () => {
	test("keeps an unclaimed spawned deep link out of the sidebar", () => {
		expect(
			spawnedSessionBelongsInSidebar(
				{ spawnedBy: "parent" },
				false,
				false,
			),
		).toBe(false);
	});

	test("includes spawned sessions that need attention or were claimed", () => {
		const session = { spawnedBy: "parent" };
		expect(spawnedSessionBelongsInSidebar(session, true, false)).toBe(true);
		expect(spawnedSessionBelongsInSidebar(session, false, true)).toBe(true);
	});
});
