import { expect, test } from "bun:test";
import { TAB_STRIP } from "../lib/session-tab-classes";
import { REPORTS_COLUMN_HEADER } from "../lib/reports-classes";
import { infoTopbarClass } from "../lib/session-viewer-classes";

const CSS = new URL("./base.css", import.meta.url);

test("phone navigation chrome has no hard divider bars", async () => {
	const css = await Bun.file(CSS).text();

	expect(css).not.toMatch(
		/@media \(display-mode: standalone\)\s*\{\s*\.app\s*\{\s*border-top:/,
	);
	expect(TAB_STRIP).not.toContain("phone:border-b");
	expect(TAB_STRIP).not.toContain("phone:shadow-[");
	expect(infoTopbarClass(true)).not.toContain("border-b");
	expect(infoTopbarClass(false)).not.toContain("border-b");
	expect(REPORTS_COLUMN_HEADER).not.toMatch(/(?<!desktop:)border-b/);
});
