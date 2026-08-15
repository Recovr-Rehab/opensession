import { beforeEach, describe, expect, test } from "bun:test";
import {
	promptQueues,
	takeQueuedPrompt,
} from "./queue-state";

const SESSION = "os-queue-state-update-test";
const PNG = "data:image/png;base64,iVBORw0KGgo=";
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
