import {
	deliverSessionPrompt,
	type PromptDelivery,
} from "./api/sessions";
import { BASE } from "./api/request";

export type PromptOutboxState = "pending" | "sending" | "failed";

export interface PromptOutboxItem {
	/** Stable id reused for every retry and recognized by the server receipt store. */
	clientId: string;
	sessionId: string;
	content: string;
	images?: string[];
	/** Staged `{ name, path }` refs or legacy inline composer file data. */
	files?: unknown[];
	effort?: string;
	fastMode?: boolean;
	busyMode?: "queue" | "steer";
	contextSessions?: string[];
	user?: string;
	state: PromptOutboxState;
	attempts: number;
	createdAt: number;
	nextAttemptAt: number;
	error?: string;
}

export type PromptOutboxInput = Omit<
	PromptOutboxItem,
	"clientId" | "state" | "attempts" | "createdAt" | "nextAttemptAt" | "error"
>;

type StoredOutbox = { version: 1; items: PromptOutboxItem[] };
type DeliveryObserver = (item: PromptOutboxItem, result: PromptDelivery) => void;
type Listener = () => void;

export const PROMPT_OUTBOX_MAX_ITEMS = 100;
export const PROMPT_OUTBOX_RETRY_BASE_MS = 1_000;
export const PROMPT_OUTBOX_RETRY_MAX_MS = 30_000;

function serverScope(): string {
	return typeof location === "undefined" ? "server" : `${location.origin}${BASE}`;
}

function storageKey(scope: string): string {
	return `opensession-prompt-outbox:v1:${scope}`;
}

function copy(item: PromptOutboxItem): PromptOutboxItem {
	return { ...item, images: item.images?.slice(), files: item.files?.slice(), contextSessions: item.contextSessions?.slice() };
}

/**
 * A small localStorage-backed REST outbox. It is intentionally UI-agnostic: a
 * composer persists first, then subscribes to state and delivery observations.
 */
export class PromptOutbox {
	private items: PromptOutboxItem[] = [];
	private listeners = new Set<Listener>();
	private observers = new Set<DeliveryObserver>();
	private timer: number | undefined;
	private sendingSessions = new Set<string>();
	private readonly key: string;
	private readonly onStorage = (event: StorageEvent) => {
		if (event.key === this.key) {
			this.reload();
			void this.flush();
		}
	};
	private readonly onOnline = () => {
		const now = this.now();
		let changed = false;
		this.items = this.items.map((item) => {
			if (item.state !== "pending" || item.nextAttemptAt <= now) return item;
			changed = true;
			return { ...item, nextAttemptAt: now };
		});
		if (changed) this.persist();
		void this.flush();
	};

	constructor(
		private readonly opts: {
			storage?: Pick<Storage, "getItem" | "setItem">;
			scope?: string;
			now?: () => number;
			deliver?: (sessionId: string, body: Omit<PromptOutboxItem, "sessionId" | "state" | "attempts" | "createdAt" | "nextAttemptAt" | "error">) => Promise<PromptDelivery>;
		} = {},
	) {
		this.key = storageKey(opts.scope ?? serverScope());
		this.reload(false);
		if (typeof window !== "undefined") {
			window.addEventListener("storage", this.onStorage);
			window.addEventListener("online", this.onOnline);
			queueMicrotask(() => void this.flush());
		}
	}

	dispose(): void {
		if (this.timer !== undefined) clearTimeout(this.timer);
		if (typeof window !== "undefined") {
			window.removeEventListener("storage", this.onStorage);
			window.removeEventListener("online", this.onOnline);
		}
	}

	list(sessionId?: string): PromptOutboxItem[] {
		return this.items.filter((item) => !sessionId || item.sessionId === sessionId).map(copy);
	}

	subscribe(listener: Listener): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	observeDelivery(observer: DeliveryObserver): () => void {
		this.observers.add(observer);
		return () => this.observers.delete(observer);
	}

	/** Persists synchronously before returning. Throws rather than evicting data. */
	enqueue(input: PromptOutboxInput): PromptOutboxItem {
		this.reload(false);
		if (this.items.length >= PROMPT_OUTBOX_MAX_ITEMS)
			throw new Error("Prompt outbox is full. Retry or discard a failed prompt before sending another.");
		const now = this.now();
		const item: PromptOutboxItem = {
			...input,
			clientId: crypto.randomUUID(),
			state: "pending",
			attempts: 0,
			createdAt: now,
			nextAttemptAt: now,
		};
		this.items.push(item);
		try {
			this.persist();
		} catch (error) {
			this.items.pop();
			throw error;
		}
		this.emit();
		void this.flush();
		return copy(item);
	}

	retry(clientId: string): void {
		this.mutate(clientId, (item) => ({ ...item, state: "pending", attempts: 0, error: undefined, nextAttemptAt: this.now() }));
		void this.flush();
	}

	discard(clientId: string): void {
		this.reload(false);
		const next = this.items.filter((item) => item.clientId !== clientId);
		if (next.length === this.items.length) return;
		this.items = next;
		this.persist();
		this.emit();
	}

	/** Replaces editable payload fields while preserving the idempotency key. */
	edit(clientId: string, patch: Partial<PromptOutboxInput>): void {
		this.mutate(clientId, (item) => ({ ...item, ...patch, state: "pending", attempts: 0, error: undefined, nextAttemptAt: this.now() }));
		void this.flush();
	}

	async flush(): Promise<void> {
		this.reload(false);
		const now = this.now();
		const sessions = [...new Set(this.items.filter((item) => item.state === "pending" && item.nextAttemptAt <= now).map((item) => item.sessionId))];
		await Promise.all(sessions.map((sessionId) => this.flushSession(sessionId)));
		this.schedule();
	}

	private async flushSession(sessionId: string): Promise<void> {
		if (this.sendingSessions.has(sessionId)) return;
		this.sendingSessions.add(sessionId);
		try {
			while (true) {
				const item = this.items.find((candidate) => candidate.sessionId === sessionId && candidate.state === "pending" && candidate.nextAttemptAt <= this.now());
				if (!item) return;
				this.replace(item.clientId, { ...item, state: "sending" });
				try {
					const result = await (this.opts.deliver ?? ((id, body) => deliverSessionPrompt(id, body)))(sessionId, this.body(item));
					this.items = this.items.filter((candidate) => candidate.clientId !== item.clientId);
					this.persist();
					this.emit();
					for (const observer of this.observers) observer(copy(item), result);
				} catch (error) {
					const attempts = item.attempts + 1;
					const message = error instanceof Error ? error.message : "Prompt delivery failed";
					const failed = !isRetryable(error);
					this.replace(item.clientId, {
						...item,
						attempts,
						state: failed ? "failed" : "pending",
						error: message,
						nextAttemptAt: failed ? Number.POSITIVE_INFINITY : this.now() + retryDelay(attempts),
					});
					return; // Preserve ordering within this session after a failed head item.
				}
			}
		} finally {
			this.sendingSessions.delete(sessionId);
		}
	}

	private body(item: PromptOutboxItem) {
		const { sessionId: _sessionId, state: _state, attempts: _attempts, createdAt: _createdAt, nextAttemptAt: _nextAttemptAt, error: _error, ...body } = item;
		return body;
	}

	private mutate(clientId: string, change: (item: PromptOutboxItem) => PromptOutboxItem): void {
		this.reload(false);
		const item = this.items.find((candidate) => candidate.clientId === clientId);
		if (!item) throw new Error("Prompt no longer exists in the outbox.");
		this.replace(clientId, change(item));
	}

	private replace(clientId: string, next: PromptOutboxItem): void {
		this.items = this.items.map((item) => item.clientId === clientId ? next : item);
		this.persist();
		this.emit();
	}

	private reload(notify = true): void {
		const raw = this.opts.storage?.getItem(this.key) ?? (typeof localStorage === "undefined" ? null : localStorage.getItem(this.key));
		if (!raw) return;
		try {
			const parsed = JSON.parse(raw) as StoredOutbox;
			if (parsed.version !== 1 || !Array.isArray(parsed.items)) return;
			let resumed = false;
			const now = this.now();
			this.items = parsed.items
				.filter(isItem)
				.map((item) => {
					// A tab can close after recording `sending` but before receiving the
					// response. Treat that process-local state as pending on every load;
					// the stable client id makes a concurrent/replayed request safe.
					if (item.state !== "sending") return item;
					resumed = true;
					return { ...item, state: "pending" as const, nextAttemptAt: now };
				})
				.sort((a, b) => a.createdAt - b.createdAt);
			if (resumed) this.persist();
			if (notify) this.emit();
		} catch {
			// Keep the malformed value untouched; a later write must never silently
			// erase recoverable durable prompts.
		}
	}

	private persist(): void {
		const storage = this.opts.storage ?? (typeof localStorage === "undefined" ? undefined : localStorage);
		if (!storage) throw new Error("Prompt outbox storage is unavailable.");
		storage.setItem(this.key, JSON.stringify({ version: 1, items: this.items } satisfies StoredOutbox));
	}

	private emit(): void {
		for (const listener of this.listeners) listener();
	}

	private schedule(): void {
		if (this.timer !== undefined) clearTimeout(this.timer);
		const next = this.items.filter((item) => item.state === "pending").reduce((earliest, item) => Math.min(earliest, item.nextAttemptAt), Number.POSITIVE_INFINITY);
		if (!Number.isFinite(next)) return;
		this.timer = setTimeout(() => void this.flush(), Math.max(0, next - this.now())) as unknown as number;
	}

	private now(): number {
		return this.opts.now?.() ?? Date.now();
	}
}

/** One process-wide queue. Multiple mounted session panes subscribe to their
 * own slice, while a single sender preserves ordering and avoids redundant
 * retries inside one tab. Stable client ids still make cross-tab races safe. */
export const promptOutbox = new PromptOutbox();

function retryDelay(attempt: number): number {
	return Math.min(PROMPT_OUTBOX_RETRY_MAX_MS, PROMPT_OUTBOX_RETRY_BASE_MS * 2 ** (attempt - 1));
}

function isRetryable(error: unknown): boolean {
	const status = typeof error === "object" && error && "status" in error ? Number((error as { status?: unknown }).status) : NaN;
	return !Number.isFinite(status) || status === 408 || status === 429 || status >= 500;
}

function isItem(value: unknown): value is PromptOutboxItem {
	return !!value && typeof value === "object" && typeof (value as PromptOutboxItem).clientId === "string" && typeof (value as PromptOutboxItem).sessionId === "string" && typeof (value as PromptOutboxItem).content === "string" && ["pending", "sending", "failed"].includes((value as PromptOutboxItem).state);
}
