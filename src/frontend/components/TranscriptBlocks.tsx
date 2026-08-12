import React from "react";
import type { SessionNote, SessionWalkthrough, TranscriptEntry } from "../lib/types";
import { MessageBubble } from "./MessageBubble";
import { NoteBubble } from "./NoteBubble";
import { TurnBlock } from "./TurnBlock";
import { collectTouchedFiles, TurnFooter, type TouchedFile } from "./TurnFooter";
import { VirtualTranscriptBlock } from "./VirtualTranscriptBlock";
import { WalkthroughCard } from "./WalkthroughCard";
import { walkthroughInsertIndex } from "./walkthrough-placement";
import { normalizeLegacyVoiceToolEntries } from "../lib/transcript-state";
import { collectWrittenAssets } from "../lib/open-asset";
import { classifyEntry } from "@tellahq/opensession-protocol/notices";
import { ReviewLoopBlock, type ReviewLoopOutcome } from "./ReviewLoopBlock";
import {
	ShippedChangeComposer,
	type ShippedChangeComposerProps,
} from "./ShippedChangeComposer";

type RenderBlock =
	| { kind: "entry"; entry: TranscriptEntry }
	| { kind: "turn"; items: TranscriptEntry[] }
	| {
			kind: "footer";
			entry: TranscriptEntry;
			durationMs: number;
			files: TouchedFile[];
			assets: string[];
	  }
	| { kind: "walkthrough"; walkthrough: SessionWalkthrough }
	| { kind: "note"; note: SessionNote }
	| { kind: "review-loop"; blocks: RenderBlock[]; prNumber: number | null; rounds: number };

interface Props {
	entries: TranscriptEntry[];
	/** Whether the conversation is live (last work block shows a spinner / stays open). */
	live?: boolean;
	/** Assistant messages show a "Fork from here" action when provided. */
	onFork?: (entryId: string) => void;
	/** Called when a Task/Agent block's "Open sub-agent" affordance is clicked. */
	onOpenSubagent?: (agentId: string, label: string) => void;
	/** Session owner (startedBy) — credited on un-attributed user turns. */
	owner?: string;
	/** Lets wire-clamped entries' "Show full message" fetch the full content. */
	sessionId?: string;
	/** Agent-published walkthrough — rendered inline where it was published.
	 *  Pass a referentially stable object (see SessionViewer) so the memo holds. */
	walkthrough?: SessionWalkthrough;
	/** Team notes (src/server/session-notes.ts) interleaved into the timeline
	 *  by timestamp. Agent-invisible; rendered as NoteBubbles. */
	notes?: SessionNote[];
	slackShare?: ShippedChangeComposerProps & {
		prNumber: number;
	};
	/** A fresh, green PR result. Rendered as the final review loop's own
	 * outcome, never as a replacement for the most recent fix turn. */
	reviewOutcome?: ReviewLoopOutcome;
}

function reviewHandoff(block: RenderBlock): number | null | undefined {
	if (block.kind !== "entry") return undefined;
	const notice = classifyEntry(block.entry).notice;
	if (notice?.kind !== "review-handoff") return undefined;
	const match = notice.title.match(/PR #(\d+)/);
	return match ? Number(match[1]) : null;
}

/** A review handoff and the agent work it triggers form one quiet phase. A
 * real user message always ends it, so people never lose their own request in
 * a collapsed automation trail. */
function groupReviewLoops(blocks: RenderBlock[]): RenderBlock[] {
	const grouped: RenderBlock[] = [];
	for (let i = 0; i < blocks.length; i++) {
		const first = blocks[i];
		const firstPr = reviewHandoff(first);
		if (firstPr === undefined) {
			grouped.push(first);
			continue;
		}
		const loop: RenderBlock[] = [first];
		let rounds = 1;
		let prNumber = firstPr;
		while (i + 1 < blocks.length) {
			const next = blocks[i + 1];
			// Notes and walkthroughs have their own placement and must never vanish
			// inside an automation disclosure.
			if (next.kind === "note" || next.kind === "walkthrough") break;
			// A normal user message is a new conversation phase. A second review
			// handoff belongs to this loop and starts its next round.
			if (next.kind === "entry" && next.entry.type === "user" && reviewHandoff(next) === undefined)
				break;
			i++;
			loop.push(next);
			const nextPr = reviewHandoff(next);
			if (nextPr !== undefined) {
				rounds++;
				prNumber ??= nextPr;
			}
		}
		grouped.push({ kind: "review-loop", blocks: loop, prNumber, rounds });
	}
	return grouped;
}

function mergedNoticePrNumber(entry: TranscriptEntry): number | null {
	if (entry.notice?.kind !== "system") return null;
	const match = entry.content.match(/\bPR #(\d+).*\bwas merged into\b/i);
	return match ? Number(match[1]) : null;
}

/**
 * Groups a flat transcript into per-turn fold blocks and message bubbles, then
 * renders them. A turn's working (tool calls + intermediate assistant notes)
 * folds into one collapsed TurnBlock; only the turn's final answer stays out
 * as a normal bubble — so the session reads question → answer, calm by default.
 * Shared by the main session view and the sub-agent sidebar so both render
 * identically.
 */
// Memoized: the transcript is expensive to render (markdown parsing + code
// highlighting across every bubble/work block), and unrelated SessionViewer
// re-renders — most notably toggling the workspace panel on/off — would
// otherwise re-render the whole thing synchronously and stall the interaction.
// With stable props (entries reference unchanged, callbacks memoized upstream)
// this bails out entirely on a panel toggle. See SessionViewer's useCallbacks.
export const TranscriptBlocks = React.memo(function TranscriptBlocks({
	entries,
	live,
	onFork,
	onOpenSubagent,
	owner,
	sessionId,
	walkthrough,
	notes,
	slackShare,
	reviewOutcome,
}: Props) {
	const renderedEntries = normalizeLegacyVoiceToolEntries(entries);
	const shareAfterEntryIds = new Set<string>();
	if (slackShare) {
		for (let i = 0; i < renderedEntries.length; i++) {
			if (mergedNoticePrNumber(renderedEntries[i]) !== slackShare.prNumber) continue;
			let targetId = renderedEntries[i].id;
			for (let j = i + 1; j < renderedEntries.length; j++) {
				const candidate = renderedEntries[j];
				if (candidate.type === "user" || candidate.type === "system") break;
				if (candidate.type === "assistant") targetId = candidate.id;
			}
			shareAfterEntryIds.add(targetId);
		}
	}
	// Build tool_use → tool_result map
	const toolResults = new Map<string, TranscriptEntry>();
	for (const e of renderedEntries) {
		if (e.type === "tool_result" && e.toolUseId)
			toolResults.set(e.toolUseId, e);
	}

	const blocks: RenderBlock[] = [];
	// The current assistant turn: consecutive assistant/tool_use entries between
	// user/system boundaries, accumulated then flushed as one fold.
	let turn: TranscriptEntry[] = [];

	const flushTurn = (trailing = false) => {
		if (turn.length === 0) return;
		const last = turn[turn.length - 1];
		const final = last.type === "assistant" ? last : null;
		if (!turn.some((e) => e.type === "tool_use")) {
			// Plain answer(s), nothing to fold.
			for (const e of turn) blocks.push({ kind: "entry", entry: e });
		} else {
			// The turn's final answer (when it ended with one) stays visible;
			// everything before it folds. A turn still mid-tools folds entirely.
			const folded = final ? turn.slice(0, -1) : turn;
			if (folded.length > 0) blocks.push({ kind: "turn", items: folded });
			if (final) blocks.push({ kind: "entry", entry: final });
		}
		// Quiet actions under the settled answer, the files the turn wrote, and
		// scratch files that have no other direct route from the transcript.
		if (final && !(live && trailing)) {
			blocks.push({
				kind: "footer",
				entry: final,
				durationMs:
					new Date(final.timestamp).getTime() -
					new Date(turn[0].timestamp).getTime(),
				files: collectTouchedFiles(turn),
				assets: collectWrittenAssets(turn),
			});
		}
		turn = [];
	};

	for (const entry of renderedEntries) {
		if (entry.type === "tool_result") {
			continue; // rendered inside turn blocks via toolResults
		} else if (entry.type === "assistant" || entry.type === "tool_use") {
			turn.push(entry);
		} else {
			flushTurn();
			blocks.push({ kind: "entry", entry });
		}
	}
	flushTurn(true);

	if (walkthrough)
		blocks.splice(walkthroughInsertIndex(blocks, walkthrough), 0, {
			kind: "walkthrough",
			walkthrough,
		});

	// Interleave team notes by timestamp: each note lands after the last block
	// whose time is at or before it (footers share their answer's time, so a
	// note never splits an answer from its footer). Notes newer than the whole
	// window append at the end.
	if (notes?.length) {
		const blockTime = (b: RenderBlock): number => {
			if (b.kind === "walkthrough")
				return new Date(b.walkthrough.publishedAt).getTime();
			if (b.kind === "note") return b.note.ts;
			if (b.kind === "review-loop") {
				const last = b.blocks[b.blocks.length - 1];
				return last ? blockTime(last) : 0;
			}
			const entry =
				b.kind === "turn" ? b.items[b.items.length - 1] : b.entry;
			return entry ? new Date(entry.timestamp).getTime() : 0;
		};
		const sorted = [...notes].sort((a, b) => a.ts - b.ts);
		let at = 0;
		for (const note of sorted) {
			while (at < blocks.length && blockTime(blocks[at]!) <= note.ts) at++;
			blocks.splice(at, 0, { kind: "note", note });
			at++;
		}
	}
	const groupedBlocks = groupReviewLoops(blocks);
	const lastReviewLoop = groupedBlocks.findLastIndex(
		(block) => block.kind === "review-loop",
	);
	// A later human turn makes the old verdict stale in spirit even before GitHub
	// has observed a new push. Operational notices and recaps do not: they are
	// allowed to follow the outcome without hiding it.
	const showReviewOutcome =
		!!reviewOutcome &&
		lastReviewLoop >= 0 &&
		!groupedBlocks.slice(lastReviewLoop + 1).some(
			(block) => block.kind === "entry" && block.entry.type === "user",
		);

	return (
		<>
			{groupedBlocks.map((block, i) => {
				if (block.kind === "review-loop") {
					const isLast = i === groupedBlocks.length - 1;
					const isLive = Boolean(live && isLast);
					return (
						<React.Fragment key={`review-loop:${block.blocks[0]?.kind === "entry" ? block.blocks[0].entry.id : i}`}>
							<ReviewLoopBlock
								prNumber={block.prNumber}
								rounds={block.rounds}
								live={isLive}
								// A loop still fixing feedback has not settled on anything
								// yet, whatever GitHub last reported about the PR.
								outcome={
									showReviewOutcome && i === lastReviewLoop && !isLive
										? reviewOutcome
										: undefined
								}
							>
								{block.blocks.map((inner, innerIndex) => {
									const innerKey = inner.kind === "turn"
										? inner.items[0].id
										: inner.kind === "footer"
											? `${inner.entry.id}:footer`
											: inner.kind === "entry"
												? inner.entry.id
												: `inner:${innerIndex}`;
									return (
										<React.Fragment key={innerKey}>
											{inner.kind === "turn" ? (
												<TurnBlock items={inner.items} toolResults={toolResults} live={Boolean(live && isLast && innerIndex === block.blocks.length - 1)} onOpenSubagent={onOpenSubagent} sessionId={sessionId} />
											) : inner.kind === "footer" ? (
												<TurnFooter entry={inner.entry} durationMs={inner.durationMs} files={inner.files} assets={inner.assets} onFork={onFork} />
											) : inner.kind === "entry" ? (
												<MessageBubble entry={inner.entry} owner={owner} sessionId={sessionId} />
											) : null}
										</React.Fragment>
									);
								})}
							</ReviewLoopBlock>
						</React.Fragment>
					);
				}
				const key =
					block.kind === "turn"
						? block.items[0].id
						: block.kind === "walkthrough"
							? "walkthrough"
							: block.kind === "note"
								? `note:${block.note.id}`
								: block.kind === "footer"
									? `${block.entry.id}:footer`
									: block.entry.id;
				const anchorId =
					block.kind === "turn"
						? `${block.items[block.items.length - 1].id}#turn`
						: key;
				// While streaming, flushTurn splits trailing assistant text out as
				// its own block after the fold, so the live turn alternates between
				// being last and second-to-last as text and tool calls interleave —
				// a turn fold directly before the tail is still the live turn.
				const isLiveTail =
					Boolean(live) &&
					(i === groupedBlocks.length - 1 ||
						(block.kind === "turn" && i === groupedBlocks.length - 2));
				const content =
					block.kind === "turn" ? (
					<TurnBlock
						items={block.items}
						toolResults={toolResults}
						live={isLiveTail}
						onOpenSubagent={onOpenSubagent}
						sessionId={sessionId}
					/>
				) : block.kind === "walkthrough" ? (
					<WalkthroughCard
						walkthrough={block.walkthrough}
						variant="session"
					/>
				) : block.kind === "note" ? (
					<NoteBubble note={block.note} sessionId={sessionId} />
				) : block.kind === "footer" ? (
					<TurnFooter
						entry={block.entry}
						durationMs={block.durationMs}
						files={block.files}
						assets={block.assets}
						onFork={onFork}
					/>
				) : (
					<MessageBubble
						entry={block.entry}
						owner={owner}
						sessionId={sessionId}
					/>
				);
				const showShareAction =
					block.kind === "entry" && shareAfterEntryIds.has(block.entry.id);
				return (
					<React.Fragment key={key}>
						<VirtualTranscriptBlock
							anchorId={anchorId}
							enabled={!isLiveTail && i < blocks.length - 24}
						>
							{content}
						</VirtualTranscriptBlock>
						{showShareAction && slackShare && (
							<ShippedChangeComposer {...slackShare} />
						)}
					</React.Fragment>
				);
			})}
		</>
	);
});
