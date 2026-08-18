import { useState } from "react";

/**
 * Whether the workspace summary column stands open beside the transcript.
 *
 * It lives in localStorage next to the panel's own key (hooks/useSidePanel),
 * for the same reason: this is a browser-level preference about the shape of
 * the window, not a property of any one session. Someone who wants the widest
 * possible transcript turns it off once.
 *
 * It defaults to ON, which is the point of the column. A summary you have to
 * ask for cannot tell you about the moment you were not looking.
 *
 * There is no width here and no resize handle. The column is one size, and a
 * draggable one would just be the Workspace panel under another name.
 */
const OPEN_KEY = "opensession-workspace-summary-open";

export function useWorkspaceSummaryOpen(): [boolean, (open: boolean) => void] {
	const [open, setOpenState] = useState(
		() => localStorage.getItem(OPEN_KEY) !== "false",
	);
	function setOpen(next: boolean) {
		setOpenState(next);
		localStorage.setItem(OPEN_KEY, String(next));
	}
	return [open, setOpen];
}
