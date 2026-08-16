// The Canvas tool's card model: one tldraw shape per session, rendered as a
// live card (header + transcript tail + composer). The shape itself stores
// only geometry and the session id. everything a card SHOWS comes from the
// polled session list via CanvasDataContext, so cards stay fresh without
// rewriting shapes, and a stale persisted shape simply renders "gone".
import { createContext, useEffect, useState } from "react";
import {
	HTMLContainer,
	Rectangle2d,
	ShapeUtil,
	T,
	resizeBox,
	type RecordProps,
	type TLResizeInfo,
	type TLShape,
} from "tldraw";
import { CanvasCard } from "../components/CanvasCard";
import { fetchTranscript } from "./api";
import type { TranscriptEntry, UnifiedSession } from "./types";

// tldraw v5 registers custom shape types by augmenting this map; the shape
// type is then derived from TLShape rather than hand-built with TLBaseShape.
declare module "tldraw" {
	export interface TLGlobalShapePropsMap {
		"session-card": { w: number; h: number; sessionId: string };
	}
}

export type SessionCardShape = TLShape<"session-card">;

export const CARD_W = 380;
export const CARD_H = 440;
export const CARD_GAP = 56;
export const CANVAS_COLS = 5;
/** How many sessions get a card. The canvas is a working set, not an archive. */
export const CARD_LIMIT = 30;

/** Default grid position for the i-th card (row-major, activity order). */
export function cardSlot(i: number): { x: number; y: number } {
	return {
		x: (i % CANVAS_COLS) * (CARD_W + CARD_GAP),
		y: Math.floor(i / CANVAS_COLS) * (CARD_H + CARD_GAP),
	};
}

/** Which grid slot a card currently sits nearest: for filling free slots. */
export function slotKey(x: number, y: number): string {
	return `${Math.round(x / (CARD_W + CARD_GAP))}:${Math.round(y / (CARD_H + CARD_GAP))}`;
}

/**
 * The canvas working set: the sidebar inbox's spirit. sessions waiting for
 * your input first, then most recent activity. Desk sessions, agent-spawned
 * helpers, archived rows and unclaimed automation runs stay off the board,
 * same as the sidebar's own rules.
 */
export function canvasSessions(
	sessions: UnifiedSession[],
	isClaimed: (s: UnifiedSession) => boolean,
): UnifiedSession[] {
	return sessions
		.filter(
			(s) =>
				!s.archived &&
				!s.desk &&
				!s.spawnedBy &&
				!(s.automation && !isClaimed(s)),
		)
		.sort((a, b) => {
			const rank = Number(!!b.waitingForInput) - Number(!!a.waitingForInput);
			if (rank !== 0) return rank;
			return (b.lastActivity || "").localeCompare(a.lastActivity || "");
		})
		.slice(0, CARD_LIMIT);
}

export interface CanvasData {
	sessions: Map<string, UnifiedSession>;
	onOpenSession: (id: string) => void;
	compactAtLowZoom: boolean;
}

export const CanvasDataContext = createContext<CanvasData>({
	sessions: new Map(),
	onOpenSession: () => {},
	compactAtLowZoom: false,
});

// ── Transcript tails ─────────────────────────────────────────────────────────
// Cards fetch their last few conversation entries lazily (tldraw culls
// offscreen shapes, so a card mounts only when visible). The cache is keyed on
// the session's lastActivity: panning back over a card costs nothing until the
// session actually moves.
const tailCache = new Map<
	string,
	{ activity: string; entries: TranscriptEntry[] }
>();

/** Entries a card shows: the conversation, not the tool plumbing. */
function conversationTail(all: TranscriptEntry[]): TranscriptEntry[] {
	return all
		.filter(
			(e) =>
				(e.type === "user" || e.type === "assistant") &&
				typeof e.content === "string" &&
				e.content.trim().length > 0,
		)
		.slice(-10);
}

export function useTranscriptTail(sessionId: string, activity: string) {
	const cached = tailCache.get(sessionId);
	const [entries, setEntries] = useState<TranscriptEntry[] | null>(
		cached ? cached.entries : null,
	);
	const [failed, setFailed] = useState(false);
	useEffect(() => {
		const hit = tailCache.get(sessionId);
		if (hit && hit.activity === activity) {
			setEntries(hit.entries);
			return;
		}
		let dead = false;
		fetchTranscript(sessionId, 80)
			.then((all: TranscriptEntry[]) => {
				if (dead) return;
				const tail = conversationTail(Array.isArray(all) ? all : []);
				tailCache.set(sessionId, { activity, entries: tail });
				setEntries(tail);
				setFailed(false);
			})
			.catch(() => {
				if (!dead) setFailed(true);
			});
		return () => {
			dead = true;
		};
	}, [sessionId, activity]);
	return { entries, failed };
}

/** Show a just-sent message immediately; the next tail fetch confirms it. */
export function appendLocalEntry(
	sessionId: string,
	activity: string,
	entry: TranscriptEntry,
): TranscriptEntry[] {
	const hit = tailCache.get(sessionId);
	const entries = [...(hit?.entries ?? []), entry].slice(-10);
	tailCache.set(sessionId, { activity: hit?.activity ?? activity, entries });
	return entries;
}

export class SessionCardUtil extends ShapeUtil<SessionCardShape> {
	static override type = "session-card" as const;
	static override props: RecordProps<SessionCardShape> = {
		w: T.number,
		h: T.number,
		sessionId: T.string,
	};

	override getDefaultProps(): SessionCardShape["props"] {
		return { w: CARD_W, h: CARD_H, sessionId: "" };
	}

	override canEdit() {
		return false;
	}

	override canResize() {
		return true;
	}

	override hideRotateHandle() {
		return true;
	}

	override getGeometry(shape: SessionCardShape) {
		return new Rectangle2d({
			width: shape.props.w,
			height: shape.props.h,
			isFilled: true,
		});
	}

	override onResize(
		shape: SessionCardShape,
		info: TLResizeInfo<SessionCardShape>,
	) {
		return resizeBox(shape, info, { minWidth: 300, minHeight: 240 });
	}

	override component(shape: SessionCardShape) {
		return (
			<HTMLContainer
				style={{ pointerEvents: "all" }}
				// Touching a card raises it: overlapping cards otherwise keep
				// their creation order, and a card stuck underneath a neighbour
				// has an unclickable composer.
				onPointerDown={() => this.editor.bringToFront([shape.id])}
			>
				<CanvasCard sessionId={shape.props.sessionId} />
			</HTMLContainer>
		);
	}

	override getIndicatorPath(shape: SessionCardShape) {
		const path = new Path2D();
		path.roundRect(0, 0, shape.props.w, shape.props.h, 18);
		return path;
	}
}

export const CANVAS_SHAPE_UTILS = [SessionCardUtil];
