// Coarse client-platform detection, shared by every surface that renders
// keyboard-shortcut labels or picks modifier keys. Evaluated once at module
// load — the platform doesn't change under a running page.

/** Apple device (macOS or iOS/iPadOS): ⌘-family shortcuts and glyph labels. */
export const isApple = /Mac|iPhone|iPad|iPod/.test(navigator.platform);

/**
 * Chromium-engine browser (Chrome, Chromium, iOS Chrome, Edge, Opera).
 * Chromium reserves some chords (e.g. ⌘E) before the page sees them, so a few
 * surfaces advertise a different working alias there.
 */
export const isChromium = /Chrome|Chromium|CriOS|Edg|OPR/.test(
	navigator.userAgent,
);
