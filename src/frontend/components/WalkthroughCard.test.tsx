import { describe, expect, test } from "bun:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { WalkthroughCard } from "./WalkthroughCard";

(globalThis as { localStorage?: unknown }).localStorage = {
	getItem: () => null,
	setItem: () => {},
	removeItem: () => {},
};
(globalThis as { window?: unknown }).window = {
	matchMedia: () => ({ matches: false }),
};

const walkthrough = {
	summary: "The clearer controls make the next action easier to find.",
	publishedAt: "2026-08-11T12:00:00Z",
	shots: [{ after: "/tmp/after.png" }],
};

describe("WalkthroughCard", () => {
	test("shows the walkthrough in a PR panel", () => {
		const html = renderToStaticMarkup(
			<WalkthroughCard walkthrough={walkthrough} />,
		);
		expect(html).toContain("The clearer controls");
	});

	test("folds the inline session walkthrough", () => {
		const html = renderToStaticMarkup(
			<WalkthroughCard
				walkthrough={walkthrough}
				variant="session"
			/>,
		);
		expect(html).toContain('aria-expanded="false"');
	});
});
