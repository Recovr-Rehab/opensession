/**
 * Client-side shapes for `GET /api/desk/state` — the Desk's live state
 * (src/server/desk-state.ts). A tolerant subset, like every other client model
 * here: optionals everywhere so a server addition never breaks the UI.
 */

export interface DeskPr {
	number: number;
	url?: string;
	state?: string;
	checks?: { passed: number; failed: number; pending: number };
}

export interface DeskWorkItem {
	sessionId: string;
	title: string;
	repo?: string;
	lastActivity: string;
	question?: {
		kind: "session" | "human";
		questionId: string;
		text: string;
		options: string[];
	};
	pr?: DeskPr;
}

export interface DeskTodo {
	id: string;
	text: string;
	due?: string;
}

export interface DeskState {
	waiting: DeskWorkItem[];
	running: DeskWorkItem[];
	review: DeskWorkItem[];
	todos: DeskTodo[];
	more: { waiting: number; running: number; review: number; todos: number };
	generatedAt: string;
}
