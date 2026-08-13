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

function setTurnActivity(value: string | null) {
	(globalThis.localStorage as { getItem: (key: string) => string | null }).getItem =
		(key) => key === "opensession-turn-activity" ? value : null;
}

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

describe("TranscriptBlocks compact tool runs", () => {
	const toolEntries: TranscriptEntry[] = [
		{ id: "prompt", type: "user", content: "Check the repository", timestamp: "2026-08-13T06:00:00Z" },
		{ id: "bash", type: "tool_use", toolUseId: "bash-call", toolName: "bash", toolInput: { command: "git status" }, content: "Using bash", timestamp: "2026-08-13T06:00:01Z" },
		{ id: "bash-result", type: "tool_result", toolUseId: "bash-call", content: "clean", timestamp: "2026-08-13T06:00:02Z" },
		{ id: "read", type: "tool_use", toolUseId: "read-call", toolName: "read", toolInput: { filePath: "/tmp/package.json" }, content: "Using read", timestamp: "2026-08-13T06:00:03Z" },
		{ id: "read-result", type: "tool_result", toolUseId: "read-call", content: "{}", timestamp: "2026-08-13T06:00:04Z" },
	];

	test("folds routine calls to one icon-led row by default", () => {
		setTurnActivity(null);
		const html = renderToStaticMarkup(
			<TranscriptBlocks live entries={toolEntries} />,
		);

		expect(html).toContain('data-tool-run="true"');
		expect(html).toContain("2 steps");
		// The run is drawn as glyphs, the terminal for Bash and the file for
		// Read, with the names left to the aria-label below.
		expect(html).toContain("M5.25 7.25L10.25 12L5.25 16.75");
		expect(html).toContain("M7.75 19.25H16.25C17.3546");
		// A mixed run splits its steps per glyph, as a bare count.
		expect(html).toContain("</span>1</span>");
		expect(html).not.toContain("×1");
		expect(html).toContain("Show 2 grouped steps: Bash · Read");
		expect(html).toContain('x="8.25" y="4.75" width="11" height="11" rx="2"');
		expect(html).toContain("group-hover:opacity-0");
		expect(html).toContain("group-hover:opacity-100");
		expect(html).not.toContain("git status");
		expect(html).not.toContain("package.json");
	});

	test("keeps edits as direct rows between compact runs", () => {
		setTurnActivity("expanded");
		const html = renderToStaticMarkup(
			<TranscriptBlocks
				live
				entries={[
					...toolEntries.slice(0, 3),
					{ id: "edit", type: "tool_use", toolUseId: "edit-call", toolName: "edit", toolInput: { filePath: "/tmp/package.json", oldString: "old", newString: "new" }, content: "Using edit", timestamp: "2026-08-13T06:00:02.500Z" },
					{ id: "edit-result", type: "tool_result", toolUseId: "edit-call", content: "updated", timestamp: "2026-08-13T06:00:02.750Z" },
					...toolEntries.slice(3),
				]}
			/>,
		);

		expect(html.match(/data-tool-run="true"/g)).toHaveLength(2);
		expect(html).toContain('data-eid="edit"');
		expect(html).toContain(">edit</span>");
		expect(html).toContain("+1");
		expect(html).toContain("-1");
		setTurnActivity(null);
	});

	test("folds consecutive edits to one file into a single row", () => {
		setTurnActivity(null);
		const edit = (n: number, path: string): TranscriptEntry[] => [
			{ id: `edit-${n}`, type: "tool_use", toolUseId: `edit-call-${n}`, toolName: "edit", toolInput: { filePath: path, oldString: "old", newString: "new" }, content: "Using edit", timestamp: `2026-08-13T06:00:0${n}.000Z` },
			{ id: `edit-result-${n}`, type: "tool_result", toolUseId: `edit-call-${n}`, content: "updated", timestamp: `2026-08-13T06:00:0${n}.500Z` },
		];
		const html = renderToStaticMarkup(
			<TranscriptBlocks
				live
				entries={[
					{ id: "prompt", type: "user", content: "Rework the button", timestamp: "2026-08-13T06:00:00Z" },
					...edit(1, "/tmp/button.tsx"),
					...edit(2, "/tmp/button.tsx"),
					...edit(3, "/tmp/button.tsx"),
					...edit(4, "/tmp/other.tsx"),
				]}
			/>,
		);

		// One folded row for the three passes over button.tsx, carrying their
		// summed counts; the fourth file keeps its own row.
		expect(html.match(/data-tool-run="edits"/g)).toHaveLength(1);
		expect(html).toContain("×3");
		expect(html).toContain("+3");
		expect(html).toContain("-3");
		expect(html).toContain("Show 3 edit steps on /tmp/button.tsx");
		expect(html).toContain('data-eid="edit-4"');
		expect(html).not.toContain('data-eid="edit-2"');
	});

	test("keeps compact calls open under the always-expanded preference", () => {
		setTurnActivity("expanded");
		const html = renderToStaticMarkup(
			<TranscriptBlocks live entries={toolEntries} />,
		);

		expect(html).toContain("Hide 2 grouped steps: Bash · Read");
		expect(html).toContain("git status");
		expect(html).toContain("package.json");
		setTurnActivity(null);
	});

	test("keeps intermediate messages between compact runs", () => {
		setTurnActivity(null);
		const html = renderToStaticMarkup(
			<TranscriptBlocks
				live
				entries={[
					...toolEntries.slice(0, 3),
					{ id: "note", type: "assistant", content: "The repository is clean.", timestamp: "2026-08-13T06:00:02.500Z" },
					...toolEntries.slice(3),
				]}
			/>,
		);

		expect(html).toContain("The repository is clean.");
		expect(html.match(/data-tool-run="true"/g)).toHaveLength(2);
	});

	test("surfaces failure and incidental media status on the compact row", () => {
		setTurnActivity(null);
		const html = renderToStaticMarkup(
			<TranscriptBlocks
				live
				entries={[
					{ id: "prompt", type: "user", content: "Verify it", timestamp: "2026-08-13T06:00:00Z" },
					{ id: "bash", type: "tool_use", toolUseId: "bash-call", toolName: "bash", toolInput: { command: "bun test" }, content: "Using bash", timestamp: "2026-08-13T06:00:01Z" },
					{ id: "bash-result", type: "tool_result", toolUseId: "bash-call", content: "failed", isError: true, timestamp: "2026-08-13T06:00:02Z" },
					{ id: "read", type: "tool_use", toolUseId: "read-call", toolName: "read", toolInput: { filePath: "/tmp/after.png" }, content: "Using read", timestamp: "2026-08-13T06:00:03Z" },
					{ id: "read-result", type: "tool_result", toolUseId: "read-call", content: "Image read successfully", images: ["/media?path=after.png"], timestamp: "2026-08-13T06:00:04Z" },
				]}
			/>,
		);

		expect(html).toContain("1 failed");
		expect(html).toContain("1 image");
		expect(html).toContain("1 failed, 1 media");
	});

	test("keeps featured media and subagents as direct rows", () => {
		setTurnActivity("expanded");
		const html = renderToStaticMarkup(
			<TranscriptBlocks
				live
				entries={[
					{ id: "prompt", type: "user", content: "Show it", timestamp: "2026-08-13T06:00:00Z" },
					{ id: "shot", type: "tool_use", toolUseId: "shot-call", toolName: "read", toolInput: { filePath: "/tmp/after.png" }, content: "Using read", timestamp: "2026-08-13T06:00:01Z" },
					{ id: "shot-result", type: "tool_result", toolUseId: "shot-call", content: "Image read successfully", images: ["/media?path=after.png"], featuredMedia: ["/media?path=after.png"], timestamp: "2026-08-13T06:00:02Z" },
					{ id: "worker", type: "tool_use", toolUseId: "worker-call", toolName: "task", toolInput: { description: "Review it" }, content: "Using task", timestamp: "2026-08-13T06:00:03Z" },
				]}
			/>,
		);

		expect(html).not.toContain('data-tool-run="true"');
		expect(html).toContain("after.png");
		expect(html).toContain("task");
		setTurnActivity(null);
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
		expect(html).toContain('aria-label="Review loop, Ready to merge, PR #42"');
		expect(html).toContain("Review loop");
		expect(html).toContain("Ready to merge");
		expect(html).not.toContain("5/5");
		expect(html).not.toContain("8 checks passed");
		expect(html).not.toContain("border-l border-line pl-3");
	});

	test("opens to icon-led review steps and a final checked result", () => {
		const html = renderToStaticMarkup(
			<TranscriptBlocks
				reviewLoopsOpen
				entries={[
					{ id: "review", type: "user", content: "[GitHub] <!--os:review-handoff-->\nReview PR #42", timestamp: "2026-08-12T12:00:00Z" },
					{ id: "read", type: "tool_use", toolUseId: "read-call", toolName: "Read", toolInput: { filePath: "/tmp/report.txt" }, content: "Using Read", timestamp: "2026-08-12T12:00:01Z" },
					{ id: "read-result", type: "tool_result", toolUseId: "read-call", content: "ok", timestamp: "2026-08-12T12:00:02Z" },
				]}
				reviewResult={{ status: "passed", confidence: 5, checksPassed: 8 }}
			/>,
		);
		expect(html).toContain('aria-expanded="true"');
		expect(html).toContain("report.txt");
		expect(html).toContain('aria-label="Review passed"');
		expect(html).toContain("1 round · 5/5 · 8 checks passed");
		expect(html).toContain("mt-0.5 pl-2");
		expect(html).toContain("flex size-[22px] flex-none self-center items-center justify-center");
		expect(html).toContain("-translate-y-px");
		expect(html).not.toContain(">Worked<");
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
		expect(html).toContain("Working");
		expect(html).toContain('aria-label="Review in progress"');
		expect(html).not.toContain('aria-label="Review passed"');
	});

	test("shows pending review facts without a running spinner after the worker settles", () => {
		const html = renderToStaticMarkup(
			<TranscriptBlocks
				entries={[
					{ id: "review", type: "user", content: "[GitHub] <!--os:review-handoff-->\nReview PR #42", timestamp: "2026-08-12T12:00:00Z" },
					{ id: "fix", type: "assistant", content: "Waiting for checks.", timestamp: "2026-08-12T12:01:00Z" },
				]}
				reviewResult={{ status: "pending", checksPassed: 7 }}
			/>,
		);
		expect(html).toContain("Working");
		expect(html).not.toContain('aria-label="Review in progress"');
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
		expect(html).toContain('aria-label="Review loop, Needs changes, PR #42"');
		expect(html).toContain("Needs changes");
		expect(html).not.toContain("1 blocking");
		expect(html).not.toContain("1 check failed");
	});
});
