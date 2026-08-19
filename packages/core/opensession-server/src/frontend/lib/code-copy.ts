/**
 * The copy control on a rendered code fence.
 *
 * A ```fence is the thing people most often want out of a message and the
 * hardest to get by hand: selecting it means dragging across a well that
 * scrolls sideways under the finger, and usually catching the prose around it.
 * This puts the button every editor and code host has there, on a fence
 * whether it holds one line or forty.
 *
 * Built as DOM rather than JSX for the same reason the mermaid expand button
 * is (MarkdownBody.tsx): a markdown body is injected as an innerHTML string,
 * so there is no element for React to own. The button is a SIBLING of the
 * <pre> rather than a child, because a long line scrolls the <pre> sideways
 * and a button inside it would ride off the edge with the code.
 */

import { checkIconMarkup, copyIconMarkup } from "../components/icons";
import { copyToClipboard } from "./share-link";

const WRAP_CLASS = "md-code-wrap";
const BUTTON_CLASS = "md-code-copy";
const COPY_LABEL = "Copy code";
const COPIED_LABEL = "Copied";
/** How long the check stays before the copy glyph comes back. */
const COPIED_MS = 1600;

const flashTimers = new WeakMap<HTMLElement, ReturnType<typeof setTimeout>>();

/**
 * The block's text as it is laid out. `innerText` rather than `textContent`:
 * shiki wraps every line in its own `<span class="line">` and does not
 * reliably leave a newline between them, so textContent can hand back a
 * forty-line block as one unbroken line. Layout is what knows where the
 * breaks are.
 */
function codeText(pre: HTMLElement): string {
	const text = pre.innerText || pre.textContent || "";
	// A fence always ends in a newline the author did not type.
	return text.replace(/\n+$/, "");
}

function flashCopied(button: HTMLElement): void {
	const running = flashTimers.get(button);
	if (running) clearTimeout(running);
	button.dataset.copied = "";
	button.title = COPIED_LABEL;
	button.setAttribute("aria-label", COPIED_LABEL);
	flashTimers.set(
		button,
		setTimeout(() => {
			delete button.dataset.copied;
			button.title = COPY_LABEL;
			button.setAttribute("aria-label", COPY_LABEL);
			flashTimers.delete(button);
		}, COPIED_MS),
	);
}

/**
 * Give every code fence under `root` a copy button. Idempotent: a fence that
 * already sits in a wrapper is left alone, so this can run again after a
 * re-render without stacking controls.
 */
export function decorateCodeBlocks(root: HTMLElement): void {
	for (const pre of Array.from(root.querySelectorAll("pre"))) {
		if (pre.parentElement?.classList.contains(WRAP_CLASS)) continue;
		// A ```mermaid fence is on its way to becoming a diagram (MarkdownBody
		// upgrades it asynchronously, after this has run). Its source is not
		// what anyone wants on the clipboard, and the diagram that replaces it
		// carries its own control.
		if (pre.querySelector('code[class*="language-mermaid"]')) continue;
		const wrap = document.createElement("div");
		wrap.className = WRAP_CLASS;
		const button = document.createElement("button");
		button.type = "button";
		button.className = BUTTON_CLASS;
		button.title = COPY_LABEL;
		button.setAttribute("aria-label", COPY_LABEL);
		// Both glyphs are always in the DOM, stacked in one grid cell, so the
		// swap to the check has no layout in it and cannot shift the button.
		button.innerHTML =
			`<span class="md-code-copy-glyph" data-state="idle">${copyIconMarkup()}</span>` +
			`<span class="md-code-copy-glyph" data-state="done">${checkIconMarkup()}</span>`;
		pre.replaceWith(wrap);
		wrap.append(pre, button);
	}
}

/**
 * Listen for copy clicks under `root`. Delegated because the buttons are
 * created and destroyed by innerHTML rewrites; a `<button>` also turns
 * keyboard Enter and Space into the same click, so this is the whole
 * interaction. Returns the detach function.
 */
export function attachCodeCopy(root: HTMLElement): () => void {
	function onClick(e: MouseEvent) {
		const target = e.target as HTMLElement | null;
		const button = target?.closest?.(`button.${BUTTON_CLASS}`) as
			| HTMLElement
			| null;
		if (!button || !root.contains(button)) return;
		const pre = button.parentElement?.querySelector("pre");
		if (!pre) return;
		e.preventDefault();
		copyToClipboard(codeText(pre as HTMLElement), () => flashCopied(button));
	}
	root.addEventListener("click", onClick);
	return () => root.removeEventListener("click", onClick);
}
