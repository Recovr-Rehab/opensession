// The Canvas tool: sessions as cards on an infinite tldraw canvas. pan,
// zoom, arrange, and talk to any of them in place. Card geometry is shared and
// persisted by the server's tldraw room; the set of cards tracks the live
// session list, seeded in inbox-activity order and re-sortable any time with
// the toolbar's "Sort by activity".
import { useEffect, useMemo, useRef, useState } from "react";
import { Box, Tldraw, atom, createShapeId, type Editor, type TLShape } from "tldraw";
import {
	CANVAS_SHAPE_UTILS,
	CanvasDataContext,
	canvasSessions,
	cardSlot,
	slotKey,
	CARD_LIMIT,
	type SessionCardShape,
} from "../lib/canvas-cards";
import { useIsPhone } from "../hooks/useIsPhone";
import {
	CANVAS_FILTER_DEFAULT,
	canvasCardMatches,
	canvasFilterActive,
	canvasFilterOptions,
	setCanvasFilter,
	useCanvasFilter,
} from "../lib/canvas-filter";
import { useCanvasStore } from "../lib/canvas-sync";
import { usePeople } from "../lib/people";
import { isClaimed } from "../lib/sidebar-lanes";
import type { UnifiedSession } from "../lib/types";
import { Button } from "../ui/button";
import { EmptyState } from "../ui/state";
import { useCurrentUser } from "./UserPicker";
import { CanvasCollaborators } from "./CanvasCollaborators";
import { CanvasFilters } from "./CanvasFilters";

const TLDRAW_LICENSE_KEY = process.env.TLDRAW_LICENSE_KEY ?? "";
const DESKTOP_CAMERA_OPTIONS = {
	camera: { zoomSteps: [0.05, 0.1, 0.25, 0.5, 1, 2, 4, 8] },
};
// At 2x a card is already wider than a phone. tldraw's 4x and 8x steps
// create backing surfaces large enough for iOS WebKit to terminate the page.
const PHONE_CAMERA_OPTIONS = {
	camera: { zoomSteps: [0.05, 0.1, 0.25, 0.5, 1, 2] },
};

function cardShapes(editor: Editor): SessionCardShape[] {
	return editor
		.getCurrentPageShapes()
		.filter((s) => s.type === "session-card") as SessionCardShape[];
}

/**
 * Frame the cards you can currently see. Not `zoomToFit`, which frames
 * everything on the page: the board is shared, so it can hold a stray drawing
 * or a card someone parked far out, and either one shrinks the cards you asked
 * for into specks in a corner.
 */
function fitCards(editor: Editor) {
	const boxes = cardShapes(editor)
		.filter((card) => !editor.isShapeHidden(card))
		.map((card) => editor.getShapePageBounds(card))
		.filter((box): box is Box => !!box);
	if (!boxes.length) return;
	const bounds = Box.Common(boxes);
	const screen = editor.getViewportScreenBounds();
	const inset = 48;
	const fit = Math.min(
		(screen.width - inset * 2) / bounds.width,
		(screen.height - inset * 2) / bounds.height,
	);
	editor.zoomToBounds(bounds, {
		inset,
		// One card left over is a card, not a poster: stop at full size.
		targetZoom: Math.min(fit, 1),
		animation: { duration: 320 },
	});
}

const CANVAS_COMPONENTS = { InFrontOfTheCanvas: CanvasCollaborators };

interface SessionCanvasProps {
	sessions: UnifiedSession[];
	teamViewing: Array<{ user: string; sessionId: string }>;
	onOpenSession: (id: string) => void;
}

export default function SessionCanvas(props: SessionCanvasProps) {
	if (!TLDRAW_LICENSE_KEY) {
		return (
			<EmptyState className="h-full" title="Canvas needs a tldraw license">
				Set TLDRAW_LICENSE_KEY on this server to use Canvas.
			</EmptyState>
		);
	}
	return <SyncedSessionCanvas {...props} />;
}

function SyncedSessionCanvas({
	sessions,
	teamViewing,
	onOpenSession,
}: SessionCanvasProps) {
	const user = useCurrentUser();
	const people = usePeople();
	const store = useCanvasStore(user, people);
	const isPhone = useIsPhone();
	const [editor, setEditor] = useState<Editor | null>(null);
	const filter = useCanvasFilter();
	const relevant = useMemo(
		() => canvasSessions(sessions, isClaimed),
		[sessions],
	);
	const filterOptions = useMemo(() => canvasFilterOptions(relevant), [relevant]);
	// What the filter leaves on screen. The board itself is never narrowed —
	// see lib/canvas-filter — so this is only ever asked of the cards you can
	// already see, and an empty answer means the filter, not an empty board.
	const shown = useMemo(
		() => relevant.filter((s) => canvasCardMatches(s, filter, user)),
		[relevant, filter, user],
	);
	const data = useMemo(
		() => ({
			sessions: new Map(sessions.map((s) => [s.id, s])),
			teamViewing,
			currentUser: user,
			onOpenSession,
			compactAtLowZoom: isPhone,
		}),
		[sessions, teamViewing, user, onOpenSession, isPhone],
	);

	// Hiding is per viewer, so it cannot be stored on the shapes. tldraw caches
	// getShapeVisibility's answer in a computed, which is what makes an atom
	// (rather than a ref) the thing to read in there: setting it invalidates the
	// cache, so the board re-renders. The function itself is captured when the
	// editor is built and never replaced, so it must read live state.
	const [hidden] = useState(() => atom<Set<string>>("canvas hidden cards", new Set()));
	const hiddenIds = useMemo(() => {
		const ids = new Set<string>();
		if (!canvasFilterActive(filter)) return ids;
		// Every listed session, not only the working set: a card outlives its
		// session's place in the top CARD_LIMIT, and the filter applies to it too.
		for (const s of sessions)
			if (!canvasCardMatches(s, filter, user)) ids.add(s.id);
		return ids;
	}, [sessions, filter, user]);
	const getShapeVisibility = useMemo(
		() => (shape: TLShape) =>
			shape.type === "session-card" &&
			hidden.get().has((shape as SessionCardShape).props.sessionId)
				? ("hidden" as const)
				: ("inherit" as const),
		[hidden],
	);

	// Reframe on what is left, so filtering reads as a camera move rather than
	// as holes punched in the grid. Only when the filter itself changed: the
	// hidden set also moves when a session lands, and that must not pull the
	// camera out from under someone who is arranging cards.
	const lastFilter = useRef(filter);
	useEffect(() => {
		hidden.set(hiddenIds);
		const changed = lastFilter.current !== filter;
		lastFilter.current = filter;
		if (changed && editor) fitCards(editor);
	}, [editor, filter, hidden, hiddenIds]);

	// The app themes via html[data-theme]; tldraw needs to be told.
	useEffect(() => {
		if (!editor) return;
		const apply = () => {
			const theme =
				document.documentElement.dataset.theme ||
				(matchMedia("(prefers-color-scheme: dark)").matches
					? "dark"
					: "light");
			editor.user.updateUserPreferences({
				colorScheme: theme === "dark" ? "dark" : "light",
			});
		};
		apply();
		const mo = new MutationObserver(apply);
		mo.observe(document.documentElement, {
			attributes: true,
			attributeFilter: ["data-theme"],
		});
		return () => mo.disconnect();
	}, [editor]);

	// Reconcile cards with the live list: add cards for new working-set
	// sessions in the first free grid slots, drop cards whose session left the
	// list entirely (archived/deleted). Existing cards never move. the
	// arrangement is the user's.
	useEffect(() => {
		if (!editor) return;
		const existing = cardShapes(editor);
		const listed = new Set(sessions.map((s) => s.id));
		const stale = existing.filter((s) => !listed.has(s.props.sessionId));
		if (stale.length) editor.deleteShapes(stale.map((s) => s.id));
		const live = existing.filter((s) => listed.has(s.props.sessionId));
		const have = new Set(live.map((s) => s.props.sessionId));
		const toAdd = relevant.filter((s) => !have.has(s.id));
		if (toAdd.length) {
			const occupied = new Set(live.map((s) => slotKey(s.x, s.y)));
			const slots: Array<{ x: number; y: number }> = [];
			for (let i = 0; slots.length < toAdd.length && i < CARD_LIMIT * 4; i++) {
				const p = cardSlot(i);
				if (!occupied.has(slotKey(p.x, p.y))) slots.push(p);
			}
			// Reversed so the most recently active card ends up highest in the
			// z-order; creation order is stacking order in tldraw.
			editor.createShapes(
				toAdd
					.map((s, i) => ({
						id: createShapeId(`card-${s.id}`),
						type: "session-card" as const,
						x: slots[i]?.x ?? cardSlot(i).x,
						y: slots[i]?.y ?? cardSlot(i).y,
						props: { sessionId: s.id },
					}))
					.reverse(),
			);
			if (live.length === 0)
				editor.zoomToFit({ animation: { duration: 0 } });
		}
	}, [editor, relevant, sessions]);

	function sortByActivity() {
		if (!editor) return;
		const order = new Map(relevant.map((s, i) => [s.id, i]));
		// A filter alone never moves a card — the arrangement is shared, so it
		// would move on everyone's screen. It can therefore leave the grid full
		// of holes, and this is where you close them: laying the board out is
		// already a deliberate, shared act, so it packs what you are looking at
		// into the first slots and continues with the rest behind it.
		const rank = (card: SessionCardShape) =>
			(hiddenIds.has(card.props.sessionId) ? CARD_LIMIT * 2 : 0) +
			(order.get(card.props.sessionId) ?? CARD_LIMIT);
		const cards = cardShapes(editor).sort((a, b) => rank(a) - rank(b));
		editor.updateShapes(
			cards.map((s, i) => ({
				id: s.id,
				type: s.type,
				x: cardSlot(i).x,
				y: cardSlot(i).y,
			})),
		);
		fitCards(editor);
	}

	return (
		<div className="relative h-full w-full overflow-hidden">
			<CanvasDataContext.Provider value={data}>
				<Tldraw
					key={user.toLowerCase()}
					store={store}
					shapeUtils={CANVAS_SHAPE_UTILS}
					components={CANVAS_COMPONENTS}
					licenseKey={TLDRAW_LICENSE_KEY}
					options={isPhone ? PHONE_CAMERA_OPTIONS : DESKTOP_CAMERA_OPTIONS}
					getShapeVisibility={getShapeVisibility}
					hideUi
					onMount={setEditor}
				/>
			</CanvasDataContext.Provider>
			{canvasFilterActive(filter) && shown.length === 0 && (
				<div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center p-6">
					<div className="pointer-events-auto flex flex-col items-center gap-2.5 text-center">
						<p className="max-w-[24rem] text-label text-dim">
							No cards match this filter. The board holds the team's most
							recent sessions, so older work is not on it.
						</p>
						<Button
							size="sm"
							onClick={() => setCanvasFilter(CANVAS_FILTER_DEFAULT)}
						>
							Show everything
						</Button>
					</div>
				</div>
			)}
			{/* Who is on the board is the first question, so it reads at the top;
			    the view controls stay at the bottom where they were. Both are
			    positioned against the canvas pane, which starts below the app
			    header on a phone too, so neither needs chrome clearance. */}
			<div className="absolute left-3 top-3 z-10">
				<CanvasFilters
					filter={filter}
					options={filterOptions}
					currentUser={user}
					onChange={setCanvasFilter}
				/>
			</div>
			<div className="absolute bottom-3 left-3 z-10 phone:bottom-[calc(12px+env(safe-area-inset-bottom))]">
				<div className="flex gap-1">
					<Button
						size="sm"
						className="shadow-md"
						aria-label="Zoom out"
						onClick={() =>
							editor?.zoomOut(editor.getViewportScreenCenter(), {
								animation: { duration: 200 },
							})
						}
					>
						−
					</Button>
					<Button
						size="sm"
						className="shadow-md"
						aria-label="Zoom in"
						onClick={() =>
							editor?.zoomIn(editor.getViewportScreenCenter(), {
								animation: { duration: 200 },
							})
						}
					>
						+
					</Button>
					<Button
						size="sm"
						className="shadow-md"
						onClick={() =>
							editor?.zoomToFit({ animation: { duration: 320 } })
						}
					>
						Fit
					</Button>
					<Button size="sm" className="shadow-md" onClick={sortByActivity}>
						Sort by activity
					</Button>
				</div>
			</div>
		</div>
	);
}
