/**
 * Landmarks — the navigable points of a transcript.
 *
 * One implementation, two consumers: the minimap rail in the web UI turns
 * these into ticks, and the server turns them into one-shot summary prompts.
 * They MUST agree, because a landmark's `id` is both the summary's cache key
 * and the `data-eid` of the rendered block the tick scrolls to. Deriving the
 * segmentation twice is how the two drift and the rail starts showing another
 * turn's title, so this module is the single source and lives outside both.
 *
 * The segmentation deliberately mirrors TranscriptBlocks' `flushTurn`:
 * consecutive assistant/tool_use entries between user boundaries are one turn;
 * the turn's final answer splits out as its own block, everything before it
 * folds. So each rendered block that a reader can navigate to — a prompt, a
 * work fold, an answer — gets exactly one landmark, wearing that block's
 * anchor id.
 */

/** The subset of a TranscriptEntry this module reads. Both the server's and
 *  the frontend's entry type satisfy it structurally. */
export interface LandmarkEntry {
	id: string;
	type: string;
	content?: string;
	timestamp: string;
	toolName?: string;
	toolInput?: unknown;
}

export type LandmarkKind = "prompt" | "work" | "step" | "answer";

export interface TranscriptLandmark {
	/** The rendered block's `data-eid` — the scroll target and the cache key. */
	id: string;
	kind: LandmarkKind;
	/** For a `step`: the fold it lives inside, which is collapsed by default —
	 *  jumping there has to open it before the step exists in the DOM. */
	turnId?: string;
	/** Epoch ms of the block's last entry. */
	ts: number;
	/** Derived label, shown immediately and until a generated summary lands. */
	label: string;
	/** A couple of lines of the block's own content, for the hover card. */
	preview: string;
	/** Faint second line: step count for work, nothing for prose. */
	meta: string;
	/** 0..1, drives tick width — how much happened here. */
	weight: number;
}

/* ------------------------------------------------------------------ *
 * Text helpers
 * ------------------------------------------------------------------ */

/** Collapse markdown into one readable run of prose for a preview line. */
function flatten(text: string): string {
	return (text || "")
		.replace(/```[\s\S]*?```/g, " ") // fenced code
		.replace(/`([^`]*)`/g, "$1")
		.replace(/^\s{0,3}#{1,6}\s+/gm, "") // heading markers
		.replace(/^\s*[-*+]\s+/gm, "") // bullets
		.replace(/^\s*>\s?/gm, "") // quotes
		.replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1") // links/images
		.replace(/[*_~]{1,3}/g, "")
		.replace(/<[^>]+>/g, " ")
		.replace(/\s+/g, " ")
		.trim();
}

function clamp(text: string, max: number): string {
	if (text.length <= max) return text;
	// Break on a word so the ellipsis doesn't cut mid-token.
	const cut = text.slice(0, max);
	const space = cut.lastIndexOf(" ");
	return `${(space > max * 0.6 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

/** The first sentence-ish run of a message — what a human would call its point. */
function firstLine(text: string, max = 64): string {
	const flat = flatten(text);
	if (!flat) return "";
	const stop = flat.search(/[.!?](\s|$)/);
	const head = stop > 12 && stop < max * 1.6 ? flat.slice(0, stop) : flat;
	return clamp(head, max);
}

/** The file/command/pattern a tool call acted on, if it names one. */
export function toolTarget(input: unknown): string {
	if (!input || typeof input !== "object") return "";
	const o = input as Record<string, unknown>;
	const raw =
		o.file_path ?? o.filePath ?? o.path ?? o.command ?? o.pattern ?? o.query ?? o.url;
	if (typeof raw !== "string") return "";
	const one = raw.replace(/\s+/g, " ").trim();
	// Paths read better as their tail; commands as their head.
	if (/^(\/|\.\/|[\w.-]+\/)/.test(one) && !one.includes(" "))
		return one.split("/").slice(-2).join("/");
	return clamp(one, 44);
}

/* ------------------------------------------------------------------ *
 * Anchor ids
 * ------------------------------------------------------------------ */

/**
 * The `data-eid` a folded turn wears, derived from its LAST item — the anchor
 * that survives a history page merging older rows into the same turn.
 *
 * Single-sourced on purpose: TurnBlock stamps it on the DOM, TranscriptBlocks
 * hands it to the virtualizer as the block's anchor, and a work landmark uses
 * it as both its cache key and its scroll target. Three places computing
 * `${id}#turn` by hand is exactly how a minimap starts jumping to the wrong
 * turn, so they all call this instead.
 */
export function workAnchorId(lastItemId: string): string {
	return `${lastItemId}#turn`;
}

/** The `data-eid` of one run of tool calls inside a fold — same contract as
 *  {@link workAnchorId}, stamped by TurnBlock's expanded section list. */
export function sectionAnchorId(lastItemId: string): string {
	return `${lastItemId}#sec`;
}

/* ------------------------------------------------------------------ *
 * Derivation
 * ------------------------------------------------------------------ */

function timeOf(entry: LandmarkEntry): number {
	const t = new Date(entry.timestamp).getTime();
	return Number.isFinite(t) ? t : 0;
}

function promptLandmark(entry: LandmarkEntry): TranscriptLandmark {
	const flat = flatten(entry.content || "");
	return {
		id: entry.id,
		kind: "prompt",
		ts: timeOf(entry),
		label: firstLine(entry.content || "") || "Message",
		preview: clamp(flat, 220),
		meta: "",
		// Prompts are the loudest landmark whatever their length — they're the
		// spine a reader navigates by.
		weight: 1,
	};
}

function answerLandmark(entry: LandmarkEntry): TranscriptLandmark {
	const flat = flatten(entry.content || "");
	return {
		id: entry.id,
		kind: "answer",
		ts: timeOf(entry),
		label: firstLine(entry.content || "") || "Reply",
		preview: clamp(flat, 220),
		meta: "",
		weight: Math.min(1, flat.length / 1200),
	};
}

/**
 * A fold's inner sections, exactly as TurnBlock lays them out: consecutive
 * tool calls share one run, and the agent's own notes break it into segments.
 *
 * These carry the rail on long sessions. Nearly half of all sessions have one
 * user prompt, so ticking only prompts, folds and answers would give them
 * two ticks for an hour of work — the sections are where "what was it doing
 * at that point" actually lives.
 */
function sectionsOf(
	items: LandmarkEntry[],
): Array<{ kind: "tools" | "msg"; items: LandmarkEntry[] }> {
	const out: Array<{ kind: "tools" | "msg"; items: LandmarkEntry[] }> = [];
	for (const it of items) {
		if (it.type === "tool_use") {
			const last = out[out.length - 1];
			if (last?.kind === "tools") last.items.push(it);
			else out.push({ kind: "tools", items: [it] });
		} else {
			out.push({ kind: "msg", items: [it] });
		}
	}
	return out;
}

function stepLandmarks(
	items: LandmarkEntry[],
	turnId: string,
): TranscriptLandmark[] {
	const sections = sectionsOf(items);
	// One section is the fold itself — a second tick on the same row would only
	// make the rail lie about how many places there are to go.
	if (sections.length < 2) return [];

	return sections.map((section) => {
		const last = section.items[section.items.length - 1];
		if (section.kind === "msg") {
			const flat = flatten(last.content || "");
			return {
				id: last.id,
				kind: "step" as const,
				turnId,
				ts: timeOf(last),
				label: firstLine(last.content || "") || "Note",
				preview: clamp(flat, 220),
				meta: "",
				weight: 0.35,
			};
		}
		const steps = section.items.map((t) => {
			const target = toolTarget(t.toolInput);
			return target ? `${t.toolName || "Tool"} ${target}` : t.toolName || "Tool";
		});
		return {
			id: sectionAnchorId(last.id),
			kind: "step" as const,
			turnId,
			ts: timeOf(last),
			label: steps[0] || "Working",
			preview: clamp(steps.filter((s, i) => steps.indexOf(s) === i).join(" · "), 220),
			meta: `${section.items.length} step${section.items.length === 1 ? "" : "s"}`,
			weight: Math.min(1, section.items.length / 8),
		};
	});
}

function workLandmark(items: LandmarkEntry[]): TranscriptLandmark {
	const tools = items.filter((it) => it.type === "tool_use");
	const notes = items.filter((it) => it.type === "assistant");
	const last = items[items.length - 1];
	// What the fold's own line says, so the tick never contradicts the row it
	// points at: "12 steps" / "3 messages".
	const meta =
		tools.length > 0
			? `${tools.length} step${tools.length === 1 ? "" : "s"}`
			: notes.length > 0
				? `${notes.length} message${notes.length === 1 ? "" : "s"}`
				: "";

	// Preview: the agent's own narration if it wrote any (that IS the summary
	// of what it was doing), otherwise the run of tools it made.
	const narration = notes.map((n) => flatten(n.content || "")).find(Boolean) || "";
	const steps = tools
		.map((t) => {
			const target = toolTarget(t.toolInput);
			return target ? `${t.toolName || "Tool"} ${target}` : t.toolName || "Tool";
		})
		.filter(Boolean);
	const uniqueSteps = steps.filter((s, i) => steps.indexOf(s) === i);

	return {
		id: workAnchorId(last.id),
		kind: "work",
		ts: timeOf(last),
		label: narration ? firstLine(narration) : uniqueSteps[0] || "Working",
		preview: clamp(narration || uniqueSteps.join(" · "), 220),
		meta,
		weight: Math.min(1, tools.length / 20),
	};
}

/**
 * Group a flat transcript into the blocks a reader can jump to.
 *
 * Mirrors TranscriptBlocks: tool_result is folded into its tool_use and never
 * a landmark of its own; system entries are inline chips, not destinations.
 */
export function buildLandmarks(entries: LandmarkEntry[]): TranscriptLandmark[] {
	const out: TranscriptLandmark[] = [];
	let turn: LandmarkEntry[] = [];

	const flushTurn = () => {
		if (turn.length === 0) return;
		const last = turn[turn.length - 1];
		const final = last.type === "assistant" ? last : null;
		if (!turn.some((e) => e.type === "tool_use")) {
			// No tools — every entry rendered as its own answer bubble.
			for (const e of turn) if (e.type === "assistant") out.push(answerLandmark(e));
		} else {
			const folded = final ? turn.slice(0, -1) : turn;
			if (folded.length > 0) {
				// The fold's own row first — it's what the reader scrolls past
				// while the fold is closed — then the steps inside it.
				const work = workLandmark(folded);
				out.push(work, ...stepLandmarks(folded, work.id));
			}
			if (final) out.push(answerLandmark(final));
		}
		turn = [];
	};

	for (const entry of entries) {
		if (entry.type === "tool_result") continue;
		if (entry.type === "assistant" || entry.type === "tool_use") {
			turn.push(entry);
		} else {
			flushTurn();
			if (entry.type === "user") out.push(promptLandmark(entry));
		}
	}
	flushTurn();

	return out;
}

/**
 * One line of model input per landmark: enough to name what happened, clamped
 * hard so a 9000-entry session can't blow a batch's context.
 */
export function landmarkDigest(landmark: TranscriptLandmark): string {
	const who =
		landmark.kind === "prompt"
			? "User asked"
			: landmark.kind === "answer"
				? "Agent replied"
				: landmark.kind === "step"
					? "Agent step"
					: "Agent worked";
	const body = clamp(landmark.preview, 420);
	return landmark.meta ? `${who} (${landmark.meta}): ${body}` : `${who}: ${body}`;
}
