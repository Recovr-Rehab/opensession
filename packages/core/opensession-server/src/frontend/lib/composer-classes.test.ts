import { expect, test } from "bun:test";
import { composerTextarea } from "./composer-classes";

test("long composer drafts remain touch-scrollable with room to submit", () => {
	expect(composerTextarea).toContain("overflow-y-auto");
	expect(composerTextarea).toContain("overscroll-contain");
	expect(composerTextarea).toContain("touch-pan-y");
	expect(composerTextarea).toContain(
		"phone:[body.kb-open_&]:max-h-[120px]",
	);
});
