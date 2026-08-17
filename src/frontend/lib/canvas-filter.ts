/**
 * The Canvas tool's view filter: whose cards you are looking at, and which
 * repo's.
 *
 * It is a lens, never an edit. Card geometry lives in one shared tldraw room
 * (src/server/canvas-room.ts), so the arrangement belongs to the team: a
 * filter that deleted the cards it hides would rearrange everyone else's
 * board, and one that seeded cards for a quiet teammate would grow the shared
 * board out of one person's browsing. Matching cards therefore stay exactly
 * where they are and the rest are hidden for you alone, through tldraw's
 * per-user `getShapeVisibility`. A filter can leave gaps in the grid, and that
 * is the honest picture: those cards are still on the board, on everyone
 * else's screen.
 *
 * The words are the sidebar's (lib/sidebar-filter): "all" for every repo, and
 * "everyone" / "me" / a lowercased person key for the person. The value is
 * stored apart from it because the two answer different questions — the
 * sidebar's lens decides whose lanes you work in, this one decides who is on
 * the board — and because the board's own default is everyone.
 */
import { useEffect, useState } from "react";
import { AGENT_PERSON_KEY } from "./automation-audience";
import { canvasCardCreator } from "./canvas-card-identity";
import { personKey } from "./review-queue";
import { sessionRepo } from "./sidebar-filter";
import type { UnifiedSession } from "./types";

export interface CanvasFilter {
	/** "everyone", "me", the agent's key, or a lowercased person key. */
	person: string;
	/** A repo id, or "all". */
	repo: string;
}

export const CANVAS_FILTER_DEFAULT: CanvasFilter = {
	person: "everyone",
	repo: "all",
};
export const CANVAS_FILTER_KEY = "opensession-canvas-filter";
const CHANGE_EVENT = "opensession-canvas-filter-changed";

let current: CanvasFilter | null = null;

function readCanvasFilter(): CanvasFilter {
	try {
		const saved = JSON.parse(localStorage.getItem(CANVAS_FILTER_KEY) || "{}");
		return {
			person:
				typeof saved.person === "string" && saved.person
					? saved.person
					: CANVAS_FILTER_DEFAULT.person,
			repo:
				typeof saved.repo === "string" && saved.repo
					? saved.repo
					: CANVAS_FILTER_DEFAULT.repo,
		};
	} catch {
		return { ...CANVAS_FILTER_DEFAULT };
	}
}

export function getCanvasFilter(): CanvasFilter {
	return (current ||= readCanvasFilter());
}

export function setCanvasFilter(patch: Partial<CanvasFilter>) {
	current = { ...getCanvasFilter(), ...patch };
	// Persisting is the part that can fail (a full origin quota — see the
	// composer's outbox), and it is the part this control can do without: the
	// filter still applies, it just won't be remembered next visit.
	try {
		localStorage.setItem(CANVAS_FILTER_KEY, JSON.stringify(current));
	} catch {}
	window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function onCanvasFilterChanged(handler: () => void): () => void {
	window.addEventListener(CHANGE_EVENT, handler);
	return () => window.removeEventListener(CHANGE_EVENT, handler);
}

// Another tab's write: drop the cache so subscribers re-read from storage. The
// method is checked as well as the object because `bun test` runs every file in
// one process and os1-tui's renderer leaves behind a stub `window` carrying
// requestAnimationFrame and nothing else (same guard as lib/sidebar-filter).
if (
	typeof window !== "undefined" &&
	typeof window.addEventListener === "function"
) {
	window.addEventListener("storage", (event) => {
		if (event.key !== CANVAS_FILTER_KEY) return;
		current = null;
		window.dispatchEvent(new Event(CHANGE_EVENT));
	});
}

export function useCanvasFilter(): CanvasFilter {
	const [state, setState] = useState(getCanvasFilter);
	useEffect(() => onCanvasFilterChanged(() => setState(getCanvasFilter())), []);
	return state;
}

/** Whether anything is being narrowed: the board is otherwise whole. */
export function canvasFilterActive(filter: CanvasFilter): boolean {
	return filter.person !== "everyone" || filter.repo !== "all";
}

/**
 * Whose card this is: the person on its face, or the agent for work no person
 * started. Read through `canvasCardCreator` so the filter and the avatar the
 * card draws agree about who owns it.
 *
 * A goal wake counts as the agent's too. Nobody is behind one, but the server
 * stamps the goal's own name as the creator (`"<goal> (goal)"`,
 * src/server/goal-runner.ts), so read as a person it puts a whole goal title
 * in the menu as if it were a teammate.
 */
export function canvasCardPerson(session: UnifiedSession): string {
	if (session.goalId) return AGENT_PERSON_KEY;
	const creator = canvasCardCreator(session);
	if (creator.kind === "automation") return AGENT_PERSON_KEY;
	return creator.kind === "person" ? personKey(creator.name) : "";
}

export function canvasCardMatches(
	session: UnifiedSession,
	filter: CanvasFilter,
	currentUser: string,
): boolean {
	if (filter.repo !== "all") {
		// A repo-less session (scratch, a repo-less Ask) has no repo to match on:
		// sessionRepo's fallback would hand it the default one.
		if (session.repoLess) return false;
		if (sessionRepo(session) !== filter.repo) return false;
	}
	if (filter.person === "everyone") return true;
	const wanted = filter.person === "me" ? personKey(currentUser) : filter.person;
	// Nobody signed in: "me" has no face to match, so it narrows nothing.
	if (!wanted) return true;
	return canvasCardPerson(session) === wanted;
}

export interface CanvasFilterOptions {
	repos: string[];
	people: Array<{ key: string; label: string }>;
	/** Whether any of these sessions is an automation run (the agent's cards). */
	agent: boolean;
}

/**
 * What the two menus offer: the repos and people actually on the board, busiest
 * first. Derived from the cards rather than from the repo registry and the team
 * roster, because a menu of names with nothing behind them is a menu of dead
 * ends — and on an instance with no configured roster (GET /api/people is
 * allowed to be empty) it would be no menu at all.
 */
export function canvasFilterOptions(
	sessions: UnifiedSession[],
): CanvasFilterOptions {
	const repos = new Map<string, number>();
	const people = new Map<string, { label: string; count: number }>();
	let agent = false;
	for (const session of sessions) {
		if (!session.repoLess) {
			const repo = sessionRepo(session);
			repos.set(repo, (repos.get(repo) || 0) + 1);
		}
		// Through canvasCardPerson, so the menu can only ever offer a value that
		// matches something: an option nothing answers to is a dead end.
		const key = canvasCardPerson(session);
		if (!key) continue;
		if (key === AGENT_PERSON_KEY) {
			agent = true;
			continue;
		}
		const creator = canvasCardCreator(session);
		const label = creator.kind === "person" ? creator.name : key;
		const entry = people.get(key) || { label, count: 0 };
		entry.count++;
		people.set(key, entry);
	}
	return {
		repos: Array.from(repos.entries())
			.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
			.map(([repo]) => repo),
		people: Array.from(people.entries())
			.sort((a, b) => b[1].count - a[1].count || a[1].label.localeCompare(b[1].label))
			.map(([key, { label }]) => ({ key, label })),
		agent,
	};
}
