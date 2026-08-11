interface HighlightRegistry {
	set(name: string, highlight: unknown): void;
	delete(name: string): boolean;
}

type HighlightConstructor = new (...ranges: Range[]) => unknown;

interface RangeEndpoint {
	eid: string;
	path: number[];
	offset: number;
	textOffset: number;
}

export interface AnchoredRange {
	range: Range;
	start: RangeEndpoint | null;
	end: RangeEndpoint | null;
	selectedText: string;
	fallback: { start: number; end: number; text: string } | null;
}

function highlightApi(): {
	registry: HighlightRegistry;
	Highlight: HighlightConstructor;
} | null {
	if (typeof CSS === "undefined" || typeof window === "undefined") return null;
	const registry = (CSS as unknown as { highlights?: HighlightRegistry }).highlights;
	const Highlight = (window as unknown as { Highlight?: HighlightConstructor })
		.Highlight;
	return registry && Highlight ? { registry, Highlight } : null;
}

export function paintQuoteHighlight(name: string, range: Range): void {
	const api = highlightApi();
	if (api) api.registry.set(name, new api.Highlight(range));
}

export function clearQuoteHighlight(name: string): void {
	highlightApi()?.registry.delete(name);
}

function endpointFor(node: Node, offset: number): RangeEndpoint | null {
	const element =
		node instanceof Element ? node : (node.parentElement as Element | null);
	const root = element?.closest<HTMLElement>("[data-eid]");
	const eid = root?.dataset.eid;
	if (!root || !eid) return null;

	const path: number[] = [];
	let current: Node = node;
	while (current !== root) {
		const parent = current.parentNode;
		if (!parent) return null;
		path.unshift(Array.prototype.indexOf.call(parent.childNodes, current));
		current = parent;
	}
	const prefix = document.createRange();
	prefix.selectNodeContents(root);
	prefix.setEnd(node, offset);
	return { eid, path, offset, textOffset: prefix.toString().length };
}

function flatTextOffset(container: HTMLElement, point: Node, offset: number): number | null {
	if (!(point instanceof Text)) return null;
	const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
	let total = 0;
	let node: Node | null;
	while ((node = walker.nextNode())) {
		if (node === point) return total + offset;
		total += (node as Text).data.length;
	}
	return null;
}

function flatText(container: HTMLElement): string {
	const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
	let text = "";
	let node: Node | null;
	while ((node = walker.nextNode())) text += (node as Text).data;
	return text;
}

export function anchorQuoteRange(
	range: Range,
	container: HTMLElement,
): AnchoredRange {
	const saved = range.cloneRange();
	const flatStart = flatTextOffset(container, saved.startContainer, saved.startOffset);
	const flatEnd = flatTextOffset(container, saved.endContainer, saved.endOffset);
	const text = flatText(container);
	return {
		range: saved,
		start: endpointFor(saved.startContainer, saved.startOffset),
		end: endpointFor(saved.endContainer, saved.endOffset),
		selectedText: saved.toString(),
		fallback:
			flatStart !== null && flatEnd !== null
				? { start: flatStart, end: flatEnd, text: text.slice(flatStart, flatEnd) }
				: null,
	};
}

function nodeAtPath(root: Node, path: number[]): Node | null {
	let node = root;
	for (const index of path) {
		const next = node.childNodes[index];
		if (!next) return null;
		node = next;
	}
	return node;
}

function maxOffset(node: Node): number {
	return node instanceof Text ? node.data.length : node.childNodes.length;
}

function textPoint(root: HTMLElement, wanted: number): [Node, number] | null {
	const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
	let remaining = wanted;
	let node: Node | null;
	while ((node = walker.nextNode())) {
		const length = (node as Text).data.length;
		if (remaining <= length) return [node, remaining];
		remaining -= length;
	}
	return remaining === 0 ? [root, root.childNodes.length] : null;
}

function recoverEndpoint(
	container: HTMLElement,
	endpoint: RangeEndpoint | null,
): [Node, number] | null {
	if (!endpoint) return null;
	const root = container.querySelector<HTMLElement>(
		`[data-eid="${CSS.escape(endpoint.eid)}"]`,
	);
	if (!root) return null;
	const pathNode = nodeAtPath(root, endpoint.path);
	if (pathNode && endpoint.offset <= maxOffset(pathNode))
		return [pathNode, endpoint.offset];
	return textPoint(root, endpoint.textOffset);
}

function recoverFallback(
	container: HTMLElement,
	fallback: AnchoredRange["fallback"],
): Range | null {
	if (!fallback) return null;
	const text = flatText(container);
	let start = fallback.start;
	if (text.slice(start, start + fallback.text.length) !== fallback.text) {
		const matches: number[] = [];
		let cursor = text.indexOf(fallback.text);
		while (cursor !== -1) {
			matches.push(cursor);
			cursor = text.indexOf(fallback.text, cursor + 1);
		}
		if (matches.length === 0) return null;
		start = matches.reduce((nearest, candidate) =>
			Math.abs(candidate - fallback.start) < Math.abs(nearest - fallback.start)
				? candidate
				: nearest,
		);
	}
	const startPoint = textPoint(container, start);
	const endPoint = textPoint(container, start + fallback.text.length);
	if (!startPoint || !endPoint) return null;
	const range = document.createRange();
	try {
		range.setStart(...startPoint);
		range.setEnd(...endPoint);
	} catch {
		return null;
	}
	return range;
}

export function recoverQuoteRange(
	anchored: AnchoredRange,
	container: HTMLElement,
): Range | null {
	const start = recoverEndpoint(container, anchored.start);
	const end = recoverEndpoint(container, anchored.end);
	if (start && end) {
		const range = document.createRange();
		try {
			range.setStart(...start);
			range.setEnd(...end);
			if (range.toString() === anchored.selectedText) return range;
		} catch {
			// Fall through to the transcript-relative text anchor.
		}
	}
	return recoverFallback(container, anchored.fallback);
}
