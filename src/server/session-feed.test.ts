import { describe, expect, test } from "bun:test";
import type { ProtocolServerMessage } from "@tellahq/opensession-protocol/session";
import {
	appendSessionFeed,
	resumeSessionFeed,
	sessionFeedSnapshot,
} from "./session-feed";
import { onSessionStateChange } from "./session-state-events";

type FeedAppend = Extract<
	Extract<ProtocolServerMessage, { type: "session_feed" }>["event"],
	{ type: "transcript_append" }
>;
type TopLevelAppend = Extract<
	ProtocolServerMessage,
	{ type: "transcript_append" }
>;
type Exact<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

describe("session feed", () => {
	test("a wrapped transcript_append is the top-level frame, cursors included", () => {
		// Compile-time half: the two routes are the SAME declared shape, so a
		// field added to one can never be missing from the other.
		const sameShape: Exact<FeedAppend, TopLevelAppend> = true;
		expect(sameShape).toBe(true);

		const sessionId = `feed-${crypto.randomUUID()}`;
		const frame = appendSessionFeed(sessionId, {
			type: "transcript_append",
			sessionId,
			entries: [],
			endOffset: 512,
			rev: "mirror-1",
			lastSeq: 7,
			lastChangeSeq: 9,
			v2: true,
		});
		expect(frame.phase).toBe("committed");
		expect(frame.event).toMatchObject({
			type: "transcript_append",
			endOffset: 512,
			rev: "mirror-1",
			lastSeq: 7,
			lastChangeSeq: 9,
			v2: true,
		});
	});


	test("orders active frames and resumes a true gap", () => {
		const sessionId = `feed-${crypto.randomUUID()}`;
		const start = appendSessionFeed(sessionId, {
			type: "stream_start",
			sessionId,
			by: "Jaap",
		});
		const text = appendSessionFeed(sessionId, {
			type: "stream_text",
			sessionId,
			text: "hello",
		});
		const resumed = resumeSessionFeed(
			sessionId,
			start.feedSeq,
			start.feedEpoch,
		);
		expect(resumed.frames.map((frame) => frame.feedSeq)).toEqual([text.feedSeq]);
		expect(resumed.snapshot.active).toBeNull();
	});

	test("active snapshot contains only text not yet committed", () => {
		const sessionId = `feed-${crypto.randomUUID()}`;
		appendSessionFeed(sessionId, { type: "stream_start", sessionId });
		appendSessionFeed(sessionId, {
			type: "stream_text",
			sessionId,
			text: "landed",
		});
		appendSessionFeed(sessionId, {
			type: "transcript_append",
			sessionId,
			entries: [
				{
					id: "a",
					type: "assistant",
					content: "landed",
					timestamp: new Date().toISOString(),
				},
			],
		});
		expect(sessionFeedSnapshot(sessionId).active?.text).toBe("");
	});

	test("does not replay a completed ephemeral stream", () => {
		const sessionId = `feed-${crypto.randomUUID()}`;
		const start = appendSessionFeed(sessionId, {
			type: "stream_start",
			sessionId,
		});
		appendSessionFeed(sessionId, {
			type: "stream_text",
			sessionId,
			text: "done",
		});
		appendSessionFeed(sessionId, { type: "stream_done", sessionId });
		const resumed = resumeSessionFeed(sessionId, 0, start.feedEpoch);
		expect(resumed.frames).toEqual([]);
		expect(resumed.snapshot.active).toBeNull();
	});

	test("stream boundaries emit authoritative running transitions", () => {
		const sessionId = `feed-${crypto.randomUUID()}`;
		const states: boolean[] = [];
		const unsubscribe = onSessionStateChange((event) => {
			if (event.sessionId === sessionId) states.push(event.isRunning);
		});
		try {
			appendSessionFeed(sessionId, { type: "stream_start", sessionId });
			appendSessionFeed(sessionId, { type: "stream_done", sessionId });
		} finally {
			unsubscribe();
		}
		expect(states).toEqual([true, false]);
	});
});
