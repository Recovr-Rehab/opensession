// The toast store, exercised without a DOM: firing, the visible cap, and the
// action a toast can carry. The action is the part worth pinning — an archive
// announces itself with an Undo, and a refactor that drops the field turns a
// reversible action back into a silent one with nothing failing.

import { beforeEach, describe, expect, test } from "bun:test";
import { activeToasts, dismissToast, toast } from "./toast";

beforeEach(() => {
	for (const t of [...activeToasts()]) dismissToast(t.id);
});

describe("toast", () => {
	test("fires and dismisses", () => {
		const id = toast("Link copied");
		expect(activeToasts().map((t) => t.message)).toEqual(["Link copied"]);
		dismissToast(id);
		expect(activeToasts()).toHaveLength(0);
	});

	test("infers the tone from the message when none is given", () => {
		toast("Link copied");
		toast("Couldn't load the transcript");
		toast("Archived");
		expect(activeToasts().map((t) => t.variant)).toEqual([
			"success",
			"error",
			"default",
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

	test("can keep a pending action visible until it runs or is undone", () => {
		toast("PR merged", {
			action: { label: "Undo", onClick: () => undefined },
			dismissOnClick: false,
		});
		expect(activeToasts()[0]?.dismissOnClick).toBe(false);
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

	test("keeps a pending action when newer informational toasts arrive", () => {
		toast("PR merged", {
			action: { label: "Undo", onClick: () => undefined },
			dismissOnClick: false,
		});
		for (const message of ["One", "Two", "Three"]) toast(message);
		expect(activeToasts().map((t) => t.message)).toEqual([
			"PR merged",
			"Two",
			"Three",
		]);
	});
});
