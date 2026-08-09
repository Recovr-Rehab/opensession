import React, { useEffect, useState } from "react";
import { BASE_PATH } from "../lib/base";
import { getCurrentUser } from "./UserPicker";
import { useWebSocket } from "../hooks/useWebSocket";
import { Button } from "../ui/button";
import { IconDesk } from "./icons";
import { cn } from "../ui/cn";
import type { DeskState, DeskWorkItem } from "../lib/desk-state-types";

/**
 * The Desk's default screen: the work you handed off, not a list of things you
 * meant to do. Three buckets, each rendered only when it has something in it —
 * so a quiet world gives a quiet screen rather than a wall of zeros.
 *
 * It drains by itself: reading a finished session clears it, answering a
 * question unblocks it, a run ending moves it along. That self-draining is the
 * whole argument for this over a todo list, which only ever grows.
 *
 * Shown as DeskConversation's empty state — the moment you say anything, the
 * conversation takes the surface back.
 */

const POLL_MS = 10000;

function Section({
	label,
	tone,
	count,
	children,
}: {
	label: string;
	tone: "review" | "waiting" | "running" | "todo";
	count?: number;
	children: React.ReactNode;
}) {
	const dot =
		tone === "waiting"
			? "bg-yellow"
			: tone === "running"
				? "bg-green"
				: tone === "review"
					? "bg-dim"
					: "";
	return (
		<div className="mt-4 first:mt-1">
			<div className="flex items-center gap-2 px-0.5 pb-1.5">
				{dot && <span className={cn("size-[7px] shrink-0 rounded-full", dot)} />}
				<span className="text-[11px] font-semibold uppercase tracking-wider text-faint">
					{label}
				</span>
				{!!count && (
					<span className="text-[11px] font-semibold text-faint">{count}</span>
				)}
			</div>
			{children}
		</div>
	);
}

function prLabel(item: DeskWorkItem): string | undefined {
	const pr = item.pr;
	if (!pr) return undefined;
	const c = pr.checks;
	// No checks at all is not "green" — say nothing rather than imply a pass.
	const total = c ? c.passed + c.failed + c.pending : 0;
	const health =
		!c || !total
			? ""
			: c.failed > 0
				? " · checks failing"
				: c.pending > 0
					? " · checks pending"
					: " · checks green";
	return `PR #${pr.number}${health}`;
}

function Card({
	item,
	sub,
	children,
	onOpen,
}: {
	item: DeskWorkItem;
	sub?: string;
	children?: React.ReactNode;
	onOpen: () => void;
}) {
	return (
		<div className="mb-1.5 rounded-lg bg-surface p-3">
			<button
				type="button"
				onClick={onOpen}
				className="flex w-full items-start gap-2 text-left"
			>
				<span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-fg">
					{item.title}
				</span>
				{item.repo && (
					<span className="shrink-0 text-[11px] font-medium text-faint">
						{item.repo}
					</span>
				)}
			</button>
			{sub && (
				<div className="mt-1 line-clamp-2 text-[12px] font-medium text-dim">
					{sub}
				</div>
			)}
			{children}
		</div>
	);
}

export function DeskBoard({
	onOpenSession,
}: {
	onOpenSession: (sessionId: string) => void;
}) {
	const user = getCurrentUser();
	const { send } = useWebSocket();
	const [state, setState] = useState<DeskState | null>(null);
	const [failed, setFailed] = useState(false);
	// Sessions answered from here, hidden immediately — the poll is up to 10s
	// behind and a question that stays put after you answer it reads as broken.
	const [answered, setAnswered] = useState<Record<string, true>>({});

	useEffect(() => {
		let cancelled = false;
		async function load() {
			try {
				const res = await fetch(
					`${BASE_PATH}/api/desk/state?user=${encodeURIComponent(user)}`,
				);
				if (!res.ok) throw new Error(`HTTP ${res.status}`);
				const data = (await res.json()) as DeskState;
				if (!cancelled) {
					setState(data);
					setFailed(false);
				}
			} catch {
				if (!cancelled && !state) setFailed(true);
			}
		}
		void load();
		const t = window.setInterval(load, POLL_MS);
		return () => {
			cancelled = true;
			window.clearInterval(t);
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [user]);

	if (failed)
		return (
			<div className="px-4 py-8 text-center text-[13px] font-medium text-dim">
				Couldn't load your Desk.
			</div>
		);
	if (!state) return null;

	const waiting = state.waiting.filter((w) => !answered[w.sessionId]);
	const quiet =
		!waiting.length && !state.running.length && !state.review.length;

	function answer(item: DeskWorkItem, option: string) {
		const q = item.question;
		if (!q) return;
		setAnswered((prev) => ({ ...prev, [item.sessionId]: true }));
		if (q.kind === "human") {
			// An ask_human addressed to this user — resolved over REST, which
			// also carries it back to whichever Slack thread posed it.
			void fetch(
				`${BASE_PATH}/api/human-asks/${encodeURIComponent(q.questionId)}/answer`,
				{
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ answer: option, user }),
				},
			);
			return;
		}
		send({
			type: "answer_question",
			sessionId: item.sessionId,
			questionId: q.questionId,
			// Keyed by the question text, matching AskCard's answer map.
			answers: { [q.text]: option },
		});
	}

	return (
		<div className="px-1 pb-2 text-left">
			{quiet && !state.todos.length ? (
				<div className="flex flex-col items-center gap-1.5 px-8 py-16 text-center">
					<IconDesk size={30} className="mb-1 text-faint opacity-50" />
					<div className="text-[13px] font-semibold text-dim">All clear.</div>
					<div className="text-[12px] font-medium leading-relaxed text-faint">
						Nothing running, nothing waiting on you. Hand me something and I'll
						get it started.
					</div>
				</div>
			) : (
				<>
					{!!waiting.length && (
						<Section label="Waiting on you" tone="waiting">
							{waiting.map((item) => (
								<Card
									key={item.sessionId}
									item={item}
									sub={item.question?.text}
									onOpen={() => onOpenSession(item.sessionId)}
								>
									<div className="mt-2 flex flex-wrap gap-1.5">
										{item.question?.options.map((opt, i) => (
											<Button
												key={opt}
												size="xs"
												variant={i === 0 ? "primary" : "default"}
												onClick={() => answer(item, opt)}
											>
												{opt}
											</Button>
										))}
										<Button
											size="xs"
											variant="ghost"
											onClick={() => onOpenSession(item.sessionId)}
										>
											Open
										</Button>
									</div>
								</Card>
							))}
						</Section>
					)}

					{!!state.review.length && (
						<Section label="Needs your eyes" tone="review">
							{state.review.map((item) => (
								<Card
									key={item.sessionId}
									item={item}
									// Only say something worth saying: "finished, unread" is
									// what the section header already means, and repeating it
									// under every card is filler.
									sub={prLabel(item)}
									onOpen={() => onOpenSession(item.sessionId)}
								/>
							))}
						</Section>
					)}

					{!!state.running.length && (
						<Section
							label="Running"
							tone="running"
							count={state.running.length + state.more.running}
						>
							{state.running.map((item) => (
								<button
									type="button"
									key={item.sessionId}
									onClick={() => onOpenSession(item.sessionId)}
									className="flex w-full items-center gap-2.5 border-b border-line/60 px-0.5 py-2.5 text-left last:border-0 hover:bg-hover"
								>
									<span className="size-[13px] shrink-0 animate-spin rounded-full border-2 border-line border-t-green" />
									<span className="min-w-0 flex-1 truncate text-[13px] font-medium text-fg">
										{item.title}
									</span>
									{item.repo && (
										<span className="shrink-0 text-[11px] font-medium text-faint">
											{item.repo}
										</span>
									)}
								</button>
							))}
						</Section>
					)}

					{quiet && (
						<div className="mt-1 px-0.5 py-2 text-[12px] font-medium text-faint">
							Nothing running, nothing waiting on you.
						</div>
					)}

					{!!state.todos.length && (
						<Section
							label="On your list"
							tone="todo"
							count={state.todos.length + state.more.todos}
						>
							{state.todos.map((t) => (
								<div
									key={t.id}
									className="border-b border-line/60 px-0.5 py-2.5 text-[13px] font-medium text-dim last:border-0"
								>
									{t.text}
									{t.due && (
										<span className="ml-1.5 text-[11px] text-faint">
											due {t.due}
										</span>
									)}
								</div>
							))}
						</Section>
					)}
				</>
			)}
		</div>
	);
}
