import { afterEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { LedgerRecord } from "./ledger";
import {
  openSQLiteCommandLedger,
  type SQLiteCommandLedger,
} from "./sqlite-ledger";

const roots: string[] = [];
const ledgers: SQLiteCommandLedger[] = [];

afterEach(() => {
  for (const ledger of ledgers.splice(0)) ledger.close();
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

function pathFor(name = "ledger.sqlite"): string {
  const root = mkdtempSync(join(tmpdir(), "sqlite-ledger-"));
  roots.push(root);
  return join(root, "private", name);
}

function open(
  dbPath = pathFor(),
  options: Record<string, number> = {},
): SQLiteCommandLedger {
  const ledger = openSQLiteCommandLedger({ dbPath, ...options });
  ledgers.push(ledger);
  return ledger;
}

function record(
  requestId: string,
  receiptId: string,
  idempotencyKey?: string,
): LedgerRecord {
  return {
    requestId,
    ...(idempotencyKey ? { idempotencyKey } : {}),
    receipt: {
      receiptId,
      requestId,
      ...(idempotencyKey ? { idempotencyKey } : {}),
      state: "queued",
      acceptedAt: "2026-08-22T12:00:00.000Z",
    },
  };
}

function close(ledger: SQLiteCommandLedger): void {
  ledger.close();
  ledgers.splice(ledgers.indexOf(ledger), 1);
}

describe("SQLiteCommandLedger", () => {
  test("persists receipts and complete replay data across reopen", async () => {
    const dbPath = pathFor();
    const first = open(dbPath);
    const initial = record("request-1", "receipt-1", "mutation-1");
    await first.put(initial);
    await first.update("receipt-1", {
      receipt: {
        ...initial.receipt,
        state: "succeeded",
        completedAt: "2026-08-22T12:00:01.000Z",
      },
      outcome: { kind: "fs.changed", path: "/workspace/a.txt" },
      events: [
        {
          kind: "text",
          streamId: "stream-1",
          sequence: 0,
          channel: "stdout",
          data: "done",
          eof: true,
        },
      ],
    });
    const expected = await first.get("receipt-1");
    close(first);

    const reopened = open(dbPath);
    expect(
      await reopened.find("a-different-retry-request", "mutation-1"),
    ).toEqual(expected);
    expect(await reopened.get("receipt-1")).toEqual(expected);
  });

  test("allows only an exact duplicate put and fails closed on conflicts", async () => {
    const ledger = open();
    const original = record("request-1", "receipt-1", "mutation-1");
    await ledger.put(original);
    await ledger.put(structuredClone(original));
    await expect(
      ledger.put(record("request-2", "receipt-2", "mutation-1")),
    ).rejects.toThrow("different ledger record");
    await expect(
      ledger.put(record("request-2", "receipt-1", "mutation-2")),
    ).rejects.toThrow("receipt already belongs");
    expect(await ledger.get("receipt-1")).toEqual(original);
  });

  test("mutation identity ignores request ID while reads are request-unique", async () => {
    const ledger = open();
    const mutation = record("request-1", "receipt-1", "mutation-1");
    const read = record("request-read", "receipt-read");
    await ledger.put(mutation);
    await ledger.put(read);
    expect(await ledger.find("request-2", "mutation-1")).toEqual(mutation);
    expect(await ledger.find("request-read")).toEqual(read);
    expect(await ledger.find("request-other")).toBeUndefined();
  });

  test("updates atomically and rolls back invalid identity or payload", async () => {
    const ledger = open(undefined, { maxStringBytes: 32 });
    const original = record("request-1", "receipt-1", "mutation-1");
    await ledger.put(original);
    await expect(
      ledger.update("receipt-1", {
        receipt: {
          ...original.receipt,
          requestId: "request-2",
          state: "running",
        },
      }),
    ).rejects.toThrow("immutable");
    await expect(
      ledger.update("receipt-1", {
        receipt: {
          ...original.receipt,
          state: "failed",
          completedAt: "2026-08-22T12:00:01.000Z",
        },
        error: { code: "operation_failed", message: "x".repeat(33) },
      }),
    ).rejects.toThrow("invalid ledger error");
    expect(await ledger.get("receipt-1")).toEqual(original);
  });

  test("reports missing receipts", async () => {
    const ledger = open();
    expect(await ledger.get("receipt-missing")).toBeUndefined();
    await expect(
      ledger.update("receipt-missing", {
        receipt: record("request-1", "receipt-missing").receipt,
      }),
    ).rejects.toThrow("receipt not found");
  });

  test("capacity exhaustion never evicts active or mutation records", async () => {
    const ledger = open(undefined, { capacity: 2 });
    const mutation = record("request-1", "receipt-1", "mutation-1");
    const running = record("request-2", "receipt-2");
    running.receipt.state = "running";
    await ledger.put(mutation);
    await ledger.put(running);
    await expect(
      ledger.put(record("request-3", "receipt-3")),
    ).rejects.toMatchObject({ name: "LedgerFullError" });
    expect(await ledger.find("retry", "mutation-1")).toEqual(mutation);
    expect(await ledger.get("receipt-2")).toEqual(running);
  });

  test("serializes concurrent connections and preserves one mutation identity", async () => {
    const dbPath = pathFor();
    const a = open(dbPath);
    const b = open(dbPath);
    const attempts = await Promise.allSettled([
      a.put(record("request-a", "receipt-a", "mutation-shared")),
      b.put(record("request-b", "receipt-b", "mutation-shared")),
    ]);
    expect(
      attempts.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    expect(
      attempts.filter((result) => result.status === "rejected"),
    ).toHaveLength(1);
    const saved = await a.find("retry", "mutation-shared");
    expect(saved).toBeDefined();
    expect(["receipt-a", "receipt-b"]).toContain(saved!.receipt.receiptId);
    expect(await b.find("retry", "mutation-shared")).toEqual(saved);
  });

  test("rejects malformed JSON and inconsistent persisted rows", async () => {
    const dbPath = pathFor();
    const ledger = open(dbPath);
    await ledger.put(record("request-1", "receipt-1"));
    close(ledger);
    const raw = new Database(dbPath);
    raw
      .query(
        "UPDATE runner_command_ledger SET payload = ? WHERE receipt_id = ?",
      )
      .run("{bad", "receipt-1");
    raw.close();
    const corrupt = open(dbPath);
    await expect(corrupt.get("receipt-1")).rejects.toThrow(
      "malformed ledger JSON",
    );
    close(corrupt);

    const raw2 = new Database(dbPath);
    raw2
      .query(
        "UPDATE runner_command_ledger SET payload = ? WHERE receipt_id = ?",
      )
      .run(JSON.stringify(record("other-request", "receipt-1")), "receipt-1");
    raw2.close();
    const inconsistent = open(dbPath);
    await expect(inconsistent.get("receipt-1")).rejects.toThrow(
      "identity mismatch",
    );
  });

  test("rejects malformed protocol values and oversized records on write and read", async () => {
    const dbPath = pathFor();
    const ledger = open(dbPath, {
      maxRecordBytes: 700,
      maxStringBytes: 64,
      maxEvents: 1,
    });
    const invalid = record("request-1", "receipt-1") as LedgerRecord & {
      unexpected?: boolean;
    };
    invalid.unexpected = true;
    await expect(ledger.put(invalid)).rejects.toThrow("invalid ledger record");

    const tooMany = record("request-2", "receipt-2");
    tooMany.events = [
      {
        kind: "text",
        streamId: "s",
        sequence: 0,
        channel: "stdout",
        data: "a",
      },
      {
        kind: "text",
        streamId: "s",
        sequence: 1,
        channel: "stdout",
        data: "b",
      },
    ];
    await expect(ledger.put(tooMany)).rejects.toThrow("invalid ledger events");
    await expect(
      ledger.put({
        ...record("request-3", "receipt-3"),
        outcome: { kind: "fs.changed", path: "x".repeat(65) },
      }),
    ).rejects.toThrow("invalid outcome");

    const valid = record("request-4", "receipt-4");
    await ledger.put(valid);
    close(ledger);
    const raw = new Database(dbPath);
    raw
      .query(
        "UPDATE runner_command_ledger SET payload = ? WHERE receipt_id = ?",
      )
      .run(" ".repeat(701), "receipt-4");
    raw.close();
    const reopened = open(dbPath, {
      maxRecordBytes: 700,
      maxStringBytes: 64,
      maxEvents: 1,
    });
    await expect(reopened.get("receipt-4")).rejects.toThrow(
      "exceeds byte limit",
    );
  });

  test("has an explicit close boundary and secures directory/database modes", async () => {
    const dbPath = pathFor();
    const ledger = open(dbPath);
    expect(statSync(join(dbPath, "..")).mode & 0o777).toBe(0o700);
    expect(statSync(dbPath).mode & 0o777).toBe(0o600);
    close(ledger);
    await expect(ledger.get("receipt-1")).rejects.toThrow("closed");
  });

  test("import is inert", () => {
    const root = mkdtempSync(join(tmpdir(), "sqlite-ledger-import-"));
    roots.push(root);
    const marker = join(root, "before");
    writeFileSync(marker, "unchanged");
    const modulePath = join(import.meta.dir, "sqlite-ledger.ts");
    const result = Bun.spawnSync(
      [process.execPath, "-e", `await import(${JSON.stringify(modulePath)})`],
      { cwd: root },
    );
    expect(result.exitCode).toBe(0);
    expect(readFileSync(marker, "utf8")).toBe("unchanged");
    expect(Array.from(new Bun.Glob("**/*").scanSync({ cwd: root }))).toEqual([
      "before",
    ]);
  });
});
