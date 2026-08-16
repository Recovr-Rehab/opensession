/**
 * Where the user is: tabs, panes, mode.
 *
 * This is a ref-backed store rather than a pile of `useState`, for one concrete
 * reason: a terminal delivers keystrokes faster than React re-renders. `^b w`
 * arrives as two keypresses in the same tick, and with plain state the second
 * one reads a `prefixArmed` that hasn't updated yet — the prefix silently eats
 * the key. Reads during key handling go to the ref (always current); renders go
 * to the mirrored snapshot.
 *
 * Same shape as the client-layer stores, so the component subscribes to it the
 * same way.
 */

import type { Pane } from "./keymap";

/**
 * Where keys go, and what is on screen — one field, deliberately.
 *
 * Mode and "is an overlay open" used to be two fields, and every action that
 * opened a prompt had to set both and keep them agreeing. Anything that touched
 * only the mode (focus-pane, next-tab, zoom) left a picker rendered with nav
 * keys live behind it, so `q` quit the app instead of typing into the filter.
 * With one field an action replaces the whole state, and the two can't disagree.
 * The picker's cursor lives in the variant that owns it.
 */
export type Mode =
	| { kind: "nav" }
	| { kind: "composer" }
	| { kind: "ask" }
	| { kind: "scroll" }
	| { kind: "help" }
	| { kind: "picker"; selected: number }
	| { kind: "command" }
	| { kind: "rename" }
	| { kind: "new" };

/**
 * The modes that carry no state of their own, as shared constants: patching in
 * a fresh object would make `UiStore.set` see a change and re-render for a mode
 * that didn't move.
 */
export const MODE = {
	nav: { kind: "nav" },
	composer: { kind: "composer" },
	ask: { kind: "ask" },
	scroll: { kind: "scroll" },
	help: { kind: "help" },
	command: { kind: "command" },
	rename: { kind: "rename" },
	new: { kind: "new" },
} satisfies Record<string, Mode>;

/** Modes that put a prompt overlay on screen, with a textarea holding focus. */
export function isPromptMode(mode: Mode): boolean {
	switch (mode.kind) {
		case "picker":
		case "command":
		case "rename":
		case "new":
			return true;
		default:
			return false;
	}
}

export type UiState = {
	/** Session ids with an open tab, in tab order. */
	tabs: string[];
	activeTab: number;
	/** Cursor into the flattened sidebar list. */
	cursor: number;
	mode: Mode;
	pane: Pane;
	prefixArmed: boolean;
	zoom: boolean;
	message?: { text: string; kind: "info" | "error" };
};

export function initialUiState(initialSessionId?: string): UiState {
	return {
		tabs: initialSessionId ? [initialSessionId] : [],
		activeTab: 0,
		cursor: 0,
		mode: MODE.nav,
		pane: initialSessionId ? "transcript" : "sidebar",
		prefixArmed: false,
		zoom: false,
	};
}

export class UiStore {
	private state: UiState;
	private listeners = new Set<() => void>();

	constructor(initialSessionId?: string) {
		this.state = initialUiState(initialSessionId);
	}

	getState = (): UiState => this.state;

	subscribe = (listener: () => void): (() => void) => {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	};

	/** Patch — or, with a function, derive from the current (never stale) state. */
	set(patch: Partial<UiState> | ((current: UiState) => Partial<UiState>)): void {
		const resolved = typeof patch === "function" ? patch(this.state) : patch;
		let changed = false;
		for (const key of Object.keys(resolved) as (keyof UiState)[]) {
			if (this.state[key] !== resolved[key]) {
				changed = true;
				break;
			}
		}
		if (!changed) return;
		this.state = { ...this.state, ...resolved };
		for (const listener of this.listeners) listener();
	}

	get activeSessionId(): string | undefined {
		return this.state.tabs[this.state.activeTab];
	}

	/** Open a session in a tab, or focus its tab if it already has one. */
	openTab(sessionId: string): void {
		this.set((current) => {
			const at = current.tabs.indexOf(sessionId);
			if (at >= 0) {
				return { activeTab: at, pane: "transcript", mode: MODE.nav };
			}
			return {
				tabs: [...current.tabs, sessionId],
				activeTab: current.tabs.length,
				pane: "transcript",
				mode: MODE.nav,
			};
		});
	}

	closeTab(sessionId: string): void {
		this.set((current) => {
			const tabs = current.tabs.filter((id) => id !== sessionId);
			return {
				tabs,
				activeTab: Math.max(0, Math.min(current.activeTab, tabs.length - 1)),
			};
		});
	}
}
