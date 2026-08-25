import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { EXECUTOR_PROVIDER_IDS, type ExecutorProviderId } from "./provider";
import {
  ExecutorStateConflictError,
  type ExecutorAuditEntry,
  type ExecutorLifecycle,
  type ExecutorRecord,
  type ExecutorStateStore,
} from "./state";

const LIFECYCLES = [
  "preparing",
  "awake",
  "sleeping",
  "waking",
  "needs_attention",
] as const satisfies readonly ExecutorLifecycle[];

interface ExecutorRow {
  executor_id: unknown;
  session_id: unknown;
  provider: unknown;
  resource_id: unknown;
  workspace_id: unknown;
  resource_generation: unknown;
  instance_generation: unknown;
  lifecycle: unknown;
  project_revision: unknown;
  project_base_commit: unknown;
  project_durable_delta: unknown;
  created_at_ms: unknown;
  updated_at_ms: unknown;
  error: unknown;
}

interface AuditRow {
  executor_id: unknown;
  generation: unknown;
  action: unknown;
  operator_id: unknown;
  reason: unknown;
  at_ms: unknown;
}

const RECORD_COLUMNS = `
  executor_id, session_id, provider, resource_id, workspace_id,
  resource_generation, instance_generation, lifecycle,
  project_revision, project_base_commit, project_durable_delta,
  created_at_ms, updated_at_ms, error
`;

/**
 * Durable managed Executor state. Construction is the explicit open boundary;
 * merely importing this module performs no filesystem or database work.
 */
export class SqliteExecutorStateStore implements ExecutorStateStore {
  readonly #db: Database;

  constructor(readonly dbPath: string) {
    if (typeof dbPath !== "string" || dbPath.length === 0) {
      throw new TypeError("Executor state database path must be explicit");
    }
    if (dbPath !== ":memory:") {
      mkdirSync(dirname(dbPath), { recursive: true, mode: 0o700 });
    }

    this.#db = new Database(dbPath);
    this.#db.exec("PRAGMA busy_timeout = 5000;");
    this.#db.exec("PRAGMA foreign_keys = ON;");
    this.#db.exec("PRAGMA journal_mode = WAL;");
    // Executor intent and audit records fence external provider side effects.
    this.#db.exec("PRAGMA synchronous = FULL;");
    this.#db.exec(`
      CREATE TABLE IF NOT EXISTS managed_executors (
        executor_id TEXT PRIMARY KEY NOT NULL,
        session_id TEXT NOT NULL UNIQUE,
        provider TEXT NOT NULL CHECK(provider IN ('box', 'daytona', 'modal')),
        resource_id TEXT,
        workspace_id TEXT,
        resource_generation INTEGER,
        instance_generation INTEGER NOT NULL CHECK(instance_generation >= 1),
        lifecycle TEXT NOT NULL CHECK(lifecycle IN ('preparing', 'awake', 'sleeping', 'waking', 'needs_attention')),
        project_revision TEXT NOT NULL,
        project_base_commit TEXT NOT NULL,
        project_durable_delta TEXT NOT NULL,
        created_at_ms INTEGER NOT NULL,
        updated_at_ms INTEGER NOT NULL,
        error TEXT
      );
      CREATE TABLE IF NOT EXISTS managed_executor_force_destroy_audit (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        executor_id TEXT NOT NULL,
        generation INTEGER NOT NULL CHECK(generation >= 1),
        action TEXT NOT NULL CHECK(action = 'force_destroy'),
        operator_id TEXT NOT NULL,
        reason TEXT NOT NULL,
        at_ms INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS managed_executor_audit_executor_idx
        ON managed_executor_force_destroy_audit(executor_id, id);
    `);
  }

  close(): void {
    this.#db.close();
  }

  async getByExecutorId(executorId: string): Promise<ExecutorRecord | undefined> {
    assertIdentity(executorId, "executorId");
    const row = this.#db
      .query<ExecutorRow, [string]>(
        `SELECT ${RECORD_COLUMNS} FROM managed_executors WHERE executor_id = ?`,
      )
      .get(executorId);
    return row ? decodeRecord(row) : undefined;
  }

  async getBySessionId(sessionId: string): Promise<ExecutorRecord | undefined> {
    assertIdentity(sessionId, "sessionId");
    const row = this.#db
      .query<ExecutorRow, [string]>(
        `SELECT ${RECORD_COLUMNS} FROM managed_executors WHERE session_id = ?`,
      )
      .get(sessionId);
    return row ? decodeRecord(row) : undefined;
  }

  async insertIntent(record: ExecutorRecord): Promise<void> {
    assertRecord(record);
    const insert = this.#db.transaction(() => {
      if (this.#hasExecutor(record.executorId)) {
        throw new ExecutorStateConflictError(
          `Executor ${record.executorId} already exists`,
        );
      }
      if (this.#hasSession(record.sessionId)) {
        throw new ExecutorStateConflictError(
          `session ${record.sessionId} already has a managed Executor`,
        );
      }
      this.#insertRecord(record);
    });
    insert.immediate();
  }

  async compareAndSwap(
    executorId: string,
    expectedGeneration: number,
    next: ExecutorRecord,
  ): Promise<void> {
    assertIdentity(executorId, "executorId");
    assertGeneration(expectedGeneration, "expectedGeneration");
    assertRecord(next);
    if (next.executorId !== executorId) {
      throw new ExecutorStateConflictError("Executor identity is immutable");
    }
    if (next.instanceGeneration < expectedGeneration) {
      throw new ExecutorStateConflictError("Executor generation cannot decrease");
    }

    const swap = this.#db.transaction(() => {
      const current = this.#getRawByExecutor(executorId);
      if (!current) {
        throw new ExecutorStateConflictError(
          `Executor ${executorId} does not exist`,
        );
      }
      const decoded = decodeRecord(current);
      if (decoded.instanceGeneration !== expectedGeneration) {
        throw staleConflict(executorId, expectedGeneration);
      }
      if (next.sessionId !== decoded.sessionId) {
        throw new ExecutorStateConflictError(
          "Executor and session identity are immutable",
        );
      }
      this.#db
        .query(
          `UPDATE managed_executors SET
            provider = ?, resource_id = ?, workspace_id = ?,
            resource_generation = ?, instance_generation = ?, lifecycle = ?,
            project_revision = ?, project_base_commit = ?, project_durable_delta = ?,
            created_at_ms = ?, updated_at_ms = ?, error = ?
           WHERE executor_id = ? AND instance_generation = ?`,
        )
        .run(...recordValuesForUpdate(next), executorId, expectedGeneration);
    });
    swap.immediate();
  }

  async delete(executorId: string, expectedGeneration: number): Promise<void> {
    assertIdentity(executorId, "executorId");
    assertGeneration(expectedGeneration, "expectedGeneration");
    const remove = this.#db.transaction(() => {
      const current = this.#getRawByExecutor(executorId);
      if (!current) {
        throw new ExecutorStateConflictError(
          `Executor ${executorId} does not exist`,
        );
      }
      const decoded = decodeRecord(current);
      if (decoded.instanceGeneration !== expectedGeneration) {
        throw staleConflict(executorId, expectedGeneration);
      }
      this.#db
        .query(
          "DELETE FROM managed_executors WHERE executor_id = ? AND instance_generation = ?",
        )
        .run(executorId, expectedGeneration);
    });
    remove.immediate();
  }

  async appendAudit(entry: ExecutorAuditEntry): Promise<void> {
    assertAuditEntry(entry);
    const append = this.#db.transaction(() => {
      this.#db
        .query(
          `INSERT INTO managed_executor_force_destroy_audit
            (executor_id, generation, action, operator_id, reason, at_ms)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(
          entry.executorId,
          entry.generation,
          entry.action,
          entry.operatorId,
          entry.reason,
          entry.atMs,
        );
    });
    append.immediate();
  }

  /** Reads force-destroy audit entries in durable append order. */
  async auditEntries(executorId?: string): Promise<readonly ExecutorAuditEntry[]> {
    if (executorId !== undefined) assertIdentity(executorId, "executorId");
    const rows = executorId === undefined
      ? this.#db
          .query<AuditRow, []>(
            `SELECT executor_id, generation, action, operator_id, reason, at_ms
             FROM managed_executor_force_destroy_audit ORDER BY id`,
          )
          .all()
      : this.#db
          .query<AuditRow, [string]>(
            `SELECT executor_id, generation, action, operator_id, reason, at_ms
             FROM managed_executor_force_destroy_audit
             WHERE executor_id = ? ORDER BY id`,
          )
          .all(executorId);
    return rows.map(decodeAuditEntry);
  }

  #getRawByExecutor(executorId: string): ExecutorRow | null {
    return this.#db
      .query<ExecutorRow, [string]>(
        `SELECT ${RECORD_COLUMNS} FROM managed_executors WHERE executor_id = ?`,
      )
      .get(executorId);
  }

  #hasExecutor(executorId: string): boolean {
    return this.#db
      .query<{ present: number }, [string]>(
        "SELECT 1 AS present FROM managed_executors WHERE executor_id = ?",
      )
      .get(executorId) !== null;
  }

  #hasSession(sessionId: string): boolean {
    return this.#db
      .query<{ present: number }, [string]>(
        "SELECT 1 AS present FROM managed_executors WHERE session_id = ?",
      )
      .get(sessionId) !== null;
  }

  #insertRecord(record: ExecutorRecord): void {
    this.#db
      .query(
        `INSERT INTO managed_executors (${RECORD_COLUMNS})
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(...recordValues(record));
  }
}

function recordValues(record: ExecutorRecord): (string | number | null)[] {
  return [
    record.executorId,
    record.sessionId,
    record.provider,
    record.resourceId ?? null,
    record.workspaceId ?? null,
    record.resourceGeneration ?? null,
    record.instanceGeneration,
    record.lifecycle,
    record.project.revision,
    record.project.baseCommit,
    record.project.durableDelta,
    record.createdAtMs,
    record.updatedAtMs,
    record.error ?? null,
  ];
}

function recordValuesForUpdate(record: ExecutorRecord): (string | number | null)[] {
  const values = recordValues(record);
  return values.slice(2);
}

function decodeRecord(row: ExecutorRow): ExecutorRecord {
  const executorId = decodeIdentity(row.executor_id, "executor_id");
  const sessionId = decodeIdentity(row.session_id, "session_id");
  const provider = decodeEnum(
    row.provider,
    EXECUTOR_PROVIDER_IDS,
    "provider",
  ) as ExecutorProviderId;
  const lifecycle = decodeEnum(row.lifecycle, LIFECYCLES, "lifecycle");
  const resourceId = decodeOptionalIdentity(row.resource_id, "resource_id");
  const workspaceId = decodeOptionalIdentity(row.workspace_id, "workspace_id");
  const resourceGeneration = decodeOptionalGeneration(
    row.resource_generation,
    "resource_generation",
  );
  const instanceGeneration = decodeGeneration(
    row.instance_generation,
    "instance_generation",
  );
  const revision = decodeString(row.project_revision, "project_revision");
  const baseCommit = decodeString(row.project_base_commit, "project_base_commit");
  const durableDelta = decodeString(
    row.project_durable_delta,
    "project_durable_delta",
  );
  const createdAtMs = decodeTimestamp(row.created_at_ms, "created_at_ms");
  const updatedAtMs = decodeTimestamp(row.updated_at_ms, "updated_at_ms");
  const error = decodeOptionalString(row.error, "error");

  return {
    executorId,
    sessionId,
    provider,
    ...(resourceId === undefined ? {} : { resourceId }),
    ...(workspaceId === undefined ? {} : { workspaceId }),
    ...(resourceGeneration === undefined ? {} : { resourceGeneration }),
    instanceGeneration,
    lifecycle,
    project: { revision, baseCommit, durableDelta },
    createdAtMs,
    updatedAtMs,
    ...(error === undefined ? {} : { error }),
  };
}

function decodeAuditEntry(row: AuditRow): ExecutorAuditEntry {
  const action = decodeEnum(row.action, ["force_destroy"] as const, "action");
  return {
    executorId: decodeIdentity(row.executor_id, "executor_id"),
    generation: decodeGeneration(row.generation, "generation"),
    action,
    operatorId: decodeIdentity(row.operator_id, "operator_id"),
    reason: decodeString(row.reason, "reason"),
    atMs: decodeTimestamp(row.at_ms, "at_ms"),
  };
}

function assertRecord(record: ExecutorRecord): void {
  if (!record || typeof record !== "object") throw corrupt("record");
  assertIdentity(record.executorId, "executorId");
  assertIdentity(record.sessionId, "sessionId");
  decodeEnum(record.provider, EXECUTOR_PROVIDER_IDS, "provider");
  decodeEnum(record.lifecycle, LIFECYCLES, "lifecycle");
  decodeOptionalIdentity(record.resourceId ?? null, "resourceId");
  decodeOptionalIdentity(record.workspaceId ?? null, "workspaceId");
  decodeOptionalGeneration(record.resourceGeneration ?? null, "resourceGeneration");
  assertGeneration(record.instanceGeneration, "instanceGeneration");
  if (!record.project || typeof record.project !== "object") throw corrupt("project");
  decodeString(record.project.revision, "project.revision");
  decodeString(record.project.baseCommit, "project.baseCommit");
  decodeString(record.project.durableDelta, "project.durableDelta");
  decodeTimestamp(record.createdAtMs, "createdAtMs");
  decodeTimestamp(record.updatedAtMs, "updatedAtMs");
  decodeOptionalString(record.error ?? null, "error");
}

function assertAuditEntry(entry: ExecutorAuditEntry): void {
  if (!entry || typeof entry !== "object") throw corrupt("audit entry");
  assertIdentity(entry.executorId, "executorId");
  assertGeneration(entry.generation, "generation");
  decodeEnum(entry.action, ["force_destroy"] as const, "action");
  assertIdentity(entry.operatorId, "operatorId");
  decodeString(entry.reason, "reason");
  decodeTimestamp(entry.atMs, "atMs");
}

function assertIdentity(value: unknown, field: string): asserts value is string {
  decodeIdentity(value, field);
}

function decodeIdentity(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0 || value.trim() !== value) {
    throw corrupt(field);
  }
  return value;
}

function decodeOptionalIdentity(value: unknown, field: string): string | undefined {
  return value === null || value === undefined
    ? undefined
    : decodeIdentity(value, field);
}

function assertGeneration(value: unknown, field: string): asserts value is number {
  decodeGeneration(value, field);
}

function decodeGeneration(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) throw corrupt(field);
  return value as number;
}

function decodeOptionalGeneration(value: unknown, field: string): number | undefined {
  return value === null || value === undefined
    ? undefined
    : decodeGeneration(value, field);
}

function decodeTimestamp(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) throw corrupt(field);
  return value as number;
}

function decodeString(value: unknown, field: string): string {
  if (typeof value !== "string") throw corrupt(field);
  return value;
}

function decodeOptionalString(value: unknown, field: string): string | undefined {
  if (value === null || value === undefined) return undefined;
  return decodeString(value, field);
}

function decodeEnum<const T extends readonly string[]>(
  value: unknown,
  allowed: T,
  field: string,
): T[number] {
  if (typeof value !== "string" || !allowed.includes(value)) throw corrupt(field);
  return value as T[number];
}

function corrupt(field: string): TypeError {
  return new TypeError(`Malformed managed Executor state: ${field}`);
}

function staleConflict(
  executorId: string,
  expectedGeneration: number,
): ExecutorStateConflictError {
  return new ExecutorStateConflictError(
    `Executor ${executorId} generation is stale (expected ${expectedGeneration})`,
  );
}
