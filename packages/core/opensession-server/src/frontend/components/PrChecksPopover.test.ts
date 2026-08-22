import { expect, test } from "bun:test";

const popoverSource = await Bun.file(
	new URL("./PrChecksPopover.tsx", import.meta.url),
).text();
const statusBarSource = await Bun.file(
	new URL("./PrStatusBar.tsx", import.meta.url),
).text();

test("the summary's checks preview does not dismiss its parent popup", () => {
	const summaryStart = statusBarSource.indexOf('if (variant === "summary")');
	const summaryEnd = statusBarSource.indexOf('if (variant === "header")');
	const summary = statusBarSource.slice(summaryStart, summaryEnd);

	expect(summaryStart).toBeGreaterThan(-1);
	expect(summary).toContain("<PrChecksPopover");
	expect(summary).toContain("exclusive={false}");
	expect(popoverSource).toContain("<Popover.Root exclusive={exclusive}>");
});
