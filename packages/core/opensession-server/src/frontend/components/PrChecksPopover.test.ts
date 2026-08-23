import { expect, test } from "bun:test";

const popoverSource = await Bun.file(
	new URL("./PrChecksPopover.tsx", import.meta.url),
).text();
const statusBarSource = await Bun.file(
	new URL("./PrStatusBar.tsx", import.meta.url),
).text();
const summarySource = await Bun.file(
	new URL("./WorkspaceSummary.tsx", import.meta.url),
).text();
const menuSource = await Bun.file(
	new URL("../ui/menu.tsx", import.meta.url),
).text();

test("the summary's child popups stay open above their parent", () => {
	const summaryStart = statusBarSource.indexOf('if (variant === "summary")');
	const summaryEnd = statusBarSource.indexOf('if (variant === "header")');
	const summary = statusBarSource.slice(summaryStart, summaryEnd);

	expect(summaryStart).toBeGreaterThan(-1);
	expect(summary).toContain("<PrChecksPopover");
	expect(summary).toContain("nested");
	expect(popoverSource).toContain("<Popover.Root exclusive={!nested}>");
	expect(summarySource).toContain('positionerClassName="z-[2147483646]"');
	expect(popoverSource).toContain(
		'positionerClassName={nested ? "z-[2147483647]" : undefined}',
	);
	expect(summarySource).toContain('positionerClassName="z-[2147483647]"');
	expect(menuSource).toContain(
		'className={cn("z-[10001] outline-none", positionerClassName)}',
	);
});
