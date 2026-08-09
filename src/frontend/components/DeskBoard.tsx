import React, { useEffect, useState } from "react";
import { BASE_PATH } from "../lib/base";
import { getCurrentUser } from "./UserPicker";
import type { DeskState, DeskWorkItem } from "../lib/desk-state-types";

/**
 * The Desk's default screen: one flat list of what needs you, and nothing
 * else.
 *
 * It was a sectioned board with cards, option chips, counts and a todo list;
 * that was too much to read on a surface you summon for a few seconds. What
 * survives is the only question worth answering here — what should I look at
 * next — as one line per thing, most urgent first. Everything else (which
 * repo, which PR, how many checks, what it's asking) lives one tap away in
 * the session, which is where you'd act on it anyway.
 *
 * When nothing needs you it renders NOTHING: the Desk is then just its
 * composer, which is the right shape for "hand me something".
 */

const POLL_MS = 10000;
/** A glance, not an inventory. */
const MAX_ROWS = 6;

interface Row {
	sessionId: string;
	title: string;
	/** Why it's here, in one or two words. */
	note: string;
}

function rows(state: DeskState): Row[] {
	// Blocked on you first — that's work stopped for want of an answer —
	// then results you haven't read, then what's still going.
	return [
		...state.waiting.map((w) => ({
			sessionId: w.sessionId,
			title: w.title,
			note: "needs an answer",
		})),
		...state.review.map((r: DeskWorkItem) => ({
			sessionId: r.sessionId,
			title: r.title,
			note: r.pr ? `PR #${r.pr.number}` : "done",
		})),
		...state.running.map((r) => ({
			sessionId: r.sessionId,
			title: r.title,
			note: "running",
		})),
	].slice(0, MAX_ROWS);
}

export function DeskBoard({
	onOpenSession,
}: {
	onOpenSession: (sessionId: string) => void;
}) {
	const user = getCurrentUser();
	const [state, setState] = useState<DeskState | null>(null);

	useEffect(() => {
		let cancelled = false;
		async function load() {
			try {
				const res = await fetch(
					`${BASE_PATH}/api/desk/state?user=${encodeURIComponent(user)}`,
				);
				if (!res.ok) return;
				const data = (await res.json()) as DeskState;
				if (!cancelled) setState(data);
			} catch {
				// A board that can't load says nothing rather than an error the
				// user can do nothing about — the composer still works.
			}
		}
		void load();
		const t = window.setInterval(load, POLL_MS);
		return () => {
			cancelled = true;
			window.clearInterval(t);
		};
	}, [user]);

	const list = state ? rows(state) : [];
	if (!list.length) return null;
	// The note tells you how these rows differ, so it earns its place only
	// when they do — six lines all reading "needs an answer" is decoration.
	const mixed = new Set(list.map((r) => r.note)).size > 1;
	return (
		<div className="px-1 pt-1 text-left">
			{list.map((row) => (
				<button
					type="button"
					key={row.sessionId}
					onClick={() => onOpenSession(row.sessionId)}
					className="flex w-full items-baseline gap-3 rounded-md px-2 py-2.5 text-left hover:bg-hover"
				>
					{/* Gray, not full-strength ink: this list is something you scan
					    on the way to the composer, not the page's headline. */}
					<span className="min-w-0 flex-1 truncate text-[13px] font-medium text-dim">
						{row.title}
					</span>
					{mixed && (
						<span className="shrink-0 text-[11px] font-medium text-faint">
							{row.note}
						</span>
					)}
				</button>
			))}
		</div>
	);
}
