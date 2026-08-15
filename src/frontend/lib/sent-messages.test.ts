import { describe, expect, test } from "bun:test";
import type { TranscriptEntry } from "./types";
import { collectSentMessages } from "./sent-messages";

function entry(patch: Partial<TranscriptEntry> & Pick<TranscriptEntry, "id">): TranscriptEntry {
	return {
		type: "user",
		content: "",
		timestamp: "2026-08-15T10:00:00.000Z",
		...patch,
	};
}

describe("collectSentMessages", () => {
	test("indexes user messages in order and nothing else", () => {
		const sent = collectSentMessages([
			entry({ id: "a", content: "Add a way to jump back" }),
			entry({ id: "b", type: "assistant", content: "On it" }),
			entry({ id: "c", type: "tool_use", content: "", toolName: "read" }),
			entry({ id: "d", content: "Make the ticks quieter" }),
		]);
		expect(sent.map((m) => m.id)).toEqual(["a", "d"]);
		expect(sent[0].preview).toBe("Add a way to jump back");
	});

	test("skips entries the transcript renders as a notice", () => {
		// A GitHub-attributed line is an operational status, not something a
		// person typed. classifyEntry turns it into a notice row.
		const sent = collectSentMessages([
			entry({ id: "a", content: "[GitHub] PR #12 merged by kent" }),
			entry({ id: "b", content: "Ship it" }),
		]);
		expect(sent.map((m) => m.id)).toEqual(["b"]);
	});

	test("credits a teammate's steer and drops the delivery prefix", () => {
		const [message] = collectSentMessages([
			entry({ id: "a", content: "[Kent] use the light theme" }),
		]);
		expect(message.sender).toBe("Kent");
		expect(message.preview).toBe("use the light theme");
	});

	test("previews what you said, not the passage you quoted", () => {
		const [message] = collectSentMessages([
			entry({
				id: "a",
				content: "> the rail sits on the scrollbar\n> on macOS\n\nFix that",
			}),
		]);
		expect(message.preview).toBe("Fix that");
	});

	test("keeps a quote-only message rather than dropping it", () => {
		const [message] = collectSentMessages([
			entry({ id: "a", content: "> this line here" }),
		]);
		expect(message.preview).toContain("this line here");
	});

	test("flattens markdown into one line and clamps a long paste", () => {
		const [message] = collectSentMessages([
			entry({
				id: "a",
				content: "## Heading\n\n- **bold** item\n- `code` item\n\n```\nignored\n```",
			}),
		]);
		expect(message.preview).toBe("Heading bold item code item");

		const [long] = collectSentMessages([
			entry({ id: "b", content: "word ".repeat(400) }),
		]);
		expect(long.preview.length).toBeLessThanOrEqual(121);
		expect(long.preview.endsWith("…")).toBe(true);
	});

	test("names the attachment when a message has no words", () => {
		const sent = collectSentMessages([
			entry({ id: "a", images: ["/media?path=one.png"] }),
			entry({ id: "b", images: ["one.png", "two.png"] }),
			entry({ id: "c", files: [{ name: "notes.pdf", path: "/tmp/notes.pdf" }] }),
		]);
		expect(sent.map((m) => m.preview)).toEqual(["Image", "2 images", "notes.pdf"]);
	});

	test("skips an entry the transcript draws nothing for", () => {
		// Delivery plumbing whose body was fenced context: MessageBubble renders
		// null, so there is no bubble to scroll to.
		expect(collectSentMessages([entry({ id: "a", content: "" })])).toEqual([]);
	});
});
