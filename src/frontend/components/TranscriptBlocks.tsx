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
import { Button } from "../ui/button";
import { BrandMark } from "./BrandMark";

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
	| { kind: "note"; note: SessionNote };

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
	slackShare?: {
		prNumber: number;
		preview: {
			persona: string;
			title: string;
			url: string;
			summary: string;
			screenshot: string;
		};
		status: "idle" | "sharing" | "shared";
		onShare: () => void;
	};
}

function mergedNoticePrNumber(entry: TranscriptEntry): number | null {
	if (entry.notice?.kind !== "system") return null;
	const match = entry.content.match(/^PR #(\d+).*\bwas merged into\b/i);
	return match ? Number(match[1]) : null;
}

function shippedChangeOneLiner(markdown: string, max = 280): string {
	const prose = markdown
		.split(/\n\s*\n/)
		.map((part) => part.trim())
		.find((part) => part && !/^#{1,6}\s/.test(part) && !/^[-*]\s*$/.test(part)) || "";
	const plain = prose
		.replace(/!\[[^\]]*\]\([^)]*\)/g, "")
		.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
		.replace(/^\s*(?:#{1,6}|[-*+])\s+/gm, "")
		.replace(/[*_`~]/g, "")
		.replace(/\s+/g, " ")
		.trim();
	if (plain.length <= max) return plain;
	const clipped = plain.slice(0, max - 1);
	const wordBoundary = clipped.lastIndexOf(" ");
	return `${clipped.slice(0, wordBoundary > max * 0.7 ? wordBoundary : undefined).trimEnd()}…`;
}

function ShippedChangeAction({
	preview,
	status,
	onShare,
}: NonNullable<Props["slackShare"]>) {
	const reason = shippedChangeOneLiner(preview.summary);
	return (
		<div className="mx-auto mb-6 -mt-2 w-full max-w-[var(--session-col)] overflow-hidden rounded-lg border border-line bg-panel">
			<div className="border-b border-line px-3 py-2 text-meta font-medium text-faint">
				Slack preview
			</div>
			<div className="px-3 py-3 text-body leading-relaxed text-fg">
				<strong>
					{preview.persona} shipped{" "}
					<a
						className="text-link no-underline hover:underline"
						href={preview.url}
						target="_blank"
						rel="noopener"
					>
						{preview.title}
					</a>
				</strong>
				{reason && <div>{reason}</div>}
			</div>
			<img
				className="max-h-80 w-full border-y border-line bg-surface object-contain"
				src={`/media?path=${encodeURIComponent(preview.screenshot)}`}
				alt={`Screenshot of the shipped visual change: ${preview.title}`}
			/>
			<div className="flex justify-end px-3 py-2.5">
				<Button
					size="sm"
					icon={<BrandMark name="slack" size={14} />}
					className="[&>span:first-child]:opacity-100"
					disabled={status !== "idle"}
					onClick={onShare}
				>
					{status === "sharing"
						? "Sharing…"
						: status === "shared"
							? "Shared to Slack"
							: "Share to Slack"}
				</Button>
			</div>
		</div>
	);
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

	return (
		<>
			{blocks.map((block, i) => {
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
					(i === blocks.length - 1 ||
						(block.kind === "turn" && i === blocks.length - 2));
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
						slackShare={slackShare}
					/>
				) : block.kind === "note" ? (
					<NoteBubble note={block.note} />
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
							<ShippedChangeAction {...slackShare} />
						)}
					</React.Fragment>
				);
			})}
		</>
	);
});
