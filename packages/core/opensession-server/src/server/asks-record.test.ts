import { describe, expect, test } from "bun:test";
import { classifyEntry } from "@tellahq/opensession-protocol/notices";
import type { TranscriptEntry } from "@tellahq/opensession-protocol/session";
import { askRecordEntryContent } from "./asks";

const QUESTION = {
	header: "Choice",
	question: "Which option?",
	options: [{ label: "One" }, { label: "Two" }, { label: "Three" }],
};

function askEntry(content: string): TranscriptEntry {
	return {
		id: "e1",
		type: "system",
		content,
		timestamp: new Date().toISOString(),
		noticeKind: "ask",
	};
}

describe("answered-ask record", () => {
	test("titles with the pick and bolds it among the options", () => {
		const content = askRecordEntryContent([QUESTION], {
			"Which option?": "Two",
		});
		const [title, ...rest] = content.split("\n");
		expect(title).toBe("Answered: Two");
		const body = rest.join("\n");
		expect(body).toContain("**Choice: Which option?**");
		expect(body).toContain("- A. One");
		expect(body).toContain("- **B. Two**");
		expect(body).toContain("- C. Three");
	});

	test("marks every pick of a multi-select answer", () => {
		const content = askRecordEntryContent([QUESTION], {
			"Which option?": "One, Three",
		});
		expect(content).toContain("- **A. One**");
		expect(content).toContain("- B. Two");
		expect(content).toContain("- **C. Three**");
	});

	test("records a typed answer that was not on offer", () => {
		const content = askRecordEntryContent([QUESTION], {
			"Which option?": "Something else entirely",
		});
		expect(content.split("\n")[0]).toBe("Answered: Something else entirely");
		expect(content).toContain("- **Something else entirely** (typed)");
	});

	test("a long answer stays one line in the title", () => {
		const answer = `${"x".repeat(200)}\nsecond line`;
		const title = askRecordEntryContent([QUESTION], {
			"Which option?": answer,
		}).split("\n")[0];
		expect(title.length).toBeLessThanOrEqual(84);
		expect(title.endsWith("…")).toBe(true);
	});

	test("counts several questions in the title and keeps each section", () => {
		const second = {
			question: "Ship it?",
			options: [{ label: "Yes" }, { label: "No" }],
		};
		const content = askRecordEntryContent([QUESTION, second], {
			"Which option?": "One",
			"Ship it?": "No",
		});
		expect(content.split("\n")[0]).toBe("Answered 2 questions");
		expect(content).toContain("- **A. One**");
		expect(content).toContain("- **B. No**");
	});

	test("classifies as a collapsed notice whose title is the pick", () => {
		const entry = classifyEntry(
			askEntry(askRecordEntryContent([QUESTION], { "Which option?": "Two" })),
		);
		expect(entry.notice).toMatchObject({
			kind: "ask",
			title: "Answered: Two",
			tone: "info",
			body: "collapsed",
		});
		// The title is lifted out of the body a client renders.
		expect(entry.content.startsWith("**Choice:")).toBe(true);
	});

	test("a title-only record renders without a show toggle", () => {
		const entry = classifyEntry(askEntry("Answered: Two"));
		expect(entry.notice?.title).toBe("Answered: Two");
		expect(entry.notice?.body).toBeUndefined();
		expect(entry.content).toBe("");
	});
});
