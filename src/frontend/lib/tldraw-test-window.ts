/**
 * Test-only window fill-in for suites that import the tldraw runtime
 * (canvas-reflow.test.ts reaches it through canvas-cards.tsx).
 *
 * `bun test` runs every file in one process, and os1-tui's tests leak
 * @opentui/core's stub `window` — an object carrying requestAnimationFrame and
 * nothing else — into the shared globals. tldraw registers pointer listeners
 * and reads `navigator.platform` at module scope, so importing it after that
 * stub lands throws before any test runs. The same fill-in-the-stub approach
 * as WalkthroughCard.test.tsx, but as a module so it can be imported FIRST:
 * imports are hoisted, so an inline Object.assign in the test file would run
 * after tldraw has already been evaluated.
 *
 * Only fills in an existing stub. When no `window` is installed (the file run
 * alone, or first), tldraw's own no-DOM guards handle it and we must not hand
 * it a fake browser.
 */
const w = (globalThis as unknown as { window?: Record<string, unknown> })
	.window;
if (w) {
	const noop = () => {};
	// Each member independently: other test files (WalkthroughCard.test.tsx)
	// fill in some of these too, so probing one member to decide "is this a
	// bare stub" skips the rest exactly when the sweep's file order changes.
	w.addEventListener ??= noop;
	w.removeEventListener ??= noop;
	w.dispatchEvent ??= () => true;
	w.navigator ??= { platform: "", userAgent: "bun-test", maxTouchPoints: 0 };
	// Deliberately NO matchMedia: theme.ts gates its module-scope block on
	// `matchMedia && addEventListener` as its "is this a real browser" check,
	// and arming it here would send it after localStorage and document next.
	// tldraw does not need it at import time.
	// Modules gated on the bare window (reads.ts) still run their module-scope
	// blocks and read bare `localStorage`, so fill that in too, the same way
	// WalkthroughCard.test.tsx does.
	const ls = ((globalThis as unknown as {
		localStorage?: Record<string, unknown>;
	}).localStorage ??= {});
	ls.getItem ??= () => null;
	ls.setItem ??= noop;
	ls.removeItem ??= noop;
}

// prosemirror-view (inside tldraw) guards on `!!document` but then assumes
// `document.documentElement.style`, so a partial document stub from another
// test file breaks it where no document at all would not. Complete the stub;
// never create one.
const doc = (globalThis as unknown as {
	document?: { documentElement?: { style?: Record<string, unknown> } };
}).document;
if (doc) {
	doc.documentElement ??= { style: {} };
	doc.documentElement.style ??= {};
}
