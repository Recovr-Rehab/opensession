import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  TranscriptAppendConflictError,
  TranscriptStore,
  TRANSCRIPT_DESTINATION_MAX_BYTES,
  TRANSCRIPT_DESTINATION_MAX_ENTRIES,
  setAppendHook,
  type DestinationTranscriptAppendRequest,
} from "./transcript-store";
import { subscribeTranscript } from "./transcript-bus";
import { SessionKernelStore } from "./session-kernel/store";
import {
  __setSessionKernelStoreForTest,
  sessionGatewayCommand,
} from "./session-kernel";
import { executeDestinationIdempotentSessionProjection } from "./session-projection-executor";

function request(
  over: Partial<DestinationTranscriptAppendRequest> = {},
): DestinationTranscriptAppendRequest {
  return {
    sessionId: "os-destination",
    runId: "run-1",
    turnId: "turn-1",
    generation: 1,
    appendId: "append-1",
    entries: [
      {
        id: "entry-1",
        type: "assistant",
        content: "hello",
        timestamp: "2026-08-22T00:00:00.000Z",
      },
    ],
    ...over,
  };
}

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "transcript-destination-"));
  const path = join(dir, "transcripts.db");
  return { dir, path, store: new TranscriptStore(path) };
}

function receiptCount(path: string, sessionId = "os-destination") {
  const db = new Database(path, { readonly: true });
  try {
    return (
      db
        .query(
          "SELECT COUNT(*) AS n FROM transcript_append_receipts WHERE session_id = ?",
        )
        .get(sessionId) as { n: number }
    ).n;
  } finally {
    db.close();
  }
}

describe("destination-idempotent transcript append receipts", () => {
  test("persists an exact first result and replays it across reopen without writes or notifications", async () => {
    const { dir, path, store } = fixture();
    let hooks = 0;
    let bus = 0;
    setAppendHook(() => hooks++);
    const unsubscribe = subscribeTranscript("os-destination", () => bus++);
    try {
      const first = store.commitTranscriptDestinationAppend(request());
      expect(first).toEqual({
        firstSeq: 1,
        lastSeq: 1,
        inserted: 1,
        updated: 0,
        changes: [{ entryId: "entry-1", seq: 1, changeSeq: 1 }],
      });
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect([hooks, bus]).toEqual([1, 1]);
      expect(receiptCount(path)).toBe(1);
      store.close();

      const reopened = new TranscriptStore(path);
      const replay = reopened.commitTranscriptDestinationAppend(request());
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(JSON.stringify(replay)).toBe(JSON.stringify(first));
      expect(reopened.getLastChangeSeq("os-destination")).toBe(1);
      expect(reopened.countEvents("os-destination")).toBe(1);
      expect([hooks, bus]).toEqual([1, 1]);
      reopened.close();
    } finally {
      unsubscribe();
      setAppendHook(null);
      try {
        store.close();
      } catch {}
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("same append id conflicts on every fence and payload category without mutation", () => {
    const { dir, path, store } = fixture();
    try {
      store.commitTranscriptDestinationAppend(request());
      const variants = [
        request({ sessionId: "os-other" }),
        request({ runId: "run-2" }),
        request({ turnId: "turn-2" }),
        request({ generation: 2 }),
        request({
          entries: [{ ...request().entries[0]!, content: "changed" }],
        }),
        request({ entries: [{ ...request().entries[0]!, id: "entry-2" }] }),
      ];
      for (const variant of variants) {
        if (variant.sessionId !== "os-destination") continue; // identity is scoped by session
        expect(() => store.commitTranscriptDestinationAppend(variant)).toThrow(
          TranscriptAppendConflictError,
        );
      }
      expect(store.getLastChangeSeq("os-destination")).toBe(1);
      expect(store.readTail("os-destination").entries[0]?.content).toBe(
        "hello",
      );
      expect(receiptCount(path)).toBe(1);
    } finally {
      store.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("concurrent and serialized duplicates retain original seq and exact change receipts", async () => {
    const { dir, store } = fixture();
    try {
      const input = request();
      const [first, concurrentReplay] = await Promise.all([
        Promise.resolve().then(() =>
          store.commitTranscriptDestinationAppend(input),
        ),
        Promise.resolve().then(() =>
          store.commitTranscriptDestinationAppend(input),
        ),
      ]);
      expect(concurrentReplay).toEqual(first);
      expect(store.commitTranscriptDestinationAppend(input)).toEqual(first);
      const rewrite = request({
        appendId: "append-2",
        entries: [{ ...input.entries[0]!, content: "rewritten" }],
      });
      const result = store.commitTranscriptDestinationAppend(rewrite);
      expect(result).toEqual({
        firstSeq: 1,
        lastSeq: 1,
        inserted: 0,
        updated: 1,
        changes: [{ entryId: "entry-1", seq: 1, changeSeq: 2 }],
      });
      expect(store.commitTranscriptDestinationAppend(rewrite)).toEqual(result);
      expect(store.getLastSeq(input.sessionId)).toBe(1);
      expect(store.getLastChangeSeq(input.sessionId)).toBe(2);
    } finally {
      store.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("authoritative replacement and import retain receipts, while deletion removes them atomically", () => {
    const { dir, path, store } = fixture();
    try {
      const input = request();
      const original = store.commitTranscriptDestinationAppend(input);
      store.replaceTranscriptEvents(input.sessionId, [
        { ...input.entries[0]!, content: "replacement" },
      ]);
      store.importLegacyTranscript(
        input.sessionId,
        [{ ...input.entries[0]!, content: "import" }],
        "merged",
        10,
      );
      expect(receiptCount(path)).toBe(1);
      expect(store.commitTranscriptDestinationAppend(input)).toEqual(original);
      expect(store.readTail(input.sessionId).entries[0]?.content).toBe(
        "import",
      );
      store.deleteSessionTranscript(input.sessionId);
      expect(receiptCount(path)).toBe(0);
      expect(store.countEvents(input.sessionId)).toBe(0);
    } finally {
      store.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("rejects empty, unknown, non-JSON, malformed, and bounded inputs before schema mutation", () => {
    const { dir, path, store } = fixture();
    try {
      const invalid: unknown[] = [
        request({ entries: [] }),
        { ...request(), unknown: true },
        request({ generation: Number.NaN }),
        { ...request(), appendId: undefined },
        request({
          entries: [{ ...request().entries[0]!, surprise: true } as never],
        }),
        request({
          entries: [{ ...request().entries[0]!, timestamp: "invalid" }],
        }),
        request({
          entries: [{ ...request().entries[0]!, content: undefined } as never],
        }),
        request({
          entries: Array.from(
            { length: TRANSCRIPT_DESTINATION_MAX_ENTRIES + 1 },
            (_, i) => ({ ...request().entries[0]!, id: `e-${i}` }),
          ),
        }),
        request({
          entries: [
            {
              ...request().entries[0]!,
              content: "x".repeat(TRANSCRIPT_DESTINATION_MAX_BYTES + 1),
            },
          ],
        }),
      ];
      const polluted = Object.create({ inherited: true });
      Object.assign(polluted, request());
      invalid.push(polluted);
      let nested: unknown = "leaf";
      for (let depth = 0; depth < 70; depth++) nested = [nested];
      invalid.push(
        request({ entries: [{ ...request().entries[0]!, toolInput: nested }] }),
      );
      for (const value of invalid)
        expect(() =>
          store.commitTranscriptDestinationAppend(
            value as DestinationTranscriptAppendRequest,
          ),
        ).toThrow();
      expect(receiptCount(path)).toBe(0);
      expect(store.countEvents("os-destination")).toBe(0);
    } finally {
      store.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("recovers the crash window after destination commit with actor command incomplete", () => {
    const { dir, path, store } = fixture();
    const kernelPath = join(dir, "kernel.sqlite");
    let kernel = new SessionKernelStore(kernelPath);
    const command = {
      sessionId: "os-destination",
      requestId: "transcript-destination:append-1",
      operation: "transcript_destination_append" as const,
      identity: {
        digest: "bound-by-destination",
        fence: { runId: "run-1", turnId: "turn-1", generation: 1 },
      },
    };
    try {
      expect(kernel.requestGatewayCommand(command)).toEqual({
        status: "execute",
      });
      const committed = store.commitTranscriptDestinationAppend(request());
      kernel.close(); // crash before completeGatewayCommand
      kernel = new SessionKernelStore(kernelPath);
      expect(kernel.requestGatewayCommand(command)).toEqual({
        status: "execute",
      });
      const replay = store.commitTranscriptDestinationAppend(request());
      expect(replay).toEqual(committed);
      expect(store.getLastChangeSeq(command.sessionId)).toBe(1);
      expect(
        kernel.completeGatewayCommand({ ...command, result: replay }),
      ).toEqual(committed);
    } finally {
      kernel.close();
      store.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("destination continuation does not hold the session actor mailbox", () => {
    const { dir, store } = fixture();
    const kernel = new SessionKernelStore(
      join(dir, "responsive-kernel.sqlite"),
    );
    const previous = __setSessionKernelStoreForTest(kernel);
    try {
      const result = executeDestinationIdempotentSessionProjection(
        "os-responsive",
        "transcript-destination:responsive",
        "transcript_destination_append",
        { digest: "one" },
        () => {
          const admission = sessionGatewayCommand({
            op: "request",
            sessionId: "os-responsive",
            requestId: "transcript_append:responsive-sibling",
            operation: "transcript_append",
          });
          expect(admission).toEqual({ status: "execute" });
          sessionGatewayCommand({
            op: "complete",
            sessionId: "os-responsive",
            requestId: "transcript_append:responsive-sibling",
            operation: "transcript_append",
            result: "sibling-complete",
          });
          return "destination-complete";
        },
      );
      expect(result).toBe("destination-complete");
    } finally {
      __setSessionKernelStoreForTest(previous);
      kernel.close();
      store.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("schema creation is additive", () => {
    const { dir, path, store } = fixture();
    try {
      const db = new Database(path, { readonly: true });
      const row = db
        .query(
          "SELECT sql FROM sqlite_master WHERE type='table' AND name='transcript_append_receipts'",
        )
        .get() as { sql: string };
      expect(row.sql).toContain("PRIMARY KEY (session_id, append_id)");
      db.close();
    } finally {
      store.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
