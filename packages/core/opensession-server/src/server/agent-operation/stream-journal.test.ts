import { describe, expect, test } from "bun:test";
import {
  AgentOperationStreamJournal,
  AgentOperationStreamRecoveryRequiredError,
} from "./stream-journal";

describe("AgentOperationStreamJournal", () => {
  test("publication remains blocked until exact cumulative acknowledgement", async () => {
    const journal = new AgentOperationStreamJournal();
    let done = false;
    const publishing = journal.publish({ delta: "safe" }).then(() => {
      done = true;
    });
    await Promise.resolve();
    expect(done).toBe(false);
    const iterator = journal.replay(0)[Symbol.asyncIterator]();
    expect(new TextDecoder().decode((await iterator.next()).value)).toBe(
      '{"delta":"safe"}\n',
    );
    journal.acknowledge(1);
    await publishing;
    expect(done).toBe(true);
    await journal.close();
    expect((await iterator.next()).done).toBe(true);
  });
  test("rejects cursor gaps after acknowledged frames are retired", async () => {
    const journal = new AgentOperationStreamJournal();
    const publishing = journal.publish({ delta: "x" });
    journal.acknowledge(1);
    await publishing;
    expect(() => journal.replay(0)).toThrow(
      AgentOperationStreamRecoveryRequiredError,
    );
  });
  test("enforces 48 KiB chunks without retaining content in diagnostics", async () => {
    const journal = new AgentOperationStreamJournal();
    await expect(
      journal.publish({ secret: "x".repeat(49 * 1024) }),
    ).rejects.toBeInstanceOf(AgentOperationStreamRecoveryRequiredError);
    expect(
      JSON.stringify({ bytes: journal.bytes, frames: journal.frameCount }),
    ).not.toContain("secret");
  });
  test("failure rejects blocked publications and closes replay", async () => {
    const journal = new AgentOperationStreamJournal();
    const publishing = journal.publish({ delta: "x" });
    await journal.fail(new Error("closed"));
    await expect(publishing).rejects.toThrow("closed");
    const iterator = journal.replay(0)[Symbol.asyncIterator]();
    await expect(iterator.next()).resolves.toMatchObject({ done: false });
    await expect(iterator.next()).rejects.toThrow("closed");
  });
});
