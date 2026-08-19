/**
 * Whether the session header's workspace summary card is up.
 *
 * Stored rather than held in the component, because the card is a standing
 * view of the workspace and not a menu you reopen: it survives a reload and
 * follows you from one session to the next.
 *
 * It lives in its own module because two components need the same answer. The
 * card owns it, and the session viewer reads it on its FIRST render to decide
 * whether the header still draws the PR strip and the preview link. Waiting
 * for the card to report in an effect would paint the very things the card
 * replaces, for a frame, on every load.
 */
export const WS_SUMMARY_OPEN_KEY = "opensession-workspace-summary-open";

/** Same-tab notification that the preference changed. `storage` only fires in
 *  the OTHER tabs, and a second viewer in this one has to follow along. */
export const WS_SUMMARY_OPEN_EVENT =
	"opensession-workspace-summary-open-changed";

export function workspaceSummaryOpen(): boolean {
	return localStorage.getItem(WS_SUMMARY_OPEN_KEY) === "true";
}

/**
 * The header width at which the card stops covering anything.
 *
 * The card floats over the session column's right gutter, and the transcript
 * steps aside for it only while the pane is wide enough to have a gutter to
 * give. Below this there is nowhere to step, so a pinned card sits on top of
 * the words it is summarising. That is the width where it hides itself and
 * waits to be asked for instead.
 *
 * Measured on the session header rather than the window: the sidebar and the
 * side panel both eat into it, so the window's own width says little about
 * how much pane is left.
 */
export const WS_SUMMARY_ROOM_W = 1120;

/**
 * The widest step the reading column ever takes to get out of the card's way.
 *
 * Half the card's footprint, which is what clearing it costs at
 * WS_SUMMARY_ROOM_W: the column is already as wide as it is allowed to get by
 * then, so the only room left to find is in the two gutters either side of it,
 * and giving up half the footprint on the right buys the whole of it.
 */
export const WS_SUMMARY_MAX_SHIFT = 160;

/**
 * How far left the transcript and the composer step while the card is up.
 *
 * The card hangs at the pane's right edge and the reading column is centred in
 * the pane, so the two only collide on a narrow pane. Every pixel of pane above
 * WS_SUMMARY_ROOM_W is split evenly between the two gutters, so half of it is
 * clearance the column is handed for free: the step shrinks at half the rate
 * the pane grows, and reaches zero once the right gutter alone can hold the
 * card. Wider than that the messages stay in the middle of the pane, because
 * there is nothing over them to step away from.
 *
 * This replaced a flat WS_SUMMARY_MAX_SHIFT applied at every width, which
 * pulled the transcript off centre on windows where the card had never been
 * anywhere near it.
 *
 * An unmeasured pane steps not at all, for the same reason it counts as having
 * room: the width lands in a layout effect before the first paint, and centred
 * is the common case.
 */
export function workspaceSummaryShift(headerW: number): number {
	if (headerW <= 0) return 0;
	const step = WS_SUMMARY_MAX_SHIFT - (headerW - WS_SUMMARY_ROOM_W) / 2;
	return Math.round(Math.max(0, Math.min(WS_SUMMARY_MAX_SHIFT, step)));
}
