// The toast store, exercised without a DOM: firing, the visible cap, and the
// action a toast can carry. The action is the part worth pinning — an archive
// announces itself with an Undo, and a refactor that drops the field turns a
// reversible action back into a silent one with nothing failing.

import { beforeEach, describe, expect, test } from "bun:test";
import { undoLatestAction } from "../lib/undo";
import { activeToasts, dismissToast, toast } from "./toast";

beforeEach(() => {
	for (const t of [...activeToasts()]) dismissToast(t.id);
});

describe("toast", () => {
	test("fires and dismisses", () => {
		const id = toast("Saved as draft");
		expect(activeToasts().map((t) => t.message)).toEqual(["Saved as draft"]);
		dismissToast(id);
		expect(activeToasts()).toHaveLength(0);
	});

	test("leaves link-copy confirmation to the control or platform", () => {
		expect(toast("Link copied")).toBe(0);
		expect(toast("Preview link copied")).toBe(0);
		expect(toast("Pull request link copied")).toBe(0);
		expect(activeToasts()).toHaveLength(0);
	});

	test("infers the tone from common app feedback", () => {
		toast("Archived");
		toast("Provider removed");
		toast("Could not save that file");
		expect(activeToasts().map((t) => t.variant)).toEqual([
			"success",
			"success",
			"error",
		]);
	});

	test("carries an action, so an archive can offer its own undo", () => {
		let undone = 0;
		toast("Archived", { action: { label: "Undo", onClick: () => undone++ } });
		const t = activeToasts()[0];
		expect(t?.action?.label).toBe("Undo");
		t?.action?.onClick();
		expect(undone).toBe(1);
	});

	test("links a visible Undo action to the app-wide undo stack", () => {
		let undone = 0;
		toast("Archived", { action: { label: "Undo", onClick: () => undone++ } });

		expect(undoLatestAction()).toBe(true);
		expect(undone).toBe(1);
		expect(activeToasts()).toHaveLength(0);
	});

	// A burst of archives must not wallpaper the screen, and the toasts that
	// survive are the newest ones, whose Undo is the one still worth reaching.
	test("keeps only the newest three", () => {
		for (const n of [1, 2, 3, 4]) toast(`Archived ${n} sessions`);
		expect(activeToasts().map((t) => t.message)).toEqual([
			"Archived 2 sessions",
			"Archived 3 sessions",
			"Archived 4 sessions",
		]);
	});
});
