import { beforeEach, describe, expect, test } from "bun:test";
import { promptQueues, updateQueuedPrompt } from "./queue-state";

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
});
