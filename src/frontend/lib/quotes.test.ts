import { describe, expect, it } from "bun:test";
import { withQuotes, type Quote } from "./quotes";

const q = (id: string, text: string): Quote => ({ id, text });

describe("withQuotes", () => {
	it("leaves the message alone when nothing is staged", () => {
		expect(withQuotes([], "what does this do?")).toBe("what does this do?");
	});

	it("quotes the passage above the message", () => {
		expect(withQuotes([q("a", "the fix is in run-session.ts")], "why?")).toBe(
			"> the fix is in run-session.ts\n\nwhy?",
		);
	});

	it("quotes every line, keeping blank lines inside the passage", () => {
		expect(withQuotes([q("a", "first\n\nsecond")], "explain")).toBe(
			"> first\n>\n> second\n\nexplain",
		);
	});

	it("separates multiple passages", () => {
		expect(withQuotes([q("a", "one"), q("b", "two")], "compare these")).toBe(
			"> one\n\n> two\n\ncompare these",
		);
	});

	it("sends the passages alone when nothing was typed", () => {
		expect(withQuotes([q("a", "one")], "   ")).toBe("> one");
	});
});
