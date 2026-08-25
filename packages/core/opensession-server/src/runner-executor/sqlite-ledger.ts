import { Database } from "bun:sqlite";
import {
  chmodSync,
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  mkdirSync,
  openSync,
} from "node:fs";
import { dirname, parse, resolve } from "node:path";
import type {
  ExecutorOperationOutcome,
  ExecutorReceipt,
  ExecutorStreamEvent,
} from "@tellahq/opensession-protocol/executor";
import {
  LedgerFullError,
  type DurableCommandLedger,
  type LedgerRecord,
} from "./ledger";

const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/;
const STATES = new Set([
  "queued",
  "running",
  "succeeded",
  "failed",
  "cancelled",
]);
const ERROR_CODES = new Set([
  "invalid_request",
  "invalid_grant",
  "stale_generation",
  "deadline_exceeded",
  "not_found",
  "conflict",
  "cancelled",
  "operation_failed",
  "executor_busy",
  "unsupported",
]);
const encoder = new TextEncoder();

type StoredRow = {
  receipt_id: unknown;
  command_kind: unknown;
  command_key: unknown;
  payload: unknown;
};

export interface SQLiteCommandLedgerOptions {
  dbPath: string;
  capacity?: number;
  busyTimeoutMs?: number;
  maxRecordBytes?: number;
  maxStringBytes?: number;
  maxEvents?: number;
}

type Limits = Required<
  Pick<
    SQLiteCommandLedgerOptions,
    "maxRecordBytes" | "maxStringBytes" | "maxEvents"
  >
>;

/**
 * Opens a durable ledger. Importing this module is inert; callers own this
 * explicit open/close boundary.
 */
export function openSQLiteCommandLedger(
  options: SQLiteCommandLedgerOptions,
): SQLiteCommandLedger {
  return SQLiteCommandLedger.open(options);
}

export class SQLiteCommandLedger implements DurableCommandLedger {
  readonly #db: Database;
  readonly #capacity: number;
  readonly #limits: Limits;
  #closed = false;

  private constructor(db: Database, capacity: number, limits: Limits) {
    this.#db = db;
    this.#capacity = capacity;
    this.#limits = limits;
  }

  static open(options: SQLiteCommandLedgerOptions): SQLiteCommandLedger {
    const capacity = positiveInteger(
      options.capacity ?? 1_024,
      "ledger capacity",
    );
    const busyTimeoutMs = positiveInteger(
      options.busyTimeoutMs ?? 5_000,
      "busy timeout",
    );
    const limits = {
      maxRecordBytes: positiveInteger(
        options.maxRecordBytes ?? 1024 * 1024,
        "record byte limit",
      ),
      maxStringBytes: positiveInteger(
        options.maxStringBytes ?? 256 * 1024,
        "string byte limit",
      ),
      maxEvents: positiveInteger(options.maxEvents ?? 4_096, "event limit"),
    };
    if (!options.dbPath || options.dbPath === ":memory:")
      throw new Error(
        "a filesystem database path is required for a durable ledger",
      );

    const dbPath = resolve(options.dbPath);
    preparePrivateDatabasePath(dbPath);

    const db = new Database(dbPath, { create: true, strict: true });
    try {
      chmodSync(dbPath, 0o600);
      db.exec(`
        PRAGMA journal_mode = WAL;
        PRAGMA synchronous = FULL;
        PRAGMA busy_timeout = ${busyTimeoutMs};
        PRAGMA foreign_keys = ON;
        CREATE TABLE IF NOT EXISTS runner_command_ledger (
          receipt_id TEXT PRIMARY KEY NOT NULL,
          command_kind TEXT NOT NULL CHECK(command_kind IN ('request', 'mutation')),
          command_key TEXT NOT NULL,
          state TEXT NOT NULL CHECK(state IN ('queued', 'running', 'succeeded', 'failed', 'cancelled')),
          payload TEXT NOT NULL,
          UNIQUE(command_kind, command_key)
        );
      `);
      secureDatabaseFiles(dbPath);
      return new SQLiteCommandLedger(db, capacity, limits);
    } catch (cause) {
      db.close();
      throw cause;
    }
  }

  async find(
    requestId: string,
    idempotencyKey?: string,
  ): Promise<LedgerRecord | undefined> {
    this.#assertOpen();
    validateId(requestId, "requestId");
    if (idempotencyKey !== undefined)
      validateCommandKey(idempotencyKey, this.#limits.maxStringBytes);
    const kind = idempotencyKey === undefined ? "request" : "mutation";
    const key = idempotencyKey ?? requestId;
    const row = this.#db
      .query(
        "SELECT receipt_id, command_kind, command_key, payload FROM runner_command_ledger WHERE command_kind = ? AND command_key = ?",
      )
      .get(kind, key) as StoredRow | null;
    return row ? decodeRow(row, this.#limits, kind, key) : undefined;
  }

  async put(record: LedgerRecord): Promise<void> {
    this.#assertOpen();
    const encoded = encodeRecord(record, this.#limits);
    const kind = record.idempotencyKey === undefined ? "request" : "mutation";
    const key = record.idempotencyKey ?? record.requestId;
    this.#writeTransaction(() => {
      const byCommand = this.#db
        .query(
          "SELECT receipt_id, command_kind, command_key, payload FROM runner_command_ledger WHERE command_kind = ? AND command_key = ?",
        )
        .get(kind, key) as StoredRow | null;
      if (byCommand) {
        const current = decodeRow(byCommand, this.#limits, kind, key);
        if (JSON.stringify(current) === encoded) return;
        throw new Error("command already has a different ledger record");
      }
      const byReceipt = this.#db
        .query(
          "SELECT receipt_id, command_kind, command_key, payload FROM runner_command_ledger WHERE receipt_id = ?",
        )
        .get(record.receipt.receiptId) as StoredRow | null;
      if (byReceipt) {
        decodeRow(byReceipt, this.#limits);
        throw new Error("receipt already belongs to a different command");
      }
      const count = this.#db
        .query("SELECT COUNT(*) AS count FROM runner_command_ledger")
        .get() as { count: number };
      if (count.count >= this.#capacity) throw new LedgerFullError();
      this.#db
        .query(
          "INSERT INTO runner_command_ledger (receipt_id, command_kind, command_key, state, payload) VALUES (?, ?, ?, ?, ?)",
        )
        .run(
          record.receipt.receiptId,
          kind,
          key,
          record.receipt.state,
          encoded,
        );
    });
  }

  async update(
    receiptId: string,
    update: Partial<Omit<LedgerRecord, "requestId" | "receipt">> & {
      receipt: ExecutorReceipt;
    },
  ): Promise<void> {
    this.#assertOpen();
    validateId(receiptId, "receiptId");
    this.#writeTransaction(() => {
      const row = this.#db
        .query(
          "SELECT receipt_id, command_kind, command_key, payload FROM runner_command_ledger WHERE receipt_id = ?",
        )
        .get(receiptId) as StoredRow | null;
      if (!row) throw new Error("receipt not found");
      const current = decodeRow(row, this.#limits);
      if (
        update.receipt.receiptId !== receiptId ||
        update.receipt.requestId !== current.requestId ||
        update.receipt.idempotencyKey !== current.idempotencyKey ||
        ("idempotencyKey" in update &&
          update.idempotencyKey !== current.idempotencyKey)
      )
        throw new Error("ledger identity is immutable");
      const merged: LedgerRecord = {
        ...current,
        ...update,
        requestId: current.requestId,
        idempotencyKey: current.idempotencyKey,
        receipt: update.receipt,
      };
      if (current.idempotencyKey === undefined) delete merged.idempotencyKey;
      const encoded = encodeRecord(merged, this.#limits);
      this.#db
        .query(
          "UPDATE runner_command_ledger SET state = ?, payload = ? WHERE receipt_id = ?",
        )
        .run(merged.receipt.state, encoded, receiptId);
    });
  }

  async get(receiptId: string): Promise<LedgerRecord | undefined> {
    this.#assertOpen();
    validateId(receiptId, "receiptId");
    const row = this.#db
      .query(
        "SELECT receipt_id, command_kind, command_key, payload FROM runner_command_ledger WHERE receipt_id = ?",
      )
      .get(receiptId) as StoredRow | null;
    return row ? decodeRow(row, this.#limits) : undefined;
  }

  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    this.#db.close();
  }

  #assertOpen(): void {
    if (this.#closed) throw new Error("command ledger is closed");
  }

  #writeTransaction<T>(operation: () => T): T {
    this.#db.exec("BEGIN IMMEDIATE");
    try {
      const result = operation();
      this.#db.exec("COMMIT");
      return result;
    } catch (cause) {
      try {
        this.#db.exec("ROLLBACK");
      } catch {
        /* preserve the original failure */
      }
      throw cause;
    }
  }
}

function encodeRecord(record: LedgerRecord, limits: Limits): string {
  validateRecord(record, limits);
  const encoded = JSON.stringify(record);
  if (encoder.encode(encoded).byteLength > limits.maxRecordBytes)
    throw new Error("ledger record exceeds byte limit");
  return encoded;
}

function decodeRow(
  row: StoredRow,
  limits: Limits,
  expectedKind?: string,
  expectedKey?: string,
): LedgerRecord {
  if (
    typeof row.receipt_id !== "string" ||
    typeof row.command_kind !== "string" ||
    typeof row.command_key !== "string" ||
    typeof row.payload !== "string"
  )
    throw new Error("malformed ledger row");
  if (encoder.encode(row.payload).byteLength > limits.maxRecordBytes)
    throw new Error("persisted ledger record exceeds byte limit");
  let value: unknown;
  try {
    value = JSON.parse(row.payload);
  } catch {
    throw new Error("malformed ledger JSON");
  }
  validateRecord(value, limits);
  const record = value as LedgerRecord;
  const kind = record.idempotencyKey === undefined ? "request" : "mutation";
  const key = record.idempotencyKey ?? record.requestId;
  if (
    row.receipt_id !== record.receipt.receiptId ||
    row.command_kind !== kind ||
    row.command_key !== key ||
    (expectedKind !== undefined && row.command_kind !== expectedKind) ||
    (expectedKey !== undefined && row.command_key !== expectedKey)
  )
    throw new Error("ledger row identity mismatch");
  return structuredClone(record);
}

function validateRecord(
  value: unknown,
  limits: Limits,
): asserts value is LedgerRecord {
  if (
    !plainObject(value) ||
    !onlyKeys(value, [
      "requestId",
      "idempotencyKey",
      "receipt",
      "outcome",
      "events",
      "error",
    ])
  )
    throw new Error("invalid ledger record");
  validateId(value.requestId, "requestId");
  if (value.idempotencyKey !== undefined)
    validateCommandKey(value.idempotencyKey, limits.maxStringBytes);
  validateReceipt(value.receipt, value.requestId, value.idempotencyKey);
  if (value.outcome !== undefined) validateOutcome(value.outcome, limits);
  if (value.events !== undefined) {
    if (!Array.isArray(value.events) || value.events.length > limits.maxEvents)
      throw new Error("invalid ledger events");
    for (const event of value.events) validateEvent(event, limits);
  }
  if (value.error !== undefined) {
    if (
      !plainObject(value.error) ||
      !onlyKeys(value.error, ["code", "message"]) ||
      typeof value.error.code !== "string" ||
      !ERROR_CODES.has(value.error.code) ||
      !boundedString(value.error.message, limits.maxStringBytes, true)
    )
      throw new Error("invalid ledger error");
  }
}

function validateReceipt(
  value: unknown,
  requestId: string,
  idempotencyKey: string | undefined,
): asserts value is ExecutorReceipt {
  if (
    !plainObject(value) ||
    !onlyKeys(value, [
      "receiptId",
      "requestId",
      "state",
      "acceptedAt",
      "idempotencyKey",
      "completedAt",
    ])
  )
    throw new Error("invalid receipt");
  validateId(value.receiptId, "receiptId");
  if (
    value.requestId !== requestId ||
    value.idempotencyKey !== idempotencyKey ||
    typeof value.state !== "string" ||
    !STATES.has(value.state) ||
    !isoDate(value.acceptedAt) ||
    (value.completedAt !== undefined && !isoDate(value.completedAt))
  )
    throw new Error("invalid receipt identity or fields");
  const terminal =
    value.state === "succeeded" ||
    value.state === "failed" ||
    value.state === "cancelled";
  if (terminal !== (value.completedAt !== undefined))
    throw new Error("receipt completion does not match state");
}

function validateOutcome(
  value: unknown,
  limits: Limits,
): asserts value is ExecutorOperationOutcome {
  if (!plainObject(value) || typeof value.kind !== "string")
    throw new Error("invalid outcome");
  const id = (v: unknown) => boundedString(v, 256, true);
  switch (value.kind) {
    case "fs.read":
      if (
        onlyKeys(value, ["kind", "streamId", "size", "binary"]) &&
        id(value.streamId) &&
        nonnegative(value.size) &&
        typeof value.binary === "boolean"
      )
        return;
      break;
    case "fs.list":
      if (
        onlyKeys(value, ["kind", "entries"]) &&
        Array.isArray(value.entries) &&
        value.entries.length <= limits.maxEvents &&
        value.entries.every(
          (entry) =>
            plainObject(entry) &&
            onlyKeys(entry, ["path", "type", "size"]) &&
            boundedString(entry.path, limits.maxStringBytes, true) &&
            ["file", "directory", "symlink"].includes(entry.type as string) &&
            (entry.size === undefined || nonnegative(entry.size)),
        )
      )
        return;
      break;
    case "fs.stat": {
      const entry = value.entry;
      if (
        onlyKeys(value, ["kind", "entry"]) &&
        plainObject(entry) &&
        onlyKeys(entry, ["path", "type", "size", "modifiedAt"]) &&
        boundedString(entry.path, limits.maxStringBytes, true) &&
        ["file", "directory", "symlink"].includes(entry.type as string) &&
        nonnegative(entry.size) &&
        (entry.modifiedAt === undefined || isoDate(entry.modifiedAt))
      )
        return;
      break;
    }
    case "fs.changed":
      if (
        onlyKeys(value, ["kind", "path"]) &&
        boundedString(value.path, limits.maxStringBytes, true)
      )
        return;
      break;
    case "process":
      if (
        onlyKeys(value, [
          "kind",
          "processId",
          "state",
          "exitCode",
          "streamId",
        ]) &&
        id(value.processId) &&
        ["starting", "running", "exited"].includes(value.state as string) &&
        (value.exitCode === undefined ||
          Number.isSafeInteger(value.exitCode)) &&
        (value.streamId === undefined || id(value.streamId))
      )
        return;
      break;
    case "terminal":
      if (
        onlyKeys(value, ["kind", "terminalId", "state", "streamId"]) &&
        id(value.terminalId) &&
        ["open", "closed"].includes(value.state as string) &&
        (value.streamId === undefined || id(value.streamId))
      )
        return;
      break;
    case "service":
      if (
        onlyKeys(value, ["kind", "serviceId", "state", "streamId"]) &&
        id(value.serviceId) &&
        ["starting", "running", "stopped", "failed"].includes(
          value.state as string,
        ) &&
        (value.streamId === undefined || id(value.streamId))
      )
        return;
      break;
    case "portal":
      if (
        onlyKeys(value, ["kind", "portalId", "state"]) &&
        id(value.portalId) &&
        ["opening", "open", "closed", "failed"].includes(value.state as string)
      )
        return;
      break;
  }
  throw new Error("invalid outcome");
}

function validateEvent(
  value: unknown,
  limits: Limits,
): asserts value is ExecutorStreamEvent {
  if (
    !plainObject(value) ||
    typeof value.kind !== "string" ||
    !boundedString(value.streamId, 256, true) ||
    !nonnegative(value.sequence)
  )
    throw new Error("invalid stream event");
  const eof = value.eof === undefined || typeof value.eof === "boolean";
  if (
    value.kind === "text" &&
    onlyKeys(value, [
      "kind",
      "streamId",
      "sequence",
      "channel",
      "data",
      "eof",
    ]) &&
    ["stdout", "stderr", "terminal", "file"].includes(
      value.channel as string,
    ) &&
    boundedString(value.data, limits.maxStringBytes) &&
    eof
  )
    return;
  if (
    value.kind === "exit" &&
    onlyKeys(value, ["kind", "streamId", "sequence", "exitCode", "signal"]) &&
    (value.exitCode === null || Number.isSafeInteger(value.exitCode)) &&
    (value.signal === undefined || boundedString(value.signal, 256, true))
  )
    return;
  if (
    value.kind === "binary" &&
    onlyKeys(value, [
      "kind",
      "streamId",
      "sequence",
      "offset",
      "data",
      "metadata",
      "eof",
    ]) &&
    nonnegative(value.offset) &&
    boundedString(value.data, limits.maxStringBytes) &&
    eof
  ) {
    const metadata = value.metadata;
    if (
      plainObject(metadata) &&
      onlyKeys(metadata, ["encoding", "byteLength", "mediaType", "sha256"]) &&
      metadata.encoding === "base64" &&
      nonnegative(metadata.byteLength) &&
      (metadata.mediaType === undefined ||
        boundedString(metadata.mediaType, 256, true)) &&
      (metadata.sha256 === undefined ||
        (typeof metadata.sha256 === "string" &&
          /^[a-f0-9]{64}$/.test(metadata.sha256)))
    )
      return;
  }
  throw new Error("invalid stream event");
}

function plainObject(value: unknown): value is Record<string, unknown> {
  return (
    !!value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}
function onlyKeys(value: Record<string, unknown>, allowed: string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}
function boundedString(
  value: unknown,
  max: number,
  nonempty = false,
): value is string {
  return (
    typeof value === "string" &&
    (!nonempty || value.length > 0) &&
    encoder.encode(value).byteLength <= max
  );
}
function validateId(value: unknown, name: string): asserts value is string {
  if (typeof value !== "string" || !ID_RE.test(value))
    throw new Error(`invalid ${name}`);
}
function validateCommandKey(
  value: unknown,
  maxBytes: number,
): asserts value is string {
  // The executor wire model deliberately permits any nonempty string here.
  // Keep that model intact while applying this persistence boundary's byte cap.
  if (!boundedString(value, maxBytes, true))
    throw new Error("invalid idempotencyKey");
}
function nonnegative(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}
function isoDate(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length <= 32 &&
    new Date(value).toISOString() === value
  );
}
function positiveInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 1)
    throw new Error(`${name} must be a positive integer`);
  return value;
}
function preparePrivateDatabasePath(dbPath: string): void {
  const parent = dirname(dbPath);
  mkdirSync(parent, { recursive: true, mode: 0o700 });
  const root = parse(parent).root;
  let current = root;
  for (const part of parent
    .slice(root.length)
    .split(/[\\/]+/u)
    .filter(Boolean)) {
    current = resolve(current, part);
    const stat = lstatSync(current);
    if (stat.isSymbolicLink() || !stat.isDirectory())
      throw new Error(`unsafe ledger path component: ${current}`);
  }
  chmodSync(parent, 0o700);
  const descriptor = openSync(
    dbPath,
    constants.O_CREAT | constants.O_RDWR | (constants.O_NOFOLLOW ?? 0),
    0o600,
  );
  try {
    if (!fstatSync(descriptor).isFile())
      throw new Error("ledger database path is not a regular file");
    chmodSync(dbPath, 0o600);
  } finally {
    closeSync(descriptor);
  }
}

function secureDatabaseFiles(path: string): void {
  for (const file of [path, `${path}-wal`, `${path}-shm`]) {
    const stat = lstatSync(file, { throwIfNoEntry: false });
    if (!stat) continue;
    if (stat.isSymbolicLink() || !stat.isFile())
      throw new Error(`unsafe ledger SQLite file: ${file}`);
    chmodSync(file, 0o600);
  }
}

// Accommodate the repository's conventional `Sqlite*` spelling too.
export { SQLiteCommandLedger as SqliteCommandLedger };
