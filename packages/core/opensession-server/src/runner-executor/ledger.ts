import type {
  ExecutorOperationOutcome,
  ExecutorReceipt,
} from "@tellahq/opensession-protocol/executor";

export interface LedgerRecord {
  requestId: string;
  idempotencyKey?: string;
  receipt: ExecutorReceipt;
  outcome?: ExecutorOperationOutcome;
  error?: { code: string; message: string };
}

export interface DurableCommandLedger {
  find(
    requestId: string,
    idempotencyKey?: string,
  ): Promise<LedgerRecord | undefined>;
  put(record: LedgerRecord): Promise<void>;
  update(
    receiptId: string,
    update: Partial<Omit<LedgerRecord, "requestId" | "receipt">> & {
      receipt: ExecutorReceipt;
    },
  ): Promise<void>;
  get(receiptId: string): Promise<LedgerRecord | undefined>;
}

/** Bounded test/reference ledger. Production adapters can persist the same records. */
export class InMemoryCommandLedger implements DurableCommandLedger {
  readonly #byReceipt = new Map<string, LedgerRecord>();
  readonly #byCommand = new Map<string, string>();

  constructor(readonly capacity = 1_024) {
    if (!Number.isSafeInteger(capacity) || capacity < 1)
      throw new Error("ledger capacity must be positive");
  }

  async find(
    requestId: string,
    idempotencyKey?: string,
  ): Promise<LedgerRecord | undefined> {
    const receiptId = this.#byCommand.get(
      commandKey(requestId, idempotencyKey),
    );
    return receiptId ? this.#byReceipt.get(receiptId) : undefined;
  }

  async put(record: LedgerRecord): Promise<void> {
    const key = commandKey(record.requestId, record.idempotencyKey);
    const existing = this.#byCommand.get(key);
    if (existing && existing !== record.receipt.receiptId)
      throw new Error("command already has a different receipt");
    if (!existing && this.#byReceipt.size >= this.capacity)
      throw new LedgerFullError();
    this.#byCommand.set(key, record.receipt.receiptId);
    this.#byReceipt.set(record.receipt.receiptId, structuredClone(record));
  }

  async update(
    receiptId: string,
    update: Partial<Omit<LedgerRecord, "requestId" | "receipt">> & {
      receipt: ExecutorReceipt;
    },
  ): Promise<void> {
    const current = this.#byReceipt.get(receiptId);
    if (!current) throw new Error("receipt not found");
    this.#byReceipt.set(receiptId, structuredClone({ ...current, ...update }));
  }

  async get(receiptId: string): Promise<LedgerRecord | undefined> {
    const record = this.#byReceipt.get(receiptId);
    return record ? structuredClone(record) : undefined;
  }

  get size(): number {
    return this.#byReceipt.size;
  }
}

export class LedgerFullError extends Error {
  constructor() {
    super("command ledger is full");
    this.name = "LedgerFullError";
  }
}

function commandKey(requestId: string, idempotencyKey?: string): string {
  return idempotencyKey === undefined
    ? `request:${requestId}`
    : `mutation:${idempotencyKey}`;
}
