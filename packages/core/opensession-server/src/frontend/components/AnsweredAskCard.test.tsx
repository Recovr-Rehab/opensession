import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { AnsweredAskCard } from "./AnsweredAskCard";
import { MessageBubble } from "./MessageBubble";

const record = {
	version: 1 as const,
	questions: [
		{
			header: "Demo choice",
			question: "Which **version** should the transcript show?",
			options: [
				{ label: "Compact", description: "A calm read-only card." },
				{ label: "Detailed" },
				{ label: "Both" },
			],
			answer: "Compact",
		},
	],
};

test("renders the answered ask in the original card vocabulary", () => {
	const html = renderToStaticMarkup(
		<AnsweredAskCard record={record} entryId="ask-1" />,
	);

	expect(html).toContain('data-answered-ask=""');
	expect(html).toContain("Answered");
	expect(html).toContain("Demo choice");
	expect(html).toContain("Which <strong>version</strong>");
	expect(html).toContain("A calm read-only card.");
	expect(html).toContain('aria-label="Compact, selected"');
	expect(html).toContain('aria-label="Detailed"');
	expect(html).toContain('data-selected=""');
});

test("is read-only and keeps every option visible", () => {
	const html = renderToStaticMarkup(
		<AnsweredAskCard record={record} entryId="ask-1" />,
	);

	expect(html).toContain(">A</span>");
	expect(html).toContain(">B</span>");
	expect(html).toContain(">C</span>");
	expect(html).not.toContain("<button");
	expect(html).not.toContain("<input");
});

test("MessageBubble routes ask notices to the read-only card", () => {
	const html = renderToStaticMarkup(
		<MessageBubble
			entry={{
				id: "ask-1",
				type: "system",
				content: "compatibility body",
				timestamp: "2026-08-19T12:00:00.000Z",
				notice: {
					kind: "ask",
					title: "Answered: Compact",
					tone: "info",
					body: "collapsed",
					ask: record,
				},
			}}
		/>,
	);

	expect(html).toContain('data-answered-ask=""');
	expect(html).not.toContain("Answered: Compact ·");
	expect(html).not.toContain(">show</span>");
});

test("shows a custom answer as the selected typed row", () => {
	const html = renderToStaticMarkup(
		<AnsweredAskCard
			record={{
				version: 1,
				questions: [
					{
						question: "What should happen next?",
						options: [{ label: "Wait" }],
						answer: "Ship today",
					},
				],
			}}
			entryId="ask-2"
		/>,
	);

	expect(html).toContain("Ship today");
	expect(html).toContain("Typed answer");
	expect(html).toContain('aria-label="Ship today, selected typed answer"');
});
