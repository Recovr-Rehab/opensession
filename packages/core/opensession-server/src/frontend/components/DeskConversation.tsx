import React, { useEffect, useRef, useState } from "react";
import type { TranscriptEntry } from "../lib/types";
import { useWebSocket } from "../hooks/useWebSocket";
import { getCurrentUser } from "./UserPicker";
import { renderMarkdown } from "../lib/markdown";
import {
	fetchFileMentions,
	fetchMentionSuggestions,
	fetchModels,
	type ModelOption,
} from "../lib/api";
import type { FileAttachment } from "../lib/images";
import { TranscriptBlocks } from "./TranscriptBlocks";
import { Composer } from "./Composer";
import { mergeTranscriptEntries } from "../lib/transcript-state";
import { CONTINUE_AFTER_FAILURE_PROMPT } from "../lib/continue-run";
import { cn } from "../ui/cn";
import {
	msgBodyStreaming,
	msgBubbleUser,
	msgOwnTurn,
	msgRow,
	msgStreamingRow,
} from "../lib/msg-classes";

interface DeskConversationProps {
	sessionId: string;
	/** The dismissed Desk stays mounted and streaming, but is not presence. */
	presenceActive?: boolean;
	/** Focus the composer when this conversation first mounts. */
	autoFocus?: boolean;
	placeholder?: string;
	/** The Desk session's stored model and reasoning effort (from
	 *  /api/desk/ensure). Both are switchable from the composer's model pill. */
	model?: string;
	effort?: string;
	hideBefore?: string;
	/** While a voice call is live, typed messages go into it instead of
	 *  starting a text run. Return false to fall through to the normal send. */
	voiceSend?: (text: string) => boolean;
	/** Drill into a session a tool call spawned (the Desk delegates constantly).
	 *  The overlay has no side pane, so this opens it in the full viewer. */
	onOpenSubagent?: (sessionId: string) => void;
	/** Treat a conversation older than this as finished, so the Desk opens on
	 *  its board rather than on a days-old chat. Display only — one click
	 *  brings it back, and the full transcript is always in the session view. */
	staleAfterMs?: number;
	/** Starter prompts, shown as a scrolling pill row above the composer while
	 *  there's no conversation. Picking one fills the composer rather than
	 *  sending: some of them name actions with side effects, and all of them
	 *  are openings you'd want to finish in your own words. */
	suggestions?: string[];
}

/**
 * Compact conversation view for the standing Desk session. It owns a separate
 * socket because the app-wide socket may already be watching a regular session.
 */
export function DeskConversation({
	sessionId,
	presenceActive = true,
	autoFocus = false,
	placeholder,
	model: sessionModel,
	effort: sessionEffort,
	hideBefore,
	voiceSend,
	onOpenSubagent,
	staleAfterMs,
	suggestions,
}: DeskConversationProps) {
	const { connected, send, addHandler } = useWebSocket(presenceActive);
	const [entries, setEntries] = useState<TranscriptEntry[]>([]);
	const [streamText, setStreamText] = useState("");
	const [isRunning, setIsRunning] = useState(false);
	const [pending, setPending] = useState<string | null>(null);
	// Attachments staged for the next send. The Composer stages files to disk
	// itself (no `onAddAttachments`), the same way the catch-up deck's reply box
	// does; both ride along on the prompt.
	const [images, setImages] = useState<string[]>([]);
	const [files, setFiles] = useState<FileAttachment[]>([]);
	// The model pill's catalog. Empty until it loads — the pill falls back to
	// naming the id it was given, so nothing waits on this.
	const [models, setModels] = useState<ModelOption[]>([]);
	const [defaultModel, setDefaultModel] = useState("");
	const [model, setModel] = useState(sessionModel || "");
	// The Desk is pinned to a fast model on low effort server-side (desk.ts);
	// both are the session's own settings from here on.
	const [effort, setEffort] = useState(sessionEffort || "low");
	// Picking a starter pill fills the composer rather than sending, so it goes
	// in as a one-shot prefill (the draft lives inside the Composer).
	const [prefill, setPrefill] = useState<{
		seq: number;
		text: string;
		replace: boolean;
	} | null>(null);
	const bodyRef = useRef<HTMLDivElement | null>(null);
	const textareaRef = useRef<HTMLTextAreaElement | null>(null);

	useEffect(() => {
		if (!autoFocus) return;
		const timer = window.setTimeout(
			() => textareaRef.current?.focus({ preventScroll: true }),
			160,
		);
		return () => window.clearTimeout(timer);
	}, [autoFocus]);
	// Stick to the live edge only while the reader is already there, so a
	// streaming reply doesn't yank them up from scrollback.
	const followRef = useRef(true);
	const streamSeqRef = useRef(0);
	const [showEarlier, setShowEarlier] = useState(false);

	// The Desk's "Clear" marker: everything at/before it stays out of this view
	// (locally-minted system lines have fresh timestamps and survive).
	const cleared = hideBefore
		? entries.filter((e) => !e.timestamp || e.timestamp > hideBefore)
		: entries;

	// A conversation you left days ago isn't one you're in: past staleAfterMs
	// the Desk opens on its board instead. The cutoff is frozen at mount, so
	// anything said in this sitting stays put no matter how long it stays open.
	const staleCutoff = useRef(
		staleAfterMs ? new Date(Date.now() - staleAfterMs).toISOString() : null,
	).current;
	const visibleEntries =
		staleCutoff && !showEarlier
			? cleared.filter((e) => !e.timestamp || e.timestamp > staleCutoff)
			: cleared;
	const earlierCount = cleared.length - visibleEntries.length;
	const hasContent = visibleEntries.length > 0 || !!streamText || !!pending;

	useEffect(() => {
		fetchModels()
			.then((m) => {
				setModels(m.models);
				setDefaultModel(m.default);
			})
			.catch(() => {});
	}, []);

	// Watch the Desk only and tear the socket down on unmount / id change.
	useEffect(() => {
		if (!connected) return;
		setEntries([]);
		setStreamText("");
		setPending(null);
		followRef.current = true;
		// supportsSeq: transcript v2 capability (docs/transcripts.md).
		// This view merges by entry id and never uses offset/rev cursors or
		// history paging, so seq-mode frames need no extra state here; old
		// servers ignore the field entirely.
		send({
			type: "watch",
			sessionId,
			user: getCurrentUser(),
			supportsSeq: true,
			supportsChangeSeq: true,
		});

		const unsubscribe = addHandler((msg) => {
			if ("sessionId" in msg && msg.sessionId && msg.sessionId !== sessionId)
				return;
			switch (msg.type) {
				case "transcript_init":
					setEntries(msg.entries);
					break;
				case "transcript_history":
					setEntries((prev) =>
						mergeTranscriptEntries(prev, msg.entries, msg.v2 === true),
					);
					break;
				case "transcript_append": {
					setEntries((prev) =>
						mergeTranscriptEntries(prev, msg.entries, msg.v2 === true),
					);
					if (msg.entries.some((e) => e.type === "user")) setPending(null);
					const landed = msg.entries.filter(
						(e) => e.type === "assistant" && e.content,
					);
					if (landed.length) {
						setStreamText((prev) => {
							let next = prev;
							for (const e of landed) next = next.replace(e.content, "");
							return next.trim() ? next : "";
						});
					}
					break;
				}
				case "session_status":
					setIsRunning(msg.isRunning);
					break;
				case "stream_start":
					streamSeqRef.current++;
					setIsRunning(true);
					setStreamText("");
					setPending(null);
					break;
				case "stream_text":
					setStreamText((prev) => prev + msg.text);
					break;
				case "stream_tool_use":
				case "stream_tool_result":
					setEntries((prev) => mergeTranscriptEntries(prev, [msg.entry]));
					break;
				case "stream_done": {
					const seq = streamSeqRef.current;
					window.setTimeout(() => {
						if (streamSeqRef.current === seq) setStreamText("");
					}, 5000);
					break;
				}
				// A slash-command reply / server heads-up. Weave it in as a system
				// line so it reads inline with the conversation (mirrors SessionViewer).
				case "notice":
					setEntries((prev) => [
						...prev,
						{
							id: crypto.randomUUID(),
							type: "system",
							content: msg.message,
							timestamp: new Date().toISOString(),
						},
					]);
					break;
				// A failed/aborted run. Without this the panel just stops silently —
				// surface the error where the reply would have been and clear any
				// streaming/sending state so nothing sticks (mirrors SessionViewer).
				case "error":
					streamSeqRef.current++;
					setIsRunning(false);
					setStreamText("");
					setPending(null);
					if (msg.message) {
						setEntries((prev) => [
							...prev,
							{
								id: crypto.randomUUID(),
								type: "system",
								content: `⚠ Run failed: ${msg.message}`,
								timestamp: new Date().toISOString(),
							},
						]);
					}
					break;
			}
		});

		return () => {
			unsubscribe();
			send({ type: "unwatch", sessionId });
		};
	}, [connected, sessionId, send, addHandler]);

	// Keep a following reader pinned to the live edge as content lands. With no
	// conversation the pane holds the board instead, which is read top-down —
	// pinning it to the bottom would open the Desk halfway down your own work.
	useEffect(() => {
		if (!hasContent) return;
		const el = bodyRef.current;
		if (el && followRef.current) el.scrollTop = el.scrollHeight;
	}, [entries, streamText, pending, hasContent]);

	function onScroll() {
		const el = bodyRef.current;
		if (!el) return;
		followRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
	}

	// Returns true when the message was consumed, so the (uncontrolled) Composer
	// clears its draft; false keeps it for a retry — same contract as the
	// session view.
	function handleSend(raw: string, opts?: { steer?: boolean }): boolean {
		const content = raw.trim();
		if (!connected) return false;
		if (!content && images.length === 0 && files.length === 0) return false;
		// Slash commands (/model, /loop, /goal, …) are handled by the main
		// session's command system, which this compact surface deliberately
		// doesn't wire up. Sent as a plain prompt they produce no turn, so the
		// optimistic "sending…" bubble below would never reconcile and stick
		// forever. Surface an inline hint instead — the input isn't silently
		// eaten, and no bubble is left dangling.
		if (content.startsWith("/")) {
			setEntries((prev) => [
				...prev,
				{
					id: crypto.randomUUID(),
					type: "system",
					content:
						"Slash commands aren't supported in the Desk. Run them from a session.",
					timestamp: new Date().toISOString(),
				},
			]);
			return true;
		}
		// Live voice call: inject the typed message into it (the call mirrors its
		// transcript back, so no optimistic bubble — the entry lands via append).
		if (content && voiceSend?.(content)) {
			followRef.current = true;
			return true;
		}
		// Prefer the staged disk path (HTTP upload); fall back to inline dataUrl.
		const filePayload = files.map((f) =>
			f.path
				? { name: f.name, path: f.path }
				: { name: f.name, dataUrl: f.dataUrl },
		);
		send({
			type: "prompt",
			sessionId,
			content,
			user: getCurrentUser(),
			effort: effort || "low",
			// Busy sends follow the same two behaviours as a session: plain send
			// queues until the run finishes, ⌘/Ctrl+Enter steers into it.
			...(isRunning
				? { busyMode: opts?.steer ? ("steer" as const) : ("queue" as const) }
				: {}),
			...(images.length ? { images } : {}),
			...(files.length ? { files: filePayload } : {}),
		});
		setPending(content);
		setImages([]);
		setFiles([]);
		followRef.current = true;
		return true;
	}

	// Model and effort are settings of the Desk session, so the switch routes
	// through the /model command (persisted + broadcast server-side), exactly
	// as SessionViewer and the catch-up deck do.
	function handleModelChange(next: string) {
		const target = next || defaultModel;
		if (!target || target === (model || defaultModel)) return;
		setModel(next);
		send({
			type: "prompt",
			sessionId,
			content: `/model ${target}`,
			user: getCurrentUser(),
		});
	}

	// "Continue" under a failed run's notice. An ordinary prompt, like anything
	// else typed here — no optimistic bubble, because the press is the button's
	// own feedback and the turn lands as a normal entry.
	function continueAfterFailure() {
		send({
			type: "prompt",
			sessionId,
			content: CONTINUE_AFTER_FAILURE_PROMPT,
			user: getCurrentUser(),
			effort: effort || "low",
		});
		followRef.current = true;
	}


	return (
		// `--desk-under` is what the composer takes back off the conversation: the
		// input box rides up over the last rows in normal flow, so they scroll
		// under it instead of stopping above it. The session view does the same
		// (VIEWER_INPUT), fading the overlap into its own opaque fill — the Desk
		// sits on the palette's glass, so the rows dissolve into a mask instead.
		<div className="relative flex h-full min-h-0 flex-col [--desk-under:18px]">
			<div
				className={cn(
					"min-h-0 flex-1 overflow-y-auto px-3 pt-2",
					"pb-[calc(var(--desk-under)_+_12px)]",
					"[-webkit-mask-image:linear-gradient(to_bottom,#000_calc(100%_-_var(--desk-under)),transparent_100%)]",
					"[mask-image:linear-gradient(to_bottom,#000_calc(100%_-_var(--desk-under)),transparent_100%)]",
				)}
				ref={bodyRef}
				onScroll={onScroll}
			>
				{!hasContent ? (
					<>
						{earlierCount > 0 && (
							<button
								type="button"
								className="mx-auto mb-1 block rounded-control px-2 py-1 text-label font-medium text-faint hover:bg-hover hover:text-dim"
								onClick={() => setShowEarlier(true)}
							>
								Show earlier conversation
							</button>
						)}
						{/* Nothing else. A Desk with no conversation is its composer
						    and the starter pills above it — a list of your open work
						    here was a second inbox to read past on the way to typing,
						    and the sessions list already owns that job. */}
					</>
				) : (
					<>
						{/* sessionId is load-bearing, not decoration: the server
						    wire-clamps big entries and replaces inline images with
						    os-blob: markers, and both are resolved through routes
						    keyed on the session. Without it a Desk tool call with a
						    large result is truncated with a "Show full message"
						    button that can't fetch, and any screenshot a tool
						    returned renders as a broken image. */}
						<TranscriptBlocks
							entries={visibleEntries}
							live={isRunning}
							sessionId={sessionId}
							onOpenSubagent={onOpenSubagent}
							// The Desk shows the same failure pill as a session, so it
							// offers the same one press out of it. Gated like handleSend.
							onContinue={
								connected && !isRunning ? continueAfterFailure : undefined
							}
						/>
						{streamText && (
							<div className={cn(msgRow, msgStreamingRow)}>
								<div
									className={cn(msgBodyStreaming, "markdown")}
									dangerouslySetInnerHTML={{ __html: renderMarkdown(streamText) }}
								/>
							</div>
						)}
						{/* Optimistic echo of the just-sent message — rendered as a normal
						    sent bubble (not the dimmed "sending" look) so it reads as
						    delivered the instant Enter lands; reconciles away when the
						    real user entry arrives. */}
						{pending && (
							<div className={cn(msgRow, msgOwnTurn, "msg-user")}>
								<div className={msgBubbleUser}>{pending}</div>
							</div>
						)}
					</>
				)}
			</div>

			<div className="relative z-[1] mt-[calc(-1*var(--desk-under))] shrink-0 px-2 pb-2">
				{/* Starter pills stay attached to the composer and disappear once the
				    conversation starts. Picking one fills the draft rather than
				    sending: some name actions with side effects, and all of them are
				    openings you'd want to finish in your own words. */}
				{!hasContent && !!suggestions?.length && (
					<div className="flex gap-1.5 overflow-x-auto px-1 pb-1.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
						{suggestions.map((s) => (
							<button
								type="button"
								key={s}
								className="shrink-0 whitespace-nowrap rounded-full bg-hover px-3 py-1.5 text-label font-medium text-dim hover:bg-active hover:text-fg"
								onClick={() => {
									setPrefill((current) => ({
										seq: (current?.seq ?? 0) + 1,
										text: s,
										replace: true,
									}));
									textareaRef.current?.focus();
								}}
							>
								{s}
							</button>
						))}
					</div>
				)}

				{/* The session composer itself, so the Desk gets what a session gets:
				    attachments, dictation, @-mentions, the model and effort pill, and
				    the same send/queue/steer gestures. */}
				<Composer
					draftKey={`desk:${sessionId}`}
					onSend={handleSend}
					placeholder={
						connected ? placeholder || "Ask your Desk…" : "Not connected"
					}
					disabled={!connected}
					sendDisabled={(text) =>
						!text.trim() && images.length === 0 && files.length === 0
					}
					busy={isRunning}
					images={images}
					onImagesChange={setImages}
					files={files}
					onFilesChange={setFiles}
					prefill={prefill}
					models={models}
					defaultModel={defaultModel}
					model={model}
					onModelChange={handleModelChange}
					modelTitle="Model and reasoning effort for your Desk"
					effort={effort}
					onEffortChange={setEffort}
					mentionFetch={(q) => fetchFileMentions(q, sessionId)}
					paletteFetch={(q) =>
						fetchMentionSuggestions(q, sessionId, getCurrentUser())
					}
					autoFocus={autoFocus}
					textareaRef={textareaRef}
				/>
			</div>
		</div>
	);
}
