// One session as a card on the Canvas tool. The card is live: header state
// and ordering come from the polled session list, the transcript tail is
// fetched lazily (and re-fetched when the session's lastActivity moves), and
// the composer delivers through the same REST prompt route as the main
// composer. Pointer events on interactive regions stop propagating so tldraw
// drags the card only from its header and edges.
import { useContext, useEffect, useRef, useState } from "react";
import {
	appendLocalEntry,
	CanvasDataContext,
	useTranscriptTail,
} from "../lib/canvas-cards";
import { deliverSessionPrompt } from "../lib/api";
import { compactAge } from "../lib/pr-rows";
import { getReads, isUnread, onReadsChanged } from "../lib/reads";
import { mineStatus } from "../lib/sidebar-lanes";
import { MINE_STATUS_META } from "../lib/sidebar-types";
import type { TranscriptEntry, UnifiedSession } from "../lib/types";
import { Button } from "../ui/button";
import { Textarea } from "../ui/input";
import { getCurrentUser } from "./UserPicker";
import { IconArrowUp, IconExpand } from "./icons";

function stop(e: { stopPropagation: () => void }) {
	e.stopPropagation();
}

/** Cards show a bounded snippet per entry: the session view has the rest. */
function clip(text: string, max = 600): string {
	const t = text.trim();
	return t.length > max ? `${t.slice(0, max)}…` : t;
}

function statusColor(session: UnifiedSession): string {
	if (session.isRunning) return "var(--yellow)";
	const meta = MINE_STATUS_META.find((m) => m.key === mineStatus(session));
	return meta?.dotColor ?? "var(--text-faint)";
}

export function CanvasCard({ sessionId }: { sessionId: string }) {
	const { sessions, onOpenSession } = useContext(CanvasDataContext);
	const session = sessions.get(sessionId);
	const activity = session?.lastActivity || "";
	const { entries, failed } = useTranscriptTail(sessionId, activity);
	const [local, setLocal] = useState<TranscriptEntry[] | null>(null);
	const [text, setText] = useState("");
	const [receipt, setReceipt] = useState<string | null>(null);
	const [sending, setSending] = useState(false);
	const [reads, setReads] = useState(getReads);
	const scrollerRef = useRef<HTMLDivElement | null>(null);

	useEffect(() => onReadsChanged(() => setReads(getReads())), []);

	// tldraw's wheel handler is a native listener on an ancestor, so a React
	// onWheel fires too late to keep it from zooming. Stop the event at the
	// scroller itself.
	useEffect(() => {
		const el = scrollerRef.current;
		if (!el) return;
		const stopWheel = (e: WheelEvent) => e.stopPropagation();
		el.addEventListener("wheel", stopWheel, { passive: true });
		return () => el.removeEventListener("wheel", stopWheel);
	}, []);

	const shown = local ?? entries;
	// Follow the tail: the newest message is the card's reason to exist.
	useEffect(() => {
		const el = scrollerRef.current;
		if (el) el.scrollTop = el.scrollHeight;
	}, [shown]);
	// A fresh server tail replaces the optimistic local one.
	useEffect(() => {
		setLocal(null);
	}, [entries]);

	if (!session) {
		return (
			<div className="flex h-full w-full items-center justify-center rounded-xl bg-panel text-label text-faint shadow-lg">
				Session no longer listed
			</div>
		);
	}

	const unread = isUnread(session.id, session.lastActivity, reads);
	const meta = [
		session.repo,
		session.branch,
		session.startedBy,
		session.lastActivity ? compactAge(session.lastActivity) : null,
	].filter(Boolean);

	async function send() {
		const content = text.trim();
		if (!content || sending || !session) return;
		setSending(true);
		try {
			const res = await deliverSessionPrompt(session.id, {
				content,
				user: getCurrentUser(),
				clientId: crypto.randomUUID(),
			});
			setText("");
			setLocal(
				appendLocalEntry(session.id, activity, {
					id: res.clientId || `local-${Date.now()}`,
					type: "user",
					content,
					timestamp: new Date().toISOString(),
					sender: getCurrentUser(),
				} as TranscriptEntry),
			);
			setReceipt(
				res.status === "queued"
					? "Queued for after this run"
					: res.status === "steered"
						? "Steered into the running turn"
						: null,
			);
			setTimeout(() => setReceipt(null), 4000);
		} catch {
			setReceipt("Couldn't send. Try again");
			setTimeout(() => setReceipt(null), 4000);
		} finally {
			setSending(false);
		}
	}

	return (
		<div className="flex h-full w-full flex-col overflow-hidden rounded-xl bg-panel shadow-lg">
			{/* Header: the drag surface. Everything below stops propagation. */}
			<div className="flex cursor-grab items-center gap-2 px-3.5 pb-1 pt-2.5">
				<span
					className={
						session.isRunning
							? "size-2 shrink-0 animate-pulse rounded-full"
							: "size-2 shrink-0 rounded-full"
					}
					style={{ background: statusColor(session) }}
				/>
				<span className="min-w-0 flex-1 truncate text-item-title font-medium text-fg">
					{session.title || "Untitled session"}
				</span>
				{unread && (
					<span
						className="size-2 shrink-0 rounded-full"
						style={{ background: "var(--blue)" }}
						title="New activity"
					/>
				)}
				<Button
					variant="ghost"
					size="sm"
					icon={<IconExpand size={20} dense />}
					aria-label="Open session"
					title="Open session"
					onPointerDown={stop}
					onClick={(e) => {
						e.stopPropagation();
						onOpenSession(session.id);
					}}
				/>
			</div>
			<div className="cursor-grab truncate px-3.5 pb-1.5 text-meta text-dim">
				{meta.join(" · ")}
			</div>
			<div
				ref={scrollerRef}
				className="flex min-h-0 flex-1 select-text flex-col gap-2 overflow-y-auto px-3.5 py-2"
				style={{ touchAction: "pan-y", overscrollBehavior: "contain" }}
				onPointerDown={stop}
			>
				{shown === null ? (
					<div className="text-meta text-faint">
						{failed ? "Couldn't load the transcript" : "Loading…"}
					</div>
				) : shown.length === 0 ? (
					<div className="text-meta text-faint">No messages yet</div>
				) : (
					shown.map((e) =>
						e.type === "user" ? (
							<div
								key={e.id}
								className="max-w-[90%] self-end whitespace-pre-wrap break-words rounded-lg bg-active px-2.5 py-1.5 text-label text-fg"
							>
								{e.sender ? (
									<span className="mr-1 font-medium">{e.sender}</span>
								) : null}
								{clip(e.content, 400)}
							</div>
						) : (
							<div
								key={e.id}
								className="whitespace-pre-wrap break-words text-label leading-normal text-fg"
							>
								{clip(e.content)}
							</div>
						),
					)
				)}
				{session.isRunning && (
					<div className="animate-pulse text-meta text-dim">Working…</div>
				)}
			</div>
			<div className="px-2.5 pb-2.5 pt-1" onPointerDown={stop}>
				{receipt && (
					<div className="px-1 pb-1 text-meta text-dim">{receipt}</div>
				)}
				<div className="flex items-end gap-1.5">
					<Textarea
						size="sm"
						rows={1}
						value={text}
						placeholder={session.isRunning ? "Reply (running)…" : "Reply…"}
						className="max-h-24 flex-1 resize-none"
						style={{ touchAction: "pan-y" }}
						onChange={(e) => setText(e.target.value)}
						onKeyDown={(e) => {
							e.stopPropagation();
							if (e.key === "Enter" && !e.shiftKey) {
								e.preventDefault();
								void send();
							}
						}}
					/>
					<Button
						size="sm"
						icon={<IconArrowUp size={20} dense />}
						aria-label="Send"
						disabled={!text.trim() || sending}
						onClick={() => void send()}
					/>
				</div>
			</div>
		</div>
	);
}
