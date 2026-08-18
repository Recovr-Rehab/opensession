import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { NewSessionPromptHandle } from "./NewSessionPrompt";

// `bun test` runs every file in one process, and os1-tui's renderer leaves a
// stub `window` behind that carries addEventListener and nothing else.
// lib/drafts arms its cross-device poll behind that first method and then
// calls window.setInterval, so reaching it through the stub throws where
// neither module is at fault. Fill the gap in before the import that gets
// there — the same file-local repair live-turn-store.test.ts makes for
// requestAnimationFrame — rather than taking the stub away from its owner.
const stub = globalThis.window as { setInterval?: unknown } | undefined;
if (stub && typeof stub.setInterval !== "function")
	stub.setInterval = setInterval;
const { NewSessionPrompt } = await import("./NewSessionPrompt");

function field(overrides: Partial<Parameters<typeof NewSessionPrompt>[0]> = {}) {
	const props: Parameters<typeof NewSessionPrompt>[0] = {
		initialText: "",
		textareaRef: { current: null },
		valueRef: { current: "" },
		handle: { current: null as NewSessionPromptHandle | null },
		repo: "opensession",
		placeholder: "What do you want to work on?",
		disabled: false,
		images: [],
		files: [],
		attaching: null,
		onRemoveImage: () => {},
		onRemoveFile: () => {},
		onAddAttachments: () => {},
		sendKey: "enter",
		canCreate: false,
		onCreate: () => {},
		onHasTextChange: () => {},
		onDraftSettled: () => {},
		onEdgesChange: () => {},
		onMentionOpenChange: () => {},
		...overrides,
	};
	return { props, html: renderToStaticMarkup(<NewSessionPrompt {...props} />) };
}

test("the restored draft is what the field shows", () => {
	const { html } = field({ initialText: "Fix the flaky test" });

	expect(html).toContain("<textarea");
	expect(html).toContain("Fix the flaky test");
	expect(html).toContain('placeholder="What do you want to work on?"');
});

// The palette does not hold the draft any more, so this ref is the only way a
// create can read what was typed. It has to be current as of the render, not
// one commit behind.
test("the draft is published to the palette's ref while rendering", () => {
	const valueRef = { current: "" };
	field({ initialText: "Ship the palette split", valueRef });

	expect(valueRef.current).toBe("Ship the palette split");
});

test("attachments share the prompt's scroller", () => {
	const { html } = field({
		images: ["data:image/png;base64,iVBORw0KGgo="],
		files: [
			{
				name: "notes.txt",
				type: "text/plain",
				dataUrl: "data:text/plain;base64,aGk=",
			},
		],
	});

	expect(html).toContain('aria-label="Open image preview"');
	expect(html).toContain("notes.txt");
});

// A pasted screenshot is uploaded before it is attached, and during a slow
// load that takes seconds. Without this row the card looks like it ignored
// the paste, and the second paste leaves you with two of the same picture.
test("a file still being staged says so", () => {
	const { html } = field({ attaching: "Attaching 1 image…" });

	expect(html).toContain("Attaching 1 image…");
	expect(html).toContain('role="status"');
});

test("a busy create disables the field", () => {
	const { html } = field({ disabled: true });

	expect(html).toContain("disabled");
});
