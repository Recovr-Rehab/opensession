import { describe, expect, test } from "bun:test";

const CSS = new URL("./base.css", import.meta.url);

describe("app viewport", () => {
	test("the app fills its viewport-locked body without remeasuring viewport units", async () => {
		const css = await Bun.file(CSS).text();
		const root = css.match(/#root\s*\{([^}]*)\}/)?.[1] ?? "";

		expect(css).toMatch(/body\s*\{\s*position:\s*fixed;\s*inset:\s*0;/);
		expect(root).toMatch(/height:\s*100%/);
		expect(root).not.toMatch(/height:\s*100(?:d|l|s)?vh/);
	});
});
