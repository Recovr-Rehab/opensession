import { describe, expect, test } from "bun:test";
import { dedupeViewers, otherViewers, workingViewers } from "./presence";

describe("otherViewers", () => {
	test("your own devices come out — all of them, not just the first", () => {
		expect(otherViewers(["Kent", "Kent", "Michiel"], "Kent")).toEqual(["Michiel"]);
	});

	test("alone on a session is an empty pile, not a face of yourself", () => {
		expect(otherViewers(["Kent"], "Kent")).toEqual([]);
	});

	test("a full display name still matches the first-name form presence sends", () => {
		expect(otherViewers(["Kent", "Michiel"], "Kent de Bruin")).toEqual(["Michiel"]);
	});

	test("teammates are kept", () => {
		expect(otherViewers(["Michiel", "Johnny"], "Kent")).toEqual(["Michiel", "Johnny"]);
	});

	test("without a known identity nobody is filtered — better a face too many than a wrong one", () => {
		expect(otherViewers(["Kent", "Michiel"], "")).toEqual(["Kent", "Michiel"]);
	});
});

describe("workingViewers", () => {
	const running = (runBy?: string) => ({ isRunning: true, runBy });
	const idle = (runBy?: string) => ({ isRunning: false, runBy });

	test("a teammate's run in flight earns a face", () => {
		expect(workingViewers([running("Michiel")], "Kent")).toEqual(["Michiel"]);
	});

	test("reading someone's session leaves no trace — nothing running, no face", () => {
		expect(workingViewers([idle("Michiel")], "Kent")).toEqual([]);
	});

	test("a finished run keeps no face, even with the driver still recorded", () => {
		// The server only stamps runBy while a run is in flight; a client
		// holding a stale row must not keep the face up on its own.
		expect(workingViewers([{ isRunning: false, runBy: "Michiel" }], "Kent")).toEqual([]);
	});

	test("your own run is never a face — you know what you started", () => {
		expect(workingViewers([running("Kent")], "Kent de Bruin")).toEqual([]);
	});

	test("one face per person across the row's sessions", () => {
		expect(
			workingViewers([running("Michiel"), running("Michiel"), running("Johnny")], "Kent"),
		).toEqual(["Michiel", "Johnny"]);
	});

	test("an automation run has no driver, so it claims nobody", () => {
		expect(workingViewers([running(undefined), running("   ")], "Kent")).toEqual([]);
	});
});

describe("dedupeViewers", () => {
	test("one face per person, carrying their device count", () => {
		expect(dedupeViewers(["Michiel", "Johnny", "Michiel"])).toEqual([
			{ name: "Michiel", count: 2 },
			{ name: "Johnny", count: 1 },
		]);
	});
});
