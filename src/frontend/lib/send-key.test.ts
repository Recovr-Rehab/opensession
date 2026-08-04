import { describe, expect, test } from "bun:test";
import { insideOpenFence, isSendCombo } from "./send-key";

const key = (overrides: Partial<Parameters<typeof isSendCombo>[0]> = {}) => ({
	key: "Enter",
	shiftKey: false,
	metaKey: false,
	ctrlKey: false,
	...overrides,
});

describe("isSendCombo", () => {
	test("accepts plain and modified Enter with the default preference", () => {
		expect(isSendCombo(key(), "enter")).toBe(true);
		expect(isSendCombo(key({ metaKey: true }), "enter")).toBe(true);
		expect(isSendCombo(key({ ctrlKey: true }), "enter")).toBe(true);
	});

	test("keeps Shift+Enter as a newline with the default preference", () => {
		expect(isSendCombo(key({ shiftKey: true }), "enter")).toBe(false);
	});

	test("requires modified Enter when that preference is selected", () => {
		expect(isSendCombo(key(), "mod-enter")).toBe(false);
		expect(isSendCombo(key({ metaKey: true }), "mod-enter")).toBe(true);
		expect(isSendCombo(key({ ctrlKey: true }), "mod-enter")).toBe(true);
	});
});

describe("insideOpenFence", () => {
	const draft = "before\n```ts\ncode\n```\nafter";

	test("plain text is never inside a fence", () => {
		expect(insideOpenFence("just a prompt", 13)).toBe(false);
	});

	test("caret inside an unclosed fence", () => {
		const open = "explain this:\n```ts\nconst a = 1";
		expect(insideOpenFence(open, open.length)).toBe(true);
	});

	test("caret after a closed fence", () => {
		expect(insideOpenFence(draft, draft.length)).toBe(false);
	});

	test("only the text before the caret counts", () => {
		// Caret sits at the very start, ahead of both fence markers.
		expect(insideOpenFence(draft, 0)).toBe(false);
		// …and between them.
		expect(insideOpenFence(draft, draft.indexOf("code"))).toBe(true);
	});
});
