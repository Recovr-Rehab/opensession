import { describe, expect, test } from "bun:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { TranscriptEntry } from "../lib/types";

(globalThis as { window?: unknown }).window = {
	addEventListener: () => {},
	matchMedia: () => ({ matches: false }),
};
(globalThis as { document?: unknown }).document = {
	documentElement: { dataset: {}, style: {} },
	querySelector: () => null,
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
		content: '[GitHub] PR #5606 "Improve the toggle" was merged into main by Kent.',
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
	test("places the Slack composer after the merged response", () => {
		const html = renderToStaticMarkup(
			<TranscriptBlocks
				entries={entries}
				slackShare={{
					prNumber: 5606,
					sessionId: "session-1",
					defaultMessage: "We updated the toggle style in Tella.",
					screenshot: "/tmp/toggle-after.png",
					status: "idle",
					onShare: () => {},
				}}
			/>,
		);
		expect(html.indexOf("PR #5606 is merged")).toBeLessThan(
			html.indexOf("Send to Slack"),
		);
		expect(html.indexOf("Send to Slack")).toBeLessThan(
			html.indexOf("Deployment finished"),
		);
		expect(html).toContain("We updated the toggle style in Tella.");
		expect(html).toContain("Send to Slack");
		expect(html).toContain('data-brand="slack"');
		expect(html).toContain("%2Ftmp%2Ftoggle-after.png");
		expect(html).toContain('aria-label="Open screenshot preview"');
		expect(html).toContain('aria-label="Remove screenshot"');
		expect(html).toContain('aria-label="Add images"');
		expect(html).toContain('aria-label="Slack channel"');
		expect(html).toContain("border-line bg-surface");
		expect(html).toContain("rounded-[var(--composer-radius)]");
		expect(html).toContain("smooth-shadow-ring-soft");
		expect(html).not.toContain("rounded-xl bg-panel p-4");
	});

	test("keeps image attachment explicit when no screenshot exists", () => {
		const html = renderToStaticMarkup(
			<TranscriptBlocks
				entries={entries}
				slackShare={{
					prNumber: 5606,
					sessionId: "session-1",
					defaultMessage: "Background names are now visible in tooltips.",
					status: "idle",
					onShare: () => {},
				}}
			/>,
		);
		expect(html).toContain('aria-label="Add images"');
		expect(html).not.toContain("Capture screenshot");
		expect(html).not.toContain("Capturing screenshot");
	});

	test("does not show the action for a different merged PR", () => {
		const html = renderToStaticMarkup(
			<TranscriptBlocks
				entries={entries}
				slackShare={{
					prNumber: 5607,
					sessionId: "session-1",
					defaultMessage: "We shipped another update.",
					status: "idle",
					onShare: () => {},
				}}
			/>,
		);
		expect(html).not.toContain("Send to Slack");
	});
});

describe("TranscriptBlocks review loops", () => {
	test("folds review work but leaves a following user request in the conversation", () => {
		const html = renderToStaticMarkup(
			<TranscriptBlocks
				entries={[
					{ id: "review", type: "user", content: "[GitHub] <!--os:review-handoff-->\n🔍 This session's PR #42 was just reviewed and is not merge-ready.", timestamp: "2026-08-12T12:00:00Z" },
					{ id: "fix", type: "assistant", content: "Fixed the review finding.", timestamp: "2026-08-12T12:01:00Z" },
					{ id: "human", type: "user", content: "Please also update the empty state.", timestamp: "2026-08-12T12:02:00Z" },
				]}
				reviewOutcome={{ prNumber: 42, title: "Improve the empty state", confidence: 5, checksPassed: 8 }}
			/>,
		);
		expect(html).toContain("Review loop · PR #42");
		expect(html).not.toContain("Fixed the review finding.");
		expect(html).toContain("Please also update the empty state.");
		expect(html).not.toContain("Review outcome");
		expect(html).not.toContain("Ready to merge");
	});

	test("shows the review outcome inside the final settled review loop", () => {
		const html = renderToStaticMarkup(
			<TranscriptBlocks
				entries={[
					{ id: "review", type: "user", content: "[GitHub] <!--os:review-handoff-->\n🔍 This session's PR #42 was just reviewed and is not merge-ready.", timestamp: "2026-08-12T12:00:00Z" },
					{ id: "fix", type: "assistant", content: "Fixed the review finding.", timestamp: "2026-08-12T12:01:00Z" },
				]}
				reviewOutcome={{ prNumber: 42, title: "Improve the empty state", confidence: 5, checksPassed: 8 }}
			/>,
		);
		expect(html).toContain("Review outcome");
		expect(html).toContain("Ready to merge");
		expect(html).toContain("Review 5/5 · 8 checks passed");
		// The verdict belongs to the loop it settled, so it renders inside that
		// section rather than trailing the transcript.
		const loop = html.slice(html.indexOf("Review loop · PR #42"));
		expect(loop.slice(0, loop.indexOf("</section>"))).toContain("Ready to merge");
	});

	test("keeps the outcome off a loop that is still fixing feedback", () => {
		const html = renderToStaticMarkup(
			<TranscriptBlocks
				live
				entries={[
					{ id: "review", type: "user", content: "[GitHub] <!--os:review-handoff-->\n🔍 This session's PR #42 was just reviewed and is not merge-ready.", timestamp: "2026-08-12T12:00:00Z" },
					{ id: "fix", type: "assistant", content: "Fixing the review finding.", timestamp: "2026-08-12T12:01:00Z" },
				]}
				reviewOutcome={{ prNumber: 42, title: "Improve the empty state", confidence: 5, checksPassed: 8 }}
			/>,
		);
		expect(html).toContain("Fixing review feedback");
		expect(html).not.toContain("Ready to merge");
	});
});
