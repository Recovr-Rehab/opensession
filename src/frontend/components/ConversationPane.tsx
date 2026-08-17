import React, { useCallback, useEffect, useRef, useState } from "react";
import type { PlainThread } from "../lib/types";
import { fetchPlainThreadById, startPlainTriageApi } from "../lib/api";
import { useIsPhone } from "../hooks/useIsPhone";
import { Button } from "../ui/button";
import { InlineAlert, LoadingState } from "../ui/state";
import { plainStatusClass } from "../lib/plain-status";
import { SUPPORT_COLUMN_BAR } from "../lib/support-classes";
import {
	PlainEntryRow,
	PlainReplyBox,
	PlainThreadActions,
	PlainWaitingBanner,
	plainThreadUrl,
	STATUS_LABEL,
} from "./PlainThreadPanel";
import { cn } from "../ui/cn";

interface Props {
	/** The Plain thread id — the pane's key. */
	threadId: string;
	/** Navigate into a session (the triage button resolves to one over HTTP). */
	onOpenSession: (id: string) => void;
	/** Hide the "Triage this ticket" affordance (e.g. a triage session already exists). */
	hideTriage?: boolean;
	className?: string;
	/** Put the ticket's identity — subject, status, customer, the Plain link —
	 *  in a top bar of the pane's own instead of at the top of the thread. For
	 *  the Support inbox, where the pane has that bar to itself. */
	headerInBar?: boolean;
}

/**
 * The support-ticket Conversation surface: the full thread straight from Plain
 * (no LLM involved) with ticket admin (status/priority/assign/labels/spam), a
 * customer-reply / internal-note box, and the one-click triage affordance.
 * Rendered as a workspace view tab (the Conversation tab of ticket-backed
 * workspaces) and by the legacy session-less /support preview. Polls at 20s —
 * there's no live push for Plain.
 */
export function ConversationPane({
	threadId,
	onOpenSession,
	hideTriage,
	className,
	headerInBar,
}: Props) {
	const [thread, setThread] = useState<PlainThread | null>(null);
	const isPhone = useIsPhone();
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [triaging, setTriaging] = useState(false);
	const [triageError, setTriageError] = useState<string | null>(null);
	const aliveRef = useRef(true);

	useEffect(() => {
		aliveRef.current = true;
		return () => {
			aliveRef.current = false;
		};
	}, []);

	// Load on mount / thread change, then poll — the customer can reply while
	// the ticket is being read and there's no live push for Plain.
	const load = useCallback(() => {
		return fetchPlainThreadById(threadId)
			.then((t) => {
				if (!aliveRef.current) return;
				setThread(t);
				setError(null);
			})
			.catch((e) => {
				if (aliveRef.current) setError(e?.message || "Failed to load");
			})
			.finally(() => {
				if (aliveRef.current) setLoading(false);
			});
	}, [threadId]);
	useEffect(() => {
		setLoading(true);
		setThread(null);
		setError(null);
		load();
		const poll = setInterval(() => {
			if (document.visibilityState === "hidden") return;
			load();
		}, 20000);
		return () => clearInterval(poll);
	}, [load]);

	// The triage automation reuses a live session for this thread when one
	// exists, else boots a fresh run — that takes tens of seconds, so keep the
	// button in a visible in-progress state the whole way.
	async function handleTriage() {
		if (triaging) return;
		setTriaging(true);
		setTriageError(null);
		try {
			const sessionId = await startPlainTriageApi(threadId);
			if (aliveRef.current) onOpenSession(sessionId);
		} catch (e: any) {
			if (aliveRef.current)
				setTriageError(e?.message || "Failed to start the triage run.");
		} finally {
			if (aliveRef.current) setTriaging(false);
		}
	}

	const status = thread?.status;
	const customerName = thread?.customer?.name || "";
	const customerEmail = thread?.customer?.email || "";
	const customerLabel = customerName || customerEmail || "Unknown customer";
	const plainUrl = plainThreadUrl(threadId);
	// Not on a phone: there the bar is where the app's own back control floats,
	// so the ticket keeps its header at the top of the thread.
	const headerInTopBar = !!headerInBar && !isPhone;

	return (
		<div className={cn("flex min-h-0 flex-1 flex-col", className)}>
			<div className="min-h-0 flex-1 overflow-y-auto">
			{headerInTopBar && (
				<div className={SUPPORT_COLUMN_BAR}>
					{/* Empty until the thread lands. The bar keeps its height, so
					    nothing below it moves when the words arrive. */}
					{thread && (
						<>
							<div className="flex min-w-0 flex-1 flex-col justify-center">
								<div className="flex min-w-0 items-center gap-2">
									<h2 className="m-0 truncate text-item-title font-semibold text-fg">
										{thread.title || "No subject"}
									</h2>
									{status && (
										<span className={plainStatusClass(status)}>
											{STATUS_LABEL[status] || status}
										</span>
									)}
								</div>
								<div className="flex min-w-0 items-center gap-1.5 text-meta">
									<span className="truncate text-dim">{customerLabel}</span>
									{customerName && customerEmail && (
										<>
											<span className="text-faint">·</span>
											<span className="truncate text-faint">
												{customerEmail}
											</span>
										</>
									)}
								</div>
							</div>
							{plainUrl && (
								<a
									className="shrink-0 whitespace-nowrap text-meta font-semibold text-link no-underline hover:underline"
									href={plainUrl}
									target="_blank"
									rel="noreferrer"
									title="Open this thread in Plain"
								>
									Open in Plain ↗
								</a>
							)}
						</>
					)}
				</div>
			)}
				<div
					className={cn(
						"mx-auto w-full max-w-[760px] px-5 pb-5",
						// With the identity in the bar, the first block's own top
						// margin is the whole gap under it.
						headerInTopBar ? "pt-1" : "pt-6",
					)}
				>
					{loading && !thread ? (
						<LoadingState>Loading ticket…</LoadingState>
					) : error && !thread ? (
						<InlineAlert>Couldn't load this Plain thread: {error}</InlineAlert>
					) : (
						<>
							{!headerInTopBar && (
								<>
									<div className="flex items-center gap-2.5 min-w-0">
										<span
											className="truncate text-item-title font-semibold text-fg"
											title={customerEmail}
										>
											{customerLabel}
										</span>
										{customerName && customerEmail && (
											<span className="text-faint text-label truncate">
												{customerEmail}
											</span>
										)}
										{status && (
											<span className={plainStatusClass(status)}>
												{STATUS_LABEL[status] || status}
											</span>
										)}
									<a
										className="shrink-0 whitespace-nowrap text-meta font-semibold text-link no-underline hover:underline ml-auto"
										href={plainUrl}
										target="_blank"
										rel="noreferrer"
										title="Open this thread in Plain"
									>
										Open in Plain ↗
									</a>
									</div>
									{thread?.title && (
										<div className="mt-2 text-section-title font-semibold text-fg">
											{thread.title}
										</div>
									)}
								</>
							)}

							{/* Is anyone still owed an answer? Plain leads with this;
						    so should we. */}
							{thread && (
								<PlainWaitingBanner thread={thread} className="mt-3" />
							)}

							{/* One-click ticket admin, straight from here: status,
						    priority, spam — no need to jump into Plain. */}
							{thread && (
								<PlainThreadActions
									threadId={threadId}
									thread={thread}
									onChanged={load}
									className="mt-3"
								/>
							)}

							{/* The "do you want to triage this?" affordance: one click runs
						    the Plain triage automation and lands in its session. */}
							{!hideTriage && (
								<div className="flex items-center gap-3 flex-wrap mt-4 p-3 rounded-lg border border-line bg-panel">
									<div className="min-w-0 flex-1">
										<div className="text-item-title font-semibold text-fg">
											Triage this ticket?
										</div>
										<div className="text-dim text-label mt-0.5">
											Runs the Plain triage automation: investigates, posts an
											internal note, and can open a PR for review.
										</div>
									</div>
									<Button
										variant="primary"
										className="shrink-0 text-control-label"
										onClick={handleTriage}
										disabled={triaging}
									>
										{triaging
											? "Starting triage… (~30s)"
											: "Triage this ticket"}
									</Button>
									{triageError && (
										<div className="basis-full text-red text-label">
											{triageError}
										</div>
									)}
								</div>
							)}

							<div className="flex flex-col gap-3 mt-5">
								{thread && thread.entries.length === 0 ? (
									<div className="mt-5 text-center text-label text-faint">
										No messages in this thread yet.
									</div>
								) : (
									thread?.entries.map((e) => (
										<PlainEntryRow key={e.id} entry={e} threadId={threadId} />
									))
								)}
							</div>
						</>
					)}
				</div>
			</div>

			{/* Keep the customer reply available while the ticket scrolls. */}
			{thread && (
				<div className="mx-auto w-full max-w-[760px] shrink-0 px-5 pb-5">
					<PlainReplyBox
						key={threadId}
						threadId={threadId}
						customerName={
							thread.customer?.name || thread.customer?.email || null
						}
						onSent={load}
					/>
				</div>
			)}
		</div>
	);
}
