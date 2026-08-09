/**
 * Desk live state — what the user's world looks like right now, for both the
 * Desk's own eyes (a compact briefing injected into every Desk turn) and the
 * Desk UI's default screen ("fire and collect").
 *
 * The Desk is an orchestrator, and an orchestrator that doesn't know what's
 * already running spawns duplicates — so every Desk turn carries this, and it
 * is rebuilt PER TURN (buildSessionNote runs per prompt), never cached onto
 * the session.
 *
 * Three buckets, and they only ever contain the user's OWN sessions:
 *   waiting — blocked on an AskUserQuestion; the user is the only unblocker.
 *   running — in flight right now.
 *   review  — finished recently and not yet read: the result of work they
 *             handed off. This is the Desk's pull, and it drains by itself as
 *             sessions are read, which is the thing a todo list can't do.
 *
 * Deliberately NOT a feed (see desk.ts's module doc and the deleted HQ
 * feature): everything here is work the user themselves started, surfaced only
 * when they summon the Desk.
 */
import { pendingAsks } from "./asks";
import { getCachedSessions } from "./session-cache";
import { getReads, isUnread } from "./reads";
import { listTodos } from "./todos";
import { gitIdentityFor } from "./shared/user-mappings";
import type { UnifiedSession } from "./types";

/** How far back a finished session still counts as "needs your eyes". Past
 *  this it's history — the sessions list's job, not the Desk's. */
const REVIEW_WINDOW_MS = 36 * 60 * 60 * 1000;
/** Per-bucket cap: the Desk is a glance, not an inventory. */
const MAX_PER_BUCKET = 6;

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
	/** Only on `waiting` items — what it's asking, and the offered options.
	 *  `questionId` + the verbatim `text` are what an inline answer needs:
	 *  the answer map is keyed by question text (see AskCard). */
	question?: { questionId: string; text: string; options: string[] };
	/** Only when the session's branch has a PR. */
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
	/** Set when a bucket was capped, so the UI can say "+3 more". */
	more: { waiting: number; running: number; review: number; todos: number };
	generatedAt: string;
}

/** Same-person test across the identity table (createdBy is a display name,
 *  the run user may be an alias/login/email). Falls back to a plain
 *  case-insensitive compare when neither side resolves. */
function samePerson(a: string | null | undefined, b: string | undefined): boolean {
	if (!a || !b) return false;
	if (a.trim().toLowerCase() === b.trim().toLowerCase()) return true;
	const ia = gitIdentityFor(a);
	const ib = gitIdentityFor(b);
	return !!(ia && ib && ia.email === ib.email);
}

const RUNNING_STATES = new Set([
	"preparing",
	"starting",
	"running",
	"reattaching",
]);

function isRunningSession(s: UnifiedSession): boolean {
	if (s.runState && RUNNING_STATES.has(s.runState)) return true;
	return !!s.isRunning && s.runState !== "ask_blocked";
}

/** Flatten a pending AskUserQuestion payload into one line + its options. */
function askSummary(sessionId: string): DeskWorkItem["question"] | undefined {
	const pending = pendingAsks.get(sessionId);
	if (!pending) return undefined;
	const questions = (pending.questions || []) as Array<{
		question?: unknown;
		header?: unknown;
		options?: Array<{ label?: unknown }>;
	}>;
	if (!questions.length) return undefined;
	const first = questions[0];
	const text = typeof first?.question === "string" ? first.question : "";
	if (!text) return undefined;
	// Options are only actionable when there's a single question — a
	// multi-question ask needs the real card, so send them to the session.
	const options =
		questions.length === 1 && Array.isArray(first.options)
			? first.options
					.map((o) => (typeof o?.label === "string" ? o.label : ""))
					.filter(Boolean)
					.slice(0, 4)
			: [];
	return { questionId: pending.questionId, text, options };
}

function prFor(s: UnifiedSession): DeskPr | undefined {
	if (!s.prNumber) return undefined;
	return {
		number: s.prNumber,
		url: s.prUrl,
		state: s.prState,
		checks: s.prChecks
			? {
					passed: s.prChecks.passed,
					failed: s.prChecks.failed,
					pending: s.prChecks.pending,
				}
			: undefined,
	};
}

function toItem(s: UnifiedSession, question?: DeskWorkItem["question"]): DeskWorkItem {
	return {
		sessionId: s.id,
		title: s.title || "Untitled session",
		repo: s.repo,
		lastActivity: s.lastActivity,
		...(question ? { question } : {}),
		...(prFor(s) ? { pr: prFor(s) } : {}),
	};
}

const newestFirst = (a: DeskWorkItem, b: DeskWorkItem) =>
	a.lastActivity < b.lastActivity ? 1 : -1;

/**
 * The user's live state. Cheap: one cached sessions read (2s TTL, the same
 * one the sessions list uses), one reads file, one todos file.
 */
export function buildDeskState(user: string): DeskState {
	const now = Date.now();
	const reads = getReads(user);
	const waiting: DeskWorkItem[] = [];
	const running: DeskWorkItem[] = [];
	const review: DeskWorkItem[] = [];

	for (const s of getCachedSessions()) {
		// The Desk never lists itself, and never another person's work.
		if (s.desk) continue;
		if (!samePerson(s.createdBy, user)) continue;

		const question = askSummary(s.id);
		if (question || s.runState === "ask_blocked") {
			waiting.push(toItem(s, question));
			continue;
		}
		if (isRunningSession(s)) {
			running.push(toItem(s));
			continue;
		}
		// Finished. It earns a place only while it's recent AND unread — a
		// session with no read mark at all was never opened, which is exactly
		// the case that needs eyes, so it counts too.
		const age = now - new Date(s.lastActivity).getTime();
		if (Number.isNaN(age) || age > REVIEW_WINDOW_MS) continue;
		const mark = reads[s.id];
		if (mark && !isUnread(s.lastActivity, mark)) continue;
		review.push(toItem(s));
	}

	waiting.sort(newestFirst);
	running.sort(newestFirst);
	review.sort(newestFirst);

	const allTodos = listTodos({ user, status: "open", limit: 50 });
	const todos = allTodos.slice(0, MAX_PER_BUCKET).map((t) => ({
		id: t.id,
		text: t.text,
		...(t.due ? { due: t.due } : {}),
	}));

	return {
		waiting: waiting.slice(0, MAX_PER_BUCKET),
		running: running.slice(0, MAX_PER_BUCKET),
		review: review.slice(0, MAX_PER_BUCKET),
		todos,
		more: {
			waiting: Math.max(0, waiting.length - MAX_PER_BUCKET),
			running: Math.max(0, running.length - MAX_PER_BUCKET),
			review: Math.max(0, review.length - MAX_PER_BUCKET),
			todos: Math.max(0, allTodos.length - MAX_PER_BUCKET),
		},
		generatedAt: new Date().toISOString(),
	};
}

function line(item: DeskWorkItem, extra?: string): string {
	const bits = [item.title];
	if (item.repo) bits.push(`(${item.repo})`);
	const head = `- ${item.sessionId} — ${bits.join(" ")}`;
	return extra ? `${head} — ${extra}` : head;
}

function prBit(pr: DeskPr | undefined): string | undefined {
	if (!pr) return undefined;
	const checks = pr.checks;
	const health = !checks
		? ""
		: checks.failed > 0
			? ", checks failing"
			: checks.pending > 0
				? ", checks pending"
				: ", checks green";
	return `PR #${pr.number} ${(pr.state || "open").toLowerCase()}${health}`;
}

/**
 * The compact briefing prepended to a Desk turn. Stays a dozen-odd lines: the
 * Desk runs on a fast model at low effort for instant feel (desk.ts), so this
 * must never become a context dump.
 */
export function renderDeskBriefing(state: DeskState): string {
	const out: string[] = ["## The user's live state (rebuilt for this turn)"];
	const empty =
		!state.waiting.length && !state.running.length && !state.review.length;

	if (state.waiting.length) {
		out.push("", `Waiting on the user (${state.waiting.length}):`);
		for (const w of state.waiting)
			out.push(line(w, w.question ? `asked: "${w.question.text}"` : "blocked on a question"));
	}
	if (state.running.length) {
		out.push("", `Running right now (${state.running.length + state.more.running}):`);
		for (const r of state.running) out.push(line(r));
	}
	if (state.review.length) {
		out.push(
			"",
			`Finished and not yet read (${state.review.length + state.more.review}):`,
		);
		for (const r of state.review) out.push(line(r, prBit(r.pr)));
	}
	if (empty) out.push("", "Nothing is running, and nothing is waiting on them.");

	if (state.todos.length) {
		out.push("", `Open todos (${state.todos.length + state.more.todos}):`);
		for (const t of state.todos)
			out.push(`- ${t.id} — ${t.text}${t.due ? ` (due ${t.due})` : ""}`);
	}

	out.push(
		"",
		"Use this instead of asking a tool for the same facts, and re-read it rather than trusting what you said last turn — it is rebuilt every turn.",
		"Before starting anything, check it against the list above: if a session is already on that work, steer it (`send_to_session`) instead of spawning a second one.",
	);
	return out.join("\n");
}

/** The briefing for a user, or undefined when it can't be built — a state
 *  failure must never block a Desk turn. */
export function deskBriefingFor(user: string | undefined): string | undefined {
	if (!user) return undefined;
	try {
		return renderDeskBriefing(buildDeskState(user));
	} catch (e) {
		console.warn("[desk] failed to build the live-state briefing:", e);
		return undefined;
	}
}
