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
