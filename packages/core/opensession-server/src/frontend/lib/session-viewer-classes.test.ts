import { expect, test } from "bun:test";
import { VIEWER_INPUT } from "./session-viewer-classes";

test("the focused phone composer keeps its curved bottom inside the viewport", () => {
	expect(VIEWER_INPUT).toContain(
		"phone:[body.kb-open_&:has(.composer:not(.composer-min))]:pb-3",
	);
});
