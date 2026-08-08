/**
 * The tool call block's code surfaces.
 *
 * Two pieces that compose: `TOOL_PRE` is the monospace body, `TOOL_CODE_WELL`
 * is the sunk surface it usually sits on. They land either nested (a well
 * `div` wrapping a highlighted `pre`) or on the same element (a bare `pre`
 * that is its own well), which is why the well states its ink twice — once as
 * a descendant rule and once for itself. Both compile to two-class selectors,
 * so they outrank `TOOL_PRE`'s own `text-dim` exactly the way the legacy
 * `.tool-code-surface .tool-pre` / `.tool-pre.tool-code-surface` pair did.
 *
 * `tool-pre` stays on the markup as a bare hook with no rule behind it:
 * ToolCallBlock tints a failed result through `[&_.tool-pre]:text-red/75`, and
 * that has to reach both the `pre` and the highlighter's wrapper `div`, so a
 * `[&_pre]` selector would miss half of them.
 *
 * The well's colours are tokens (`--code-well*` in base.css) rather than the
 * hexes that were inlined here: the surface needs a value per theme, and only
 * a token re-resolves under `html[data-theme]`.
 */

/** Monospace body. Ink is `text-dim`; a well overrides it. */
export const TOOL_PRE =
	"tool-pre m-0 max-h-80 overflow-y-auto font-mono text-meta leading-[1.5] " +
	"whitespace-pre-wrap [word-break:break-word] [tab-size:2] text-dim";

/** The sunk surface a snippet sits on. */
export const TOOL_CODE_WELL =
	"overflow-x-auto rounded-md border border-code-well-line bg-code-well " +
	"px-2.5 py-2 [tab-size:2] " +
	"[&_.tool-pre]:text-code-well-ink [&.tool-pre]:text-code-well-ink " +
	"[&_.shiki-gutter]:text-code-well-gutter";

/**
 * The highlighter's output wrapper. Shiki emits its own `pre.shiki` with a
 * theme background and type of its own; every declaration here is undoing
 * that so the snippet inherits the well instead.
 */
export const TOOL_PRE_CODE =
	`${TOOL_PRE} ` +
	"[&_pre.shiki]:m-0 [&_pre.shiki]:p-0 [&_pre.shiki]:!bg-transparent " +
	"[&_pre.shiki]:font-[inherit] [&_pre.shiki]:text-[length:inherit] " +
	"[&_pre.shiki]:leading-[inherit] [&_pre.shiki]:whitespace-pre-wrap " +
	"[&_pre.shiki]:[word-break:break-word] " +
	"[&_pre.shiki_code]:font-[inherit] [&_pre.shiki_code]:text-[length:inherit]";

/** Image and video grids under a tool result. */
export const TOOL_RESULT_MEDIA = "mt-1.5 flex flex-wrap gap-2";
