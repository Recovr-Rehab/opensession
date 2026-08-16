/**
 * Model-visible means logged.
 *
 * A turn's model input is more than the message a human typed: an engine
 * handoff transcript, the repos/memory note, an attached session's excerpt, a
 * ticket's context. All of it is deliberately invisible in the rendered
 * conversation (prompt-context.ts fences it; the parsers strip the fence), and
 * until this module none of it was written down anywhere — so a stored session
 * could not reproduce the request that produced its answers. Replay, eval and
 * "why did it do that" all need the real input.
 *
 * This records every injected payload as an ordinary `TranscriptEntry` — a
 * system entry tagged `context-injection` — at the point it reaches an engine.
 * Riding the normal entry path is deliberate: the store's blob-splitting
 * bounds a 180KB handoff exactly as it bounds any other oversized entry, the
 * bus/ws protocol needs no new frame, and deletion/import/export keep working.
 * Client-bound projections drop these entries (dropContextInjections), so no
 * viewer's transcript changes.
 *
 * ## The choke point
 *
 * `runOnModel` (agent-runner.ts) is where every engine dispatch happens —
 * opencode, pi, claude-direct, codex-direct, and the test fake — for every
 * model of a fallback walk. One call there covers all of them, including the
 * handoff the walk itself prepends on a cross-provider hop, because it runs
 * once per hop with that hop's exact prompt.
 *
 * Its one blind spot is an injection added BELOW it: the opencode runner
 * prepends a same-engine-restart handoff per attempt (opencode-runner.ts), so
 * that site calls in too. Both calls are safe to overlap — an entry's id is
 * derived from its content, so re-logging a payload upserts its own row
 * instead of duplicating it, and the in-process dedupe below usually skips the
 * write entirely.
 *
 * ## What is NOT covered
 *
 * The engine's own standing instructions (opencode's config instructions file,
 * AGENTS.md, the direct engines' system prompts) are model-visible too, but
 * they are properties of the checkout and the run config rather than per-turn
 * payloads; they are not recorded here. The repos/memory note IS, because it
 * is built per turn from mutable session state.
 */
import { createHash } from "crypto";
import {
	storeAppendUserLineEarly,
	transcriptLineContextInjection,
} from "./opencode-transcript";
import {
	parseContextBlocks,
	type ContextSource,
} from "./prompt-context";

export interface InjectedContextInput {
	/** Unified session id. No session ⇒ nothing to log against (see gaps). */
	sessionId?: string | null;
	/** The prompt's transcript entry id, or the run token — what groups a
	 *  turn's injections with the message they rode with. */
	turnId?: string | null;
	/** Prompt body about to be sent; every fenced block in it is recorded. */
	prompt?: string | null;
	/** The per-turn system note (repos + memory), injected through the engine's
	 *  system/instructions channel rather than the prompt body. */
	reposNote?: string | null;
	/** Model the payload was sent to, for the audit line. */
	model?: string;
}

/**
 * Entry ids already written this process run. An entry id is a content hash,
 * so this only ever skips a byte-identical re-append (a retry, a second call
 * from the opencode runner) — the store would upsert those onto the same row
 * anyway; skipping saves the write and the bus wake. Bounded because a
 * long-lived server would otherwise accumulate one string per injection
 * forever; a drop past the bound costs one harmless upsert.
 */
const logged: Set<string> = ((globalThis as any).__osContextLogged ??= new Set());
const LOGGED_MAX = 5_000;

function remember(id: string): boolean {
	if (logged.has(id)) return false;
	if (logged.size >= LOGGED_MAX) logged.clear();
	logged.add(id);
	return true;
}

/** Deterministic, content-derived id: the same payload in the same turn is the
 *  same row, whichever call site logs it and however many times a turn is
 *  retried. */
function entryId(
	sessionId: string,
	turnId: string,
	source: string,
	body: string,
): string {
	const h = createHash("sha256")
		.update(`${sessionId}\u0000${turnId}\u0000${source}\u0000${body}`)
		.digest("hex");
	return `ctx-${h.slice(0, 32)}`;
}

/** Test seam: record instead of writing, so a test can assert the calls
 *  without a store. Null (the default) = the real store path. */
let sinkForTest:
	| ((rec: {
			sessionId: string;
			source: ContextSource | string;
			turnId: string;
			body: string;
	  }) => void)
	| null = null;
export function __setContextLogSinkForTest(fn: typeof sinkForTest): void {
	sinkForTest = fn;
}

/**
 * Record every model-visible injected payload in `input`. Never throws: a
 * failed audit write must not fail the turn (the store helper already warns
 * once per session on failure).
 */
export function logInjectedContext(input: InjectedContextInput): void {
	const sessionId = input.sessionId || "";
	if (!sessionId) return;
	const turnId = input.turnId || "";
	const blocks: Array<{ source: ContextSource | string; body: string }> =
		parseContextBlocks(input.prompt || "");
	// The system-channel note (repos discipline + repo/user/team memory) is
	// model-visible without ever appearing in the prompt body, so it is logged
	// beside the fenced blocks rather than through them.
	const note = input.reposNote?.trim();
	if (note) blocks.push({ source: "repos-note", body: note });
	if (!blocks.length) return;

	for (const block of blocks) {
		const id = entryId(sessionId, turnId, block.source, block.body);
		if (!remember(id)) continue;
		if (sinkForTest) {
			sinkForTest({ sessionId, source: block.source, turnId, body: block.body });
			continue;
		}
		// The ordinary entry path — same helper the intake user line uses, so
		// the import-first gate, the 32KB blob split and the bus publish all
		// behave exactly as they do for any other entry.
		storeAppendUserLineEarly(
			sessionId,
			transcriptLineContextInjection(
				block.body,
				{ source: block.source, ...(turnId ? { turnId } : {}) },
				id,
			),
		);
	}
}
