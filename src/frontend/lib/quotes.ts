/**
 * Quoted transcript selections — the "Selected text" chips the composer
 * carries. Selecting text in the transcript offers an "Add to chat" pill
 * (components/QuoteSelection.tsx); taking it stages the passage here, and the
 * next message goes out with the passage quoted above it, so both the model
 * and the transcript show exactly what was being talked about.
 */

export interface Quote {
	id: string;
	text: string;
}

export function newQuote(text: string): Quote {
	return { id: crypto.randomUUID(), text: text.trim() };
}

/** One-line preview for the chip's tooltip: collapsed whitespace, clipped. */
export function quotePreview(text: string, max = 220): string {
	const flat = text.replace(/\s+/g, " ").trim();
	return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

/**
 * The outgoing message: each staged passage as a markdown blockquote, then the
 * typed message. Markdown renders it in the sender's own bubble too, so the
 * conversation keeps the context the answer was given for.
 *
 * A staged passage never sends on its own from the UI — the composer's send
 * stays disabled until something is typed, since "chat with selected text"
 * means asking something about it. The empty-message case is still total here
 * rather than returning "": a passage is content, and a caller that hands one
 * over should get it back.
 */
export function withQuotes(quotes: Quote[], message: string): string {
	if (quotes.length === 0) return message;
	const blocks = quotes.map((q) =>
		q.text
			.split("\n")
			.map((line) => (line.trim() ? `> ${line}` : ">"))
			.join("\n"),
	);
	const typed = message.trim();
	return typed ? `${blocks.join("\n\n")}\n\n${typed}` : blocks.join("\n\n");
}
