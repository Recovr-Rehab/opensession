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
import type { ExecutorSource } from "./ingress";

const SCHEMA_VERSION = 1;

/** Durable incarnation claims and generation revocations for Executor ingress. */
export class SqliteExecutorInstanceClaims {
  readonly #db: Database;
  #closed = false;

  constructor(dbPath: string) {
    if (!dbPath || dbPath === ":memory:")
      throw new Error(
        "a filesystem database path is required for Executor claims",
      );
    const path = resolve(dbPath);
    preparePrivatePath(path);
    const db = new Database(path, { create: true, strict: true });
    try {
      db.exec(
        "PRAGMA busy_timeout = 5000; PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL;",
      );
      initialize(db);
      secureFiles(path);
      this.#db = db;
    } catch (error) {
      db.close();
      throw error;
    }
  }

  /** Atomically claims one instance identity for an exact generation. */
  claim(input: {
    source: ExecutorSource;
    executorId: string;
    generation: number;
    instanceId: string;
  }): boolean {
    this.#assertOpen();
    assertIdentity(input.executorId, "executorId");
    assertIdentity(input.instanceId, "instanceId");
    assertGeneration(input.generation);
    const transaction = this.#db.transaction(() => {
      const revoked = this.#db
        .query<{ through_generation: number }, [string, string]>(
          "SELECT through_generation FROM executor_generation_revocations WHERE source = ? AND executor_id = ?",
        )
        .get(input.source, input.executorId);
      if (revoked && input.generation <= revoked.through_generation)
        return false;
      const existing = this.#db
        .query<{ instance_id: string }, [string, string, number]>(
          "SELECT instance_id FROM executor_instance_claims WHERE source = ? AND executor_id = ? AND generation = ?",
        )
        .get(input.source, input.executorId, input.generation);
      if (existing) return existing.instance_id === input.instanceId;
      this.#db
        .query(
          "INSERT INTO executor_instance_claims (source, executor_id, generation, instance_id) VALUES (?, ?, ?, ?)",
        )
        .run(
          input.source,
          input.executorId,
          input.generation,
          input.instanceId,
        );
      return true;
    });
    return transaction.immediate();
  }

  revokeThrough(
    source: ExecutorSource,
    executorId: string,
    generation: number,
  ): void {
    this.#assertOpen();
    assertIdentity(executorId, "executorId");
    assertGeneration(generation);
    const transaction = this.#db.transaction(() => {
      this.#db
        .query(
          `INSERT INTO executor_generation_revocations (source, executor_id, through_generation)
           VALUES (?, ?, ?)
           ON CONFLICT(source, executor_id) DO UPDATE SET through_generation = MAX(through_generation, excluded.through_generation)`,
        )
        .run(source, executorId, generation);
      this.#db
        .query(
          "DELETE FROM executor_instance_claims WHERE source = ? AND executor_id = ? AND generation <= ?",
        )
        .run(source, executorId, generation);
    });
    transaction.immediate();
  }

  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    this.#db.close();
  }

  #assertOpen(): void {
    if (this.#closed) throw new Error("Executor claims database is closed");
  }
}

function initialize(db: Database): void {
  const version = db
    .query<{ user_version: number }, []>("PRAGMA user_version")
    .get()!.user_version;
  if (version === 0) {
    const tables = db
      .query<{ name: string }, []>(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'",
      )
      .all();
    if (tables.length)
      throw new Error("unversioned Executor claims schema is not supported");
    db.exec(`
      CREATE TABLE executor_instance_claims (
        source TEXT NOT NULL CHECK(source IN ('runner', 'managed')),
        executor_id TEXT NOT NULL,
        generation INTEGER NOT NULL CHECK(generation >= 1),
        instance_id TEXT NOT NULL,
        PRIMARY KEY(source, executor_id, generation)
      ) STRICT;
      CREATE TABLE executor_generation_revocations (
        source TEXT NOT NULL CHECK(source IN ('runner', 'managed')),
        executor_id TEXT NOT NULL,
        through_generation INTEGER NOT NULL CHECK(through_generation >= 1),
        PRIMARY KEY(source, executor_id)
      ) STRICT;
      PRAGMA user_version = ${SCHEMA_VERSION};
    `);
  } else if (version !== SCHEMA_VERSION) {
    throw new Error(`unsupported Executor claims schema version: ${version}`);
  }
  const tables = db
    .query<{ name: string }, []>(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    )
    .all()
    .map(({ name }) => name);
  if (
    tables.join("\0") !==
    "executor_generation_revocations\0executor_instance_claims"
  )
    throw new Error("Executor claims schema tables do not match");
}

function assertIdentity(value: string, name: string): void {
  if (
    !value ||
    value.length > 512 ||
    value.trim() !== value ||
    /[\u0000-\u001f\u007f]/u.test(value)
  )
    throw new TypeError(`invalid ${name}`);
}

function assertGeneration(value: number): void {
  if (!Number.isSafeInteger(value) || value < 1)
    throw new TypeError("invalid generation");
}

function preparePrivatePath(path: string): void {
  const parent = dirname(path);
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
      throw new Error(`unsafe Executor claims path component: ${current}`);
  }
  chmodSync(parent, 0o700);
  const descriptor = openSync(
    path,
    constants.O_CREAT | constants.O_RDWR | (constants.O_NOFOLLOW ?? 0),
    0o600,
  );
  try {
    if (!fstatSync(descriptor).isFile())
      throw new Error("Executor claims path is not a regular file");
    chmodSync(path, 0o600);
  } finally {
    closeSync(descriptor);
  }
}

function secureFiles(path: string): void {
  for (const file of [path, `${path}-wal`, `${path}-shm`]) {
    const stat = lstatSync(file, { throwIfNoEntry: false });
    if (!stat) continue;
    if (stat.isSymbolicLink() || !stat.isFile())
      throw new Error(`unsafe Executor claims SQLite file: ${file}`);
    chmodSync(file, 0o600);
  }
}
