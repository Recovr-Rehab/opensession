// Pure helpers for the "Send messages with" preference: key-combo matching
// and platform-aware labels. Deliberately side-effect-free (unit-tested) —
// the stored per-user preference itself lives in lib/send-key-pref.

export type SendKeyPref = "enter" | "mod-enter";

const isApple = /Mac|iPhone|iPad|iPod/.test(navigator.platform);

/** Platform-aware display label for the modifier combo ("⌘ Enter" / "Ctrl Enter"). */
export const MOD_ENTER_LABEL = isApple ? "⌘ Enter" : "Ctrl Enter";

/** Compact glyph form for inline hints ("⌘↩" / "Ctrl ↩"). */
export const MOD_ENTER_GLYPH = isApple ? "⌘↩" : "Ctrl ↩";

export function sendKeyLabel(pref: SendKeyPref): string {
	return pref === "mod-enter" ? MOD_ENTER_LABEL : "Enter";
}

/**
 * True when the caret sits inside an unclosed ``` fence. Plain Enter has to
 * insert a newline there instead of sending — otherwise a multi-line code
 * block can't be typed at all. Closing the fence sends as usual.
 */
export function insideOpenFence(text: string, caret: number): boolean {
	const fences = text.slice(0, caret).match(/```/g);
	return !!fences && fences.length % 2 === 1;
}

/** True when this keydown should send under the given preference. */
export function isSendCombo(
	e: { key: string; shiftKey: boolean; metaKey: boolean; ctrlKey: boolean },
	pref: SendKeyPref,
): boolean {
	if (e.key !== "Enter") return false;
	if (pref === "mod-enter") return e.metaKey || e.ctrlKey;
	return !e.shiftKey;
}
