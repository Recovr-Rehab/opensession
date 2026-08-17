/**
 * The Canvas tool's filtered layout: the compact grid you get while a filter is
 * on, and the bookkeeping that keeps it from reaching anyone else.
 *
 * A filter is per-viewer (lib/canvas-filter) but card geometry is not: one
 * shared tldraw room holds it, so moving a card moves it for the whole team.
 * Hiding alone therefore leaves the grid full of the holes the hidden cards
 * used to fill, and the camera has to pull back far enough to hold them, which
 * turns the cards you asked for into specks. This closes the holes by lying to
 * the local store: matching cards are packed into a compact grid inside
 * `store.mergeRemoteChanges`, which @tldraw/sync never sends: its client
 * forwards only `{source: "user", scope: "document"}` changes (TLSyncClient.ts,
 * "does not push changes made with a remote source"). Clearing the filter puts
 * every card back where the room has it.
 *
 * THE INVARIANT, and it is load-bearing: while a projection is on, the local
 * store's x/y for those cards is a fiction, and any USER-sourced write to them
 * is pushed to everyone. The leaks are enumerable, and each one is plugged:
 *
 *   - dragging and resizing: projected cards are locked, locally,
 *   - filling a free slot with a new card: occupancy reads `truePosition`,
 *   - "Sort by activity": takes the projection down and rebuilds it after.
 *
 * A new `updateShapes` or `createShapes` call site on this canvas is a new leak
 * path. Route its geometry through `truePosition`, or take the projection down
 * first. Nothing in this module can push: every write it makes is remote-sourced,
 * so the worst it can do is show you a card in the wrong place until the next
 * remote change or reload.
 */
import type { Editor, TLShape, TLShapeId, TLShapePartial } from "tldraw";
import { CARD_GAP, CARD_H, CARD_W, type SessionCardShape } from "./canvas-cards";

const PITCH_X = CARD_W + CARD_GAP;
const PITCH_Y = CARD_H + CARD_GAP;
/** Matches `fitCards`, so the grid is chosen for the frame it gets shown in. */
const VIEW_INSET = 48;

export interface ReflowViewport {
	width: number;
	height: number;
}

/**
 * How many columns to pack `count` cards into: whichever grid this viewport can
 * show largest, which is the one whose shape is closest to the viewport's own.
 * A fixed count cannot do that. Five columns wastes a tall phone and a square
 * block wastes a wide desktop, and the whole point of packing is the zoom it
 * buys back.
 */
export function reflowColumns(count: number, view: ReflowViewport): number {
	if (count <= 1) return 1;
	const width = Math.max(1, view.width - VIEW_INSET * 2);
	const height = Math.max(1, view.height - VIEW_INSET * 2);
	let best = 1;
	let bestScale = -Infinity;
	for (let cols = 1; cols <= count; cols++) {
		const rows = Math.ceil(count / cols);
		const scale = Math.min(
			width / (cols * PITCH_X - CARD_GAP),
			height / (rows * PITCH_Y - CARD_GAP),
		);
		// Ties go to the fewer columns: same rows either way, so the narrower
		// grid is the one without a ragged last row.
		if (scale > bestScale + 1e-6) {
			bestScale = scale;
			best = cols;
		}
	}
	return best;
}

/** Where the i-th packed card sits. Same pitch as the board's own grid. */
export function reflowSlot(i: number, cols: number): { x: number; y: number } {
	const columns = Math.max(1, cols);
	return {
		x: (i % columns) * PITCH_X,
		y: Math.floor(i / columns) * PITCH_Y,
	};
}

interface TruePlace {
	x: number;
	y: number;
	isLocked: boolean;
}

function isCard(shape: TLShape): shape is SessionCardShape {
	return shape.type === "session-card";
}

/** The compact grid, applied to one editor. See the module doc first. */
export class CanvasReflow {
	private readonly truth = new Map<TLShapeId, TruePlace>();
	private order: string[] = [];
	private on = false;
	/** Our own writes come back through the remote listener; ignore those. */
	private applying = false;
	private queued = false;
	private unlisten: (() => void) | null = null;

	constructor(private readonly editor: Editor) {}

	/** Whether cards are currently standing somewhere other than the board says. */
	get active(): boolean {
		return this.on;
	}

	/**
	 * Pack these sessions' cards, in this order. Idempotent. Returns how many
	 * cards it found: a board that is still arriving over the socket packs
	 * nothing, and the caller has a camera to hold back until it does.
	 */
	apply(sessionIds: string[]): number {
		this.order = sessionIds;
		this.on = true;
		this.watch();
		return this.project();
	}

	/** Re-pack after something local changed the cards (a card was created). */
	refresh() {
		if (this.on) this.project();
	}

	/** Put every packed card back where the shared room has it. */
	clear() {
		if (!this.on) return;
		this.on = false;
		this.order = [];
		this.unlisten?.();
		this.unlisten = null;
		this.restore([...this.truth.keys()]);
	}

	dispose() {
		this.clear();
	}

	/**
	 * Where the team has this card. Read this rather than the shape whenever the
	 * answer is going to be written back, because the shape's own x/y is the
	 * fiction while a projection is on.
	 */
	truePosition(shape: SessionCardShape): { x: number; y: number } {
		const was = this.truth.get(shape.id);
		return was ? { x: was.x, y: was.y } : { x: shape.x, y: shape.y };
	}

	private project(): number {
		if (!this.on) return 0;
		const cards = new Map<string, SessionCardShape>();
		for (const shape of this.editor.getCurrentPageShapes())
			if (isCard(shape)) cards.set(shape.props.sessionId, shape);
		const shown: SessionCardShape[] = [];
		const taken = new Set<TLShapeId>();
		for (const id of this.order) {
			const card = cards.get(id);
			if (!card) continue;
			shown.push(card);
			taken.add(card.id);
		}
		// A card outlives its session's place in the working set, so the board
		// carries cards the caller's list has no opinion about, and a filter
		// they match leaves them standing wherever they were. Packing only the
		// list would leave those behind, still on screen, and the camera would
		// frame the board all over again. Pack everything you can see.
		const extra = [...cards.values()]
			.filter((card) => !taken.has(card.id) && !this.editor.isShapeHidden(card))
			.sort((a, b) => {
				const left = this.truePosition(a);
				const right = this.truePosition(b);
				return left.y - right.y || left.x - right.x;
			});
		shown.push(...extra);

		// Cards the filter has since dropped go home before the rest re-pack, so
		// the truth map holds exactly the set that is currently standing wrong.
		const keep = new Set(shown.map((card) => card.id));
		const dropped = [...this.truth.keys()].filter((id) => !keep.has(id));
		if (dropped.length) this.restore(dropped);

		for (const card of shown)
			if (!this.truth.has(card.id))
				this.truth.set(card.id, {
					x: card.x,
					y: card.y,
					isLocked: !!card.isLocked,
				});

		const cols = reflowColumns(shown.length, this.editor.getViewportScreenBounds());
		const moves: TLShapePartial[] = [];
		shown.forEach((card, i) => {
			const slot = reflowSlot(i, cols);
			if (card.x === slot.x && card.y === slot.y && card.isLocked) return;
			moves.push({
				id: card.id,
				type: card.type,
				x: slot.x,
				y: slot.y,
				// Locked, so a drag cannot push a packed coordinate to the team.
				// The card itself stays live: locking is tldraw's arrangement
				// gate, not a pointer gate, and the card's own DOM is unaffected.
				isLocked: true,
			});
		});
		this.write(moves);
		return shown.length;
	}

	private restore(ids: TLShapeId[]) {
		const back: TLShapePartial[] = [];
		for (const id of ids) {
			const was = this.truth.get(id);
			this.truth.delete(id);
			const shape = this.editor.getShape(id);
			if (!was || !shape) continue;
			back.push({
				id,
				type: shape.type,
				x: was.x,
				y: was.y,
				isLocked: was.isLocked,
			});
		}
		this.write(back);
	}

	private write(partials: TLShapePartial[]) {
		if (!partials.length) return;
		this.applying = true;
		try {
			this.editor.store.mergeRemoteChanges(() => {
				// `ignoreShapeLock` because the projection locks what it moves, so
				// every pass after the first is writing to its own locked shapes.
				this.editor.run(() => this.editor.updateShapes(partials), {
					history: "ignore",
					ignoreShapeLock: true,
				});
			});
		} finally {
			this.applying = false;
		}
	}

	private watch() {
		if (this.unlisten) return;
		this.unlisten = this.editor.store.listen(
			({ changes }) => {
				if (this.applying) return;
				let dirty = Object.keys(changes.added).length > 0;
				for (const [id, [from, to]] of Object.entries(changes.updated) as Array<
					[TLShapeId, [TLShape, TLShape]]
				>) {
					if (!this.truth.has(id)) continue;
					// A remote patch only carries the keys it changed, and it lands
					// on top of the fiction, so an untouched x/y comes back as the
					// packed value, not as the team's. Adopt only what moved.
					if (from.x === to.x && from.y === to.y && from.isLocked === to.isLocked)
						continue;
					this.truth.set(id, { x: to.x, y: to.y, isLocked: !!to.isLocked });
					dirty = true;
				}
				for (const id of Object.keys(changes.removed) as TLShapeId[])
					if (this.truth.delete(id)) dirty = true;
				if (dirty) this.schedule();
			},
			{ source: "remote", scope: "document" },
		);
	}

	/** Re-pack after the flush, rather than writing inside a listener. */
	private schedule() {
		if (this.queued) return;
		this.queued = true;
		queueMicrotask(() => {
			this.queued = false;
			this.project();
		});
	}
}
