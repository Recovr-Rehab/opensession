import { describe, expect, test } from "bun:test";
import {
	composerHighlightHtml,
	composerMentionRanges,
	needsComposerHighlight,
} from "./composer-highlight";

const TEAM = [
	{ name: "Michiel", fullName: "Michiel Westerbeek" },
	{ name: "Kent", fullName: "Kent de Bruin" },
];

describe("composerHighlightHtml", () => {
	test("plain text passes through escaped", () => {
		expect(composerHighlightHtml("hello <b>world</b>")).toBe(
			"hello &lt;b&gt;world&lt;/b&gt;​",
		);
	});

	test("inline code", () => {
		expect(composerHighlightHtml("run `bun test` now")).toBe(
			'run <span class="cmp-code">`bun test`</span> now​',
		);
	});

	test("closed fence keeps backticks and skips inline parsing inside", () => {
		expect(composerHighlightHtml("see:\n```ts\nconst `x` = 1;\n```\ndone")).toBe(
			'see:\n<span class="cmp-fence">```ts\nconst `x` = 1;\n```</span>\ndone​',
		);
	});

	test("open-ended fence (still typing) styles to end of draft", () => {
		expect(composerHighlightHtml("```bash\necho hi")).toBe(
			'<span class="cmp-fence">```bash\necho hi</span>​',
		);
	});

	test("empty inline backticks are not code", () => {
		expect(composerHighlightHtml("a `` b")).toBe("a `` b​");
	});

	test("inline code never spans lines", () => {
		expect(composerHighlightHtml("a `x\ny` b")).toBe("a `x\ny` b​");
	});

	test("escapes html inside code", () => {
		expect(composerHighlightHtml("`<img>`")).toBe(
			'<span class="cmp-code">`&lt;img&gt;`</span>​',
		);
	});
});

describe("composerMentionRanges", () => {
	test("a finished mention of a teammate", () => {
		expect(composerMentionRanges("ask @Kent about it", TEAM)).toEqual([
			{ start: 4, end: 9, name: "Kent" },
		]);
	});

	test("a name still being typed is not a mention yet", () => {
		// "@Kent" is a whole roster name, but the draft may still become
		// "@Kentucky" — nothing chips until something terminates it.
		expect(composerMentionRanges("ask @Kent", TEAM)).toEqual([]);
		expect(composerMentionRanges("ask @Kentucky ", TEAM)).toEqual([]);
	});

	test("trailing punctuation stays in the sentence", () => {
		expect(composerMentionRanges("thanks @Kent!", TEAM)).toEqual([
			{ start: 7, end: 12, name: "Kent" },
		]);
	});

	test("only roster names count", () => {
		expect(composerMentionRanges("mail @nobody now", TEAM)).toEqual([]);
		expect(composerMentionRanges("see me@kent.com now", TEAM)).toEqual([]);
	});

	test("the roster spelling wins over what was typed", () => {
		expect(composerMentionRanges("@michiel ", TEAM)).toEqual([
			{ start: 0, end: 8, name: "Michiel" },
		]);
	});
});

describe("mentions in the mirror", () => {
	test("a finished mention becomes a pill", () => {
		expect(composerHighlightHtml("ask @Kent now", TEAM)).toBe(
			'ask <span class="cmp-mention">@Kent</span> now​',
		);
	});

	test("a mention inside code stays plain", () => {
		expect(composerHighlightHtml("`@Kent ` and ```\n@Kent \n```", TEAM)).toBe(
			'<span class="cmp-code">`@Kent `</span> and <span class="cmp-fence">```\n@Kent \n```</span>​',
		);
	});

	test("without a roster nothing chips", () => {
		expect(composerHighlightHtml("ask @Kent now")).toBe("ask @Kent now​");
	});
});

describe("needsComposerHighlight", () => {
	test("a backtick, or a finished mention", () => {
		expect(needsComposerHighlight("plain")).toBe(false);
		expect(needsComposerHighlight("has `code`")).toBe(true);
		expect(needsComposerHighlight("ask @Kent now", TEAM)).toBe(true);
		expect(needsComposerHighlight("ask @Kent now")).toBe(false);
	});
});
