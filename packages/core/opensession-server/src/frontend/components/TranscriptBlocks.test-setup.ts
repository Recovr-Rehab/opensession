// A sibling test may already have installed a partial `window`. Fill in this
// file's browser surface without replacing it or depending on test order.
Object.assign(
  ((globalThis as unknown as { window?: Record<string, unknown> }).window ??=
    {}),
  {
    addEventListener: () => {},
    matchMedia: () => ({ matches: false }),
  },
);
Object.assign(
  ((
    globalThis as unknown as { document?: Record<string, unknown> }
  ).document ??= {}),
  {
    documentElement: { dataset: {}, style: {} },
    querySelector: () => null,
  },
);
Object.assign(
  ((
    globalThis as unknown as { localStorage?: Record<string, unknown> }
  ).localStorage ??= {}),
  {
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  },
);

/** The two transcript preferences as the browser store holds them: whether a
 *  turn's work shows, and whether that includes its tool calls. Absent is the
 *  default (work "running", tool calls "folded"); an old single value in the
 *  work key still answers both. */
export function setTurnPrefs(work: string | null, tools: string | null = null) {
  (
    globalThis.localStorage as { getItem: (key: string) => string | null }
  ).getItem = (key) =>
    key === "opensession-turn-activity"
      ? work
      : key === "opensession-tool-calls"
        ? tools
        : null;
}
