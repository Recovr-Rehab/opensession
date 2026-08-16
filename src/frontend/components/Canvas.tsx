// The Canvas tool: sessions as cards on an infinite tldraw canvas. pan,
// zoom, arrange, and talk to any of them in place. Card geometry is shared and
// persisted by the server's tldraw room; the set of cards tracks the live
// session list, seeded in inbox-activity order and re-sortable any time with
// the toolbar's "Sort by activity".
import { useEffect, useMemo, useState } from "react";
import { Tldraw, createShapeId, type Editor } from "tldraw";
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
import { useCanvasStore } from "../lib/canvas-sync";
import { usePeople } from "../lib/people";
import { isClaimed } from "../lib/sidebar-lanes";
import type { UnifiedSession } from "../lib/types";
import { Button } from "../ui/button";
import { EmptyState } from "../ui/state";
import { useCurrentUser } from "./UserPicker";
import { CanvasCollaborators } from "./CanvasCollaborators";

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

const CANVAS_COMPONENTS = { InFrontOfTheCanvas: CanvasCollaborators };

interface SessionCanvasProps {
	sessions: UnifiedSession[];
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
	onOpenSession,
}: SessionCanvasProps) {
	const user = useCurrentUser();
	const people = usePeople();
	const store = useCanvasStore(user, people);
	const isPhone = useIsPhone();
	const [editor, setEditor] = useState<Editor | null>(null);
	const relevant = useMemo(
		() => canvasSessions(sessions, isClaimed),
		[sessions],
	);
	const data = useMemo(
		() => ({
			sessions: new Map(sessions.map((s) => [s.id, s])),
			onOpenSession,
			compactAtLowZoom: isPhone,
		}),
		[sessions, onOpenSession, isPhone],
	);

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
		const cards = cardShapes(editor).sort(
			(a, b) =>
				(order.get(a.props.sessionId) ?? CARD_LIMIT) -
				(order.get(b.props.sessionId) ?? CARD_LIMIT),
		);
		editor.updateShapes(
			cards.map((s, i) => ({
				id: s.id,
				type: s.type,
				x: cardSlot(i).x,
				y: cardSlot(i).y,
			})),
		);
		editor.zoomToFit({ animation: { duration: 320 } });
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
					hideUi
					onMount={setEditor}
				/>
			</CanvasDataContext.Provider>
			<div className="absolute bottom-3 left-3 z-10 flex gap-1 phone:bottom-[calc(12px+env(safe-area-inset-bottom))]">
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
	);
}
