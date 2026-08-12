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
		expect(html).toContain("group/image");
		expect(html).toContain("group-hover/image:opacity-100");
		expect(html).toContain('aria-label="Add images"');
		expect(html).toContain('aria-label="Slack channel"');
		expect(html).toContain("border-line bg-surface");
		expect(html).toContain("appearance-none pr-8");
		expect(html).toContain("pointer-events-none absolute right-2");
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

describe("TranscriptBlocks sent message actions", () => {
	test("offers edit and send again only on the current viewer's messages", () => {
		const html = renderToStaticMarkup(
			<TranscriptBlocks
				owner="Anonymous"
				onEditMessage={() => {}}
				entries={[
					{
						id: "mine",
						type: "user",
						content: "Fix the typo",
						timestamp: "2026-08-12T12:00:00Z",
					},
					{
						id: "theirs",
						type: "user",
						content: "A teammate's message",
						timestamp: "2026-08-12T12:01:00Z",
						sender: "Ada",
					},
				]}
			/>,
		);
		expect(html.match(/aria-label="Edit and send again"/g)).toHaveLength(1);
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
				reviewResult={{ status: "passed", confidence: 5, checksPassed: 8 }}
			/>,
		);
		expect(html).toContain("Review loop");
		expect(html).toContain("PR #42");
		expect(html).not.toContain("Fixed the review finding.");
		expect(html).toContain("Please also update the empty state.");
		expect(html).not.toContain("Review outcome");
		expect(html).not.toContain("Ready to merge");
	});

	test("shows a passed state on the final settled review loop", () => {
		const html = renderToStaticMarkup(
			<TranscriptBlocks
				entries={[
					{ id: "review", type: "user", content: "[GitHub] <!--os:review-handoff-->\n🔍 This session's PR #42 was just reviewed and is not merge-ready.", timestamp: "2026-08-12T12:00:00Z" },
					{ id: "fix", type: "assistant", content: "Fixed the review finding.", timestamp: "2026-08-12T12:01:00Z" },
				]}
				reviewResult={{ status: "passed", confidence: 5, checksPassed: 8 }}
			/>,
		);
		expect(html).toContain('aria-label="Review passed"');
		expect(html).toContain("1 round · 5/5 · 8 checks passed");
		expect(html).not.toContain("border-l border-line pl-3");
	});

	test("shows progress while a loop is still fixing feedback", () => {
		const html = renderToStaticMarkup(
			<TranscriptBlocks
				live
				entries={[
					{ id: "review", type: "user", content: "[GitHub] <!--os:review-handoff-->\n🔍 This session's PR #42 was just reviewed and is not merge-ready.", timestamp: "2026-08-12T12:00:00Z" },
					{ id: "fix", type: "assistant", content: "Fixing the review finding.", timestamp: "2026-08-12T12:01:00Z" },
				]}
				reviewResult={{ status: "passed", confidence: 5, checksPassed: 8 }}
			/>,
		);
		expect(html).toContain("Reviewing changes");
		expect(html).toContain('aria-label="Review in progress"');
		expect(html).not.toContain('aria-label="Review passed"');
	});

	test("shows a failed state when review findings remain", () => {
		const html = renderToStaticMarkup(
			<TranscriptBlocks
				entries={[
					{ id: "review", type: "user", content: "[GitHub] <!--os:review-handoff-->\nReview PR #42", timestamp: "2026-08-12T12:00:00Z" },
					{ id: "fix", type: "assistant", content: "Could not resolve the finding.", timestamp: "2026-08-12T12:01:00Z" },
				]}
				reviewResult={{ status: "failed", confidence: 2, blocking: 1, checksFailed: 1 }}
			/>,
		);
		expect(html).toContain('aria-label="Review failed"');
		expect(html).toContain("1 round · 2/5 · 1 blocking · 1 check failed");
	});
});
