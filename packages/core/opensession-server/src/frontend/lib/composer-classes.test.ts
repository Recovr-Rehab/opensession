import { expect, test } from "bun:test";
import { composerTextarea } from "./composer-classes";

test("long composer drafts remain touch-scrollable inside their height cap", () => {
	expect(composerTextarea).toContain("overflow-y-auto");
	expect(composerTextarea).toContain("overscroll-contain");
	expect(composerTextarea).toContain("touch-pan-y");
});
