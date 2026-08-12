import { describe, expect, test } from "bun:test";
import { suggestedShippedChangeMessage } from "./shipped-change-copy";

describe("suggestedShippedChangeMessage", () => {
	test("turns an imperative PR title into a short team update", () => {
		expect(
			suggestedShippedChangeMessage("Adopt the OpenSession toggle style", "tella-fusion"),
		).toBe("We adopted the OpenSession toggle style in Tella.");
	});

	test("does not repeat the product name", () => {
		expect(suggestedShippedChangeMessage("Update Tella's toggle style", "tella-fusion")).toBe(
			"We updated Tella's toggle style.",
		);
	});

	test("keeps an unfamiliar title editable rather than inventing a verb", () => {
		expect(suggestedShippedChangeMessage("Toggle polish", "tella-fusion")).toBe(
			"We shipped Toggle polish in Tella.",
		);
	});
});
