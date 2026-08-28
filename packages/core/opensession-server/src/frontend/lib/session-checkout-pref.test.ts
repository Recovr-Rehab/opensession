import { beforeAll, beforeEach, describe, expect, test } from "bun:test";

const store = new Map<string, string>();
const listeners = new Map<string, Set<() => void>>();
Object.assign(globalThis, {
	localStorage: {
		getItem: (key: string) => store.get(key) ?? null,
		setItem: (key: string, value: string) => void store.set(key, value),
		removeItem: (key: string) => void store.delete(key),
	},
	window: {
		addEventListener(type: string, handler: () => void) {
			const handlers = listeners.get(type) ?? new Set();
			handlers.add(handler);
			listeners.set(type, handlers);
		},
		removeEventListener(type: string, handler: () => void) {
			listeners.get(type)?.delete(handler);
		},
		dispatchEvent(event: { type: string }) {
			for (const handler of listeners.get(event.type) ?? []) handler();
		},
	},
	Event: class {
		type: string;
		constructor(type: string) {
			this.type = type;
		}
	},
	fetch: () => Promise.reject(new Error("offline in tests")),
});

let pref: typeof import("./session-checkout-pref");

beforeAll(async () => {
	pref = await import("./session-checkout-pref");
});

beforeEach(() => store.clear());

describe("new-session checkout preference", () => {
	test("uses the repository default until the person chooses otherwise", () => {
		expect(pref.getSessionCheckoutPref()).toBe("default");
	});

	test("stores and announces an explicit worktree choice", () => {
		let changed = 0;
		const unsubscribe = pref.onSessionCheckoutPrefChanged(() => changed++);
		pref.setSessionCheckoutPref("worktree");
		unsubscribe();

		expect(pref.getSessionCheckoutPref()).toBe("worktree");
		expect(store.get("opensession-session-checkout")).toBe("worktree");
		expect(changed).toBe(1);
	});
});
