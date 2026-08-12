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
	addEventListener: () => {},
	removeEventListener: () => {},
	matchMedia: () => ({
		matches: false,
		addEventListener: () => {},
		removeEventListener: () => {},
	}),
};

const walkthrough = {
	summary: "The clearer controls make the next action easier to find.",
	publishedAt: "2026-08-11T12:00:00Z",
	publishedBy: "Kent",
	shots: [{ after: "/tmp/after.png" }],
};

describe("WalkthroughCard", () => {
	test("shows the walkthrough in a PR panel", () => {
		const html = renderToStaticMarkup(
			<WalkthroughCard walkthrough={walkthrough} />,
		);
		expect(html).toContain("The clearer controls");
		expect(html).toContain(">After</span>");
		expect(html).not.toContain('class="overflow-hidden"');
	});

	test("folds the inline session walkthrough", () => {
		const html = renderToStaticMarkup(
			<WalkthroughCard walkthrough={walkthrough} variant="session" />,
		);
		expect(html).toContain('aria-expanded="false"');
		expect(html).not.toContain("by Kent");
		expect(html).toContain("1 still");
		expect(html).not.toContain(">After</span>");
		expect(html).not.toContain("The clearer controls");
		expect(html).toContain("max-w-[var(--session-col)]");
	});
});
