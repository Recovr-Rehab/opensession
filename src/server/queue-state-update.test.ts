import { beforeEach, describe, expect, test } from "bun:test";
import { promptQueues, takeQueuedPrompt, updateQueuedPrompt } from "./queue-state";

const SESSION = "os-queue-state-update-test";
const PNG = "data:image/png;base64,iVBORw0KGgo=";
const JPEG = "data:image/jpeg;base64,/9j/4AAQ";

describe("updateQueuedPrompt", () => {
	beforeEach(() => {
		promptQueues.set(SESSION, [
			{ id: "q1", content: "look at this", user: "Kent", images: [PNG] },
		]);
	});

	test("a text-only update leaves the attachments alone", () => {
		expect(updateQueuedPrompt(SESSION, "q1", undefined, "look again")).toBe(true);
		expect(promptQueues.get(SESSION)?.[0]).toMatchObject({
			content: "look again",
			images: [PNG],
		});
	});

	test("an images array replaces them wholesale", () => {
		updateQueuedPrompt(SESSION, "q1", undefined, "this one instead", [JPEG]);
		expect(promptQueues.get(SESSION)?.[0]?.images).toEqual([JPEG]);
	});

	test("an empty images array clears them", () => {
		updateQueuedPrompt(SESSION, "q1", undefined, "words only", []);
		expect(promptQueues.get(SESSION)?.[0]).not.toHaveProperty("images");
	});

	test("an empty text and image edit preserves staged files", () => {
		promptQueues.set(SESSION, [
			{
				id: "q1",
				content: "instructions",
				user: "Kent",
				images: [PNG],
				files: [{ name: "brief.pdf", path: "/tmp/brief.pdf" }],
			},
		]);
		updateQueuedPrompt(SESSION, "q1", undefined, "", []);
		expect(promptQueues.get(SESSION)?.[0]).toMatchObject({
			content: "",
			files: [{ name: "brief.pdf", path: "/tmp/brief.pdf" }],
		});
	});

	test("removes an item only when text, images, and files are empty", () => {
		updateQueuedPrompt(SESSION, "q1", undefined, "", []);
		expect(promptQueues.get(SESSION)).toEqual([]);
	});
});

describe("takeQueuedPrompt", () => {
	beforeEach(() => {
		promptQueues.set(SESSION, [
			{
				id: "q1",
				content: "first",
				user: "Kent",
				images: [PNG],
				files: [{ name: "brief.pdf", path: "/tmp/brief.pdf" }],
			},
			{ id: "q2", content: "second", user: "Michiel" },
		]);
	});

	test("atomically removes and returns the complete payload", () => {
		expect(takeQueuedPrompt(SESSION, "q1", "Kent de Bruin", false)).toMatchObject({
			id: "q1",
			content: "first",
			images: [PNG],
			files: [{ name: "brief.pdf", path: "/tmp/brief.pdf" }],
		});
		expect(promptQueues.get(SESSION)?.map((item) => item.id)).toEqual(["q2"]);
	});

	test("only the original sender can take a row", () => {
		expect(takeQueuedPrompt(SESSION, "q1", "Michiel", false)).toBeUndefined();
		expect(promptQueues.get(SESSION)?.map((item) => item.id)).toEqual(["q1", "q2"]);
	});

	test("routed and context-carrying rows remain queue-owned", () => {
		promptQueues.set(SESSION, [
			{ id: "q1", content: "Slack", user: "Kent", slackReplyTo: { channel: "C1", threadTs: "1" } },
			{ id: "q2", content: "Context", user: "Kent", contextSessions: ["os-other"] },
		]);
		expect(takeQueuedPrompt(SESSION, "q1", "Kent", false)).toBeUndefined();
		expect(takeQueuedPrompt(SESSION, "q2", "Kent", false)).toBeUndefined();
	});
});
