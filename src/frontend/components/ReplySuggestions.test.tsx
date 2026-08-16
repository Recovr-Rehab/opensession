import { describe, expect, test } from "bun:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReplySuggestion } from "../lib/reply-suggestions";

const { ReplySuggestions } = await import("./ReplySuggestions");

const suggestions: ReplySuggestion[] = [
	{
		label: "Fix both",
		text: "Fix both the queue race and the stale cache read, then run bun test.",
	},
	{ label: "Only step 1", text: "Only fix step 1 for now and stop there." },
];

describe("ReplySuggestions", () => {
	test("shows the short label and carries the full text as the accessible name", () => {
		const html = renderToStaticMarkup(
			<ReplySuggestions suggestions={suggestions} onPick={() => {}} />,
		);

		expect(html).toContain(">Fix both<");
		expect(html).toContain(">Only step 1<");
		// The sentence is what actually lands in the draft, so a screen reader
		// hears it rather than the two-word shorthand.
		expect(html).toContain(
			'aria-label="Fix both the queue race and the stale cache read, then run bun test."',
		);
	});

	test("renders one scrolling row rather than wrapping above the composer", () => {
		const html = renderToStaticMarkup(
			<ReplySuggestions suggestions={suggestions} onPick={() => {}} />,
		);

		expect(html).toContain("overflow-x-auto");
		expect(html).toContain("whitespace-nowrap");
		expect(html).not.toContain("flex-wrap");
	});

	test("renders nothing at all when there is nothing to suggest", () => {
		expect(
			renderToStaticMarkup(
				<ReplySuggestions suggestions={[]} onPick={() => {}} />,
			),
		).toBe("");
	});
});
