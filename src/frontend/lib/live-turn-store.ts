import { LiveTextBuffer } from "@tellahq/opensession-protocol/live-text";
import {
	countSessionPerf,
	recordSessionPerf,
	startSessionPerfObservers,
} from "./session-performance";

export interface LiveTurnSnapshot {
	text: string;
	live: boolean;
	by: string | null;
	runId: string | null;
	revision: number;
}

const EMPTY: LiveTurnSnapshot = {
	text: "",
	live: false,
	by: null,
	runId: null,
	revision: 0,
};

const scheduleFrame = (callback: FrameRequestCallback): number =>
	typeof requestAnimationFrame === "function"
		? requestAnimationFrame(callback)
		: (setTimeout(() => callback(performance.now()), 16) as unknown as number);
const cancelFrame = (id: number) => {
	if (typeof cancelAnimationFrame === "function") cancelAnimationFrame(id);
	else clearTimeout(id);
};

// Placeholder frame id held while scheduleFrame is being called: if the
// callback fires synchronously (a test-installed requestAnimationFrame may),
// flush() nulls `frame` before scheduleFrame returns — and storing the
// returned id over that null would leave a stale id blocking every future
// schedule, silencing the store for good.
const SCHEDULING = -1;

/**
 * The bubble a running turn writes into.
 *
 * What to show is `LiveTextBuffer`'s job (it owns cancelling a block once the
 * durable entry lands, and it is the same class the server's feed and the
 * native app use). What this adds is when to paint: frames are coalesced to
 * one repaint per animation frame, and the buffer keeps growing between them.
 */
export class LiveTurnStore {
	private snapshot: LiveTurnSnapshot = EMPTY;
	private listeners = new Set<() => void>();
	private buffer = new LiveTextBuffer();
	private dirty = false;
	private frame: number | null = null;
	private clearTimer: ReturnType<typeof setTimeout> | null = null;
	private firstDeltaAt: number | null = null;

	constructor() {
		startSessionPerfObservers();
	}

	subscribe = (listener: () => void) => {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	};

	getSnapshot = () => this.snapshot;
	getServerSnapshot = () => EMPTY;
	hasText = () => Boolean(this.buffer.text);
	textLength = () => this.buffer.text.length;

	start(by?: string | null, runId?: string) {
		this.cancelTimers();
		this.buffer.reset();
		this.dirty = false;
		this.firstDeltaAt = null;
		this.snapshot = {
			text: "",
			live: true,
			by: by ?? null,
			runId: runId ?? crypto.randomUUID(),
			revision: this.snapshot.revision + 1,
		};
		this.emit();
	}

	append(text: string, blockId?: string) {
		if (!this.buffer.append(text, blockId)) return;
		countSessionPerf("stream_frames_received");
		if (this.firstDeltaAt === null) this.firstDeltaAt = performance.now();
		this.dirty = true;
		if (this.frame === null) {
			this.frame = SCHEDULING;
			const id = scheduleFrame(() => this.flush());
			// A synchronous callback already flushed and cleared the slot.
			if (this.frame === SCHEDULING) this.frame = id;
		}
	}

	/** Blocks that just landed as durable transcript entries. */
	land(entries: Array<{ id?: string; content: string }>) {
		for (const entry of entries) this.buffer.land(entry.content, entry.id);
		this.dirty = false;
		this.snapshot = {
			...this.snapshot,
			text: this.buffer.text,
			revision: this.snapshot.revision + 1,
		};
		this.emit();
	}

	finish() {
		this.flush();
		this.snapshot = {
			...this.snapshot,
			live: false,
			by: null,
			revision: this.snapshot.revision + 1,
		};
		this.emit();
		if (this.clearTimer !== null) clearTimeout(this.clearTimer);
		const runId = this.snapshot.runId;
		this.clearTimer = setTimeout(() => {
			if (this.snapshot.runId === runId && !this.snapshot.live) this.clear();
		}, 5_000);
	}

	clear() {
		this.cancelTimers();
		this.buffer.reset();
		this.dirty = false;
		this.snapshot = {
			...EMPTY,
			revision: this.snapshot.revision + 1,
		};
		this.emit();
	}

	private flush() {
		if (this.frame !== null && this.frame !== SCHEDULING) {
			cancelFrame(this.frame);
		}
		this.frame = null;
		if (!this.dirty) return;
		this.dirty = false;
		const receivedAt = this.firstDeltaAt;
		this.firstDeltaAt = null;
		this.snapshot = {
			...this.snapshot,
			text: this.buffer.text,
			revision: this.snapshot.revision + 1,
		};
		countSessionPerf("stream_paints");
		if (receivedAt !== null) {
			recordSessionPerf("first_delta_to_paint_ms", performance.now() - receivedAt);
		}
		this.emit();
	}

	private emit() {
		for (const listener of this.listeners) listener();
	}

	private cancelTimers() {
		if (this.frame !== null && this.frame !== SCHEDULING) {
			cancelFrame(this.frame);
		}
		if (this.clearTimer !== null) clearTimeout(this.clearTimer);
		this.frame = null;
		this.clearTimer = null;
	}
}
