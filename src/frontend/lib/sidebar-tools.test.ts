import { beforeEach, describe, expect, test } from "bun:test";
import {
	readHiddenSidebarTools,
	toolFitsViewport,
	SIDEBAR_TOOL_IDS,
} from "./sidebar-tools";

const store = new Map<string, string>();
// Enough of the Storage surface for the read path.
(globalThis as { localStorage?: unknown }).localStorage = {
	getItem: (key: string) => store.get(key) ?? null,
	setItem: (key: string, value: string) => {
		store.set(key, value);
	},
};

beforeEach(() => store.clear());

describe("readHiddenSidebarTools", () => {
	// A tool added to SIDEBAR_TOOL_IDS must not switch itself on for everyone
	// who has never touched the setting. New accounts start with the two tools
	// that need nothing set up.
	test("a new account sees Pull requests and People, and nothing else", () => {
		const hidden = readHiddenSidebarTools();
		expect([...SIDEBAR_TOOL_IDS].filter((id) => !hidden.has(id))).toEqual([
			"prs",
			"people",
		]);
	});

	// The tool was called "home" until 2026-08-14. Someone who had hidden it
	// then must still have it hidden now, or the rename un-hides a tool they
	// deliberately turned off.
	test("a hidden 'home' is read as a hidden 'prs'", () => {
		store.set("opensession-sidebar-hidden-tools", JSON.stringify(["home"]));
		expect([...readHiddenSidebarTools()]).toEqual(["prs"]);
	});

	test("an explicit empty list means the user showed everything", () => {
		store.set("opensession-sidebar-hidden-tools", "[]");
		expect(readHiddenSidebarTools().size).toBe(0);
	});

	test("stored ids that are no longer tools are dropped", () => {
		store.set(
			"opensession-sidebar-hidden-tools",
			JSON.stringify(["analytics", "retired-tool"]),
		);
		expect([...readHiddenSidebarTools()]).toEqual(["analytics"]);
	});

	test("unreadable storage falls back to the new-account default", () => {
		store.set("opensession-sidebar-hidden-tools", "{not json");
		expect(readHiddenSidebarTools().has("analytics")).toBe(true);
	});
});

describe("toolFitsViewport", () => {
	test("the swipe decks are offered on phones only", () => {
		for (const deck of ["catchup", "supporttinder"] as const) {
			expect(toolFitsViewport(deck, true)).toBe(true);
			expect(toolFitsViewport(deck, false)).toBe(false);
		}
	});

	test("Pull requests is the phone's root list, not one of its tools", () => {
		expect(toolFitsViewport("prs", false)).toBe(true);
		expect(toolFitsViewport("prs", true)).toBe(false);
	});

	test("every other tool is offered at both widths", () => {
		for (const id of SIDEBAR_TOOL_IDS) {
			if (id === "prs" || id === "catchup" || id === "supporttinder") continue;
			expect(toolFitsViewport(id, true)).toBe(true);
			expect(toolFitsViewport(id, false)).toBe(true);
		}
	});
});
