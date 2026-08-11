import { describe, expect, test } from "bun:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { TranscriptEntry } from "../lib/types";

(globalThis as { window?: unknown }).window = {
	addEventListener: () => {},
	matchMedia: () => ({ matches: false }),
};
(globalThis as { localStorage?: unknown }).localStorage = {
	getItem: () => null,
	setItem: () => {},
	removeItem: () => {},
};

const { TranscriptBlocks } = await import("./TranscriptBlocks");

const entries: TranscriptEntry[] = [
	{
		id: "merged-notice",
		type: "user",
		content: "PR #5606 was merged into main by Kent.",
		timestamp: "2026-08-11T12:50:45Z",
		notice: { kind: "system", title: "PR merged", tone: "info" },
	},
	{
		id: "merged-answer",
		type: "assistant",
		content: "PR #5606 is merged into main by Kent.",
		timestamp: "2026-08-11T12:50:56Z",
	},
	{
		id: "deployment-notice",
		type: "user",
		content: "Deployment finished for PR #5606.",
		timestamp: "2026-08-11T12:56:31Z",
		notice: { kind: "system", title: "Deployment finished", tone: "info" },
	},
];

describe("TranscriptBlocks shipped change action", () => {
	test("places Share to Slack after the merged response", () => {
		const html = renderToStaticMarkup(
			<TranscriptBlocks
				entries={entries}
				slackShare={{
					prNumber: 5606,
					preview: {
						persona: "Michael",
						title: "Adopt the OpenSession toggle style",
						url: "https://github.com/tellahq/tella-fusion/pull/5606",
						summary: "The longer toggle is easier to read.",
						screenshot: "/tmp/toggle-after.png",
					},
					status: "idle",
					onShare: () => {},
				}}
			/>,
		);
		expect(html.indexOf("PR #5606 is merged")).toBeLessThan(
			html.indexOf("Share to Slack"),
		);
		expect(html.indexOf("Share to Slack")).toBeLessThan(
			html.indexOf("Deployment finished"),
		);
		expect(html).toContain("Michael shipped");
		expect(html).toContain("Adopt the OpenSession toggle style");
		expect(html).toContain("The longer toggle is easier to read.");
		expect(html).toContain("%2Ftmp%2Ftoggle-after.png");
	});

	test("does not show the action for a different merged PR", () => {
		const html = renderToStaticMarkup(
			<TranscriptBlocks
				entries={entries}
				slackShare={{
					prNumber: 5607,
					preview: {
						persona: "Michael",
						title: "Another PR",
						url: "https://github.com/tellahq/tella-fusion/pull/5607",
						summary: "Another visual change.",
						screenshot: "/tmp/another.png",
					},
					status: "idle",
					onShare: () => {},
				}}
			/>,
		);
		expect(html).not.toContain("Share to Slack");
	});
});
