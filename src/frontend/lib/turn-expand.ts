/**
 * "Open that fold" requests, addressed by a turn's anchor id.
 *
 * A turn's work is collapsed by default, so the steps inside it aren't in the
 * DOM at all — and the minimap ticks straight into them. Rather than lift
 * TurnBlock's fold state into SessionViewer (where every keystroke would then
 * re-render it) the rail just asks the one block that owns it to open.
 *
 * Deliberately tiny: no state of its own, so a fold that isn't mounted simply
 * has no listener and the request is a no-op — which is the right answer, as
 * the jump scrolls to the fold's own row and the reader can open it there.
 */

type Listener = () => void;

const listeners = new Map<string, Set<Listener>>();

/** Ask the fold with this anchor id to expand, if it is mounted. */
export function requestTurnExpand(anchorId: string): void {
	for (const fn of listeners.get(anchorId) ?? []) fn();
}

/** Subscribe a fold to its own expand requests. Returns the unsubscribe. */
export function onTurnExpandRequest(anchorId: string, fn: Listener): () => void {
	let set = listeners.get(anchorId);
	if (!set) listeners.set(anchorId, (set = new Set()));
	set.add(fn);
	return () => {
		set!.delete(fn);
		if (set!.size === 0) listeners.delete(anchorId);
	};
}
