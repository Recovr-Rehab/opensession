import { beforeEach, describe, expect, test } from "bun:test";
import { classifyEntry } from "@tellahq/opensession-protocol/notices";
import {
	acknowledgePromptDispatch,
	beginPromptDispatch,
	isEditableQueueItem,
	isWorkerQueueItem,
	promptDispatches,
	promptQueues,
	takeQueuedPrompt,
} from "./queue-state";
import { agentActor, workerActor } from "./session-actors";

const SESSION = "os-queue-state-update-test";
const PNG = "data:image/png;base64,iVBORw0KGgo=";
describe("takeQueuedPrompt", () => {
	beforeEach(() => {
		promptDispatches.clear();
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

	test("keeps a selected prompt durable until the runner acknowledges it", () => {
		const promptEntryId = beginPromptDispatch(
			SESSION,
			[{ id: "q1", content: "first", user: "Kent" }],
			"entry-1",
			false,
		);
		expect(promptEntryId).toBe("entry-1");
		expect(promptDispatches.get(SESSION)).toEqual({
			promptEntryId: "entry-1",
			items: [{ id: "q1", content: "first", user: "Kent" }],
		});

		acknowledgePromptDispatch(SESSION, "other-entry", false);
		expect(promptDispatches.has(SESSION)).toBe(true);
		acknowledgePromptDispatch(SESSION, "entry-1", false);
		expect(promptDispatches.has(SESSION)).toBe(false);
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

describe("worker reports are not user messages", () => {
	const WORKER = "os-019fe194-5fbe-7000-a81e-d0a656ad77f4";

	test("a worker's report to its parent is queue-owned, not editable", () => {
		// It rides the same queue as human sends because it drives the parent's
		// next turn, but nobody typed it — so it gets none of the composer's
		// gestures, and no teammate can pull it back into their draft.
		const report = { id: "w1", content: "Done.", user: workerActor(WORKER) };
		expect(isWorkerQueueItem(report)).toBe(true);
		expect(isEditableQueueItem(report)).toBe(false);
	});

	test("a person's message stays editable", () => {
		const mine = { id: "q1", content: "ship it", user: "Kent" };
		expect(isWorkerQueueItem(mine)).toBe(false);
		expect(isEditableQueueItem(mine)).toBe(true);
	});

	test("a non-worker agent message is not mistaken for a worker report", () => {
		// agentActor and workerActor are not interchangeable: only a worker's
		// report to its own parent is delivered verbatim.
		expect(isWorkerQueueItem({ content: "ping", user: agentActor(WORKER) })).toBe(false);
		expect(isWorkerQueueItem({ content: "worker looks stuck", user: "Kent" })).toBe(false);
	});

	test("the sender the queue keeps still classifies as a worker report", () => {
		// The queue stores content and user separately; the UI reads them back
		// through the same classifier the transcript uses, so the two cannot
		// disagree about what a row is.
		const classified = classifyEntry({
			id: "",
			type: "user",
			content: `[${workerActor(WORKER)}] <!--os:worker-report-->\nDone.`,
			timestamp: "",
		});
		expect(classified.notice?.kind).toBe("worker-report");
		expect(classified.sender).toBeUndefined();
	});
});
