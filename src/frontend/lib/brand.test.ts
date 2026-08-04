import { describe, expect, test } from "bun:test";
import { PRODUCT_NAME, sessionSourceLabel } from "./brand";

describe("sessionSourceLabel", () => {
	test("shows the product's own UI under the product name", () => {
		// `backstage` is the pre-rename id for "started here", and leaked into
		// the archived list as a literal chip.
		expect(sessionSourceLabel("backstage")).toBe(PRODUCT_NAME.toLowerCase());
	});

	test("leaves every other origin alone", () => {
		for (const source of ["slack", "linear", "cli", "plain"]) {
			expect(sessionSourceLabel(source)).toBe(source);
		}
	});
});
