import { isApple, isChromium } from "./platform";

// Archive the active workspace. The viewer's ⌘E/⌘⇧A archives just the open
// session and bails on Alt, so the Alt-carrying escalation here never
// double-fires it.
export const ARCHIVE_WS_SHORTCUT_KEYS = isApple
	? ["⌘", "⌥", "⇧", "A"]
	: ["Ctrl", "Alt", "Shift", "A"];
// Chromium reserves ⌘E before the page sees it; advertise the working alias.
export const ARCHIVE_SHORTCUT_KEYS = isChromium
	? isApple
		? ["⌘", "⇧", "A"]
		: ["Ctrl", "Shift", "A"]
	: isApple
		? ["⌘", "E"]
		: ["Ctrl", "E"];
export const PIN_SHORTCUT_KEYS = isApple ? ["⌘", "P"] : ["Ctrl", "P"];

/** ⌘E (primary) or ⌘⇧A (legacy) — the archive-this-session chord. */
export function isArchiveChord(e: KeyboardEvent): boolean {
	if (!(e.metaKey || e.ctrlKey) || e.altKey) return false;
	const k = e.key.toLowerCase();
	return (k === "e" && !e.shiftKey) || (k === "a" && e.shiftKey);
}

/** True when an editable element owns focus and should keep the archive
 * chords for itself. The main composer textarea is exempt: it autofocuses on
 * every session open (and ⌘↑/⌘↓ workspace cycling re-focuses it), which left
 * the advertised ⌘E dead almost all the time — and the chord types nothing,
 * so firing there only costs the browser's niche find-selection default.
 * Rename fields, search boxes, etc. keep the guard. */
export function editableSwallowsArchiveChord(target: EventTarget | null): boolean {
	const editable = (target as HTMLElement | null)?.closest(
		"input, textarea, select, [contenteditable='true'], [contenteditable='']",
	);
	return !!editable && !editable.classList.contains("composer-textarea");
}

// Long-press (touch) tuning for the mobile action sheet.
export const LONG_PRESS_MS = 450; // hold before the sheet opens
export const LONG_PRESS_SLOP = 10; // px of finger travel that cancels it (a scroll)
export const SWIPE_REVEAL_PX = 82;
export const SWIPE_OPEN_THRESHOLD = 36;
export const SWIPE_FULL_RATIO = 0.45;
export const SWIPE_COMMIT_MS = 210;
export const SWIPE_AXIS_LOCK_PX = 8;

export type SwipeAction = "archive" | "star";
export type SwipeState = { key: string; offset: number; action?: SwipeAction };

export function clampSwipe(dx: number, rowWidth: number): number {
	const limit = Math.max(SWIPE_REVEAL_PX, rowWidth);
	return Math.max(-limit, Math.min(limit, dx));
}

export function fullSwipeThreshold(rowWidth: number): number {
	const usableWidth = Math.max(SWIPE_REVEAL_PX, rowWidth - 28);
	return Math.min(
		Math.max(SWIPE_REVEAL_PX * 1.8, rowWidth * SWIPE_FULL_RATIO),
		usableWidth,
	);
}

export function swipeCommitOffset(action: SwipeAction, rowWidth: number): number {
	return action === "archive" ? -rowWidth : rowWidth;
}

