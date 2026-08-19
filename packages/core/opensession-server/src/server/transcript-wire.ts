import { INIT_WIRE_CLAMP_BYTES } from "./jsonl-parser";
import type { SeqEntry } from "./transcript-store";

/**
 * Tool results open folded and hydrate from the full-entry endpoint when a
 * reader expands them. The opening frame therefore carries a compact preview;
 * messages keep the established 8 KB preview because they render in place.
 */
export const INIT_TOOL_RESULT_CLAMP_BYTES = 512;

/**
 * Clamp an opening snapshot or history page without changing live appends.
 * Keeping the original content length lets every client offer full hydration.
 */
export function clampV2InitEntries(entries: SeqEntry[]): SeqEntry[] {
  if (!entries.some((entry) => entry.content.length > initClampBytes(entry))) {
    return entries;
  }
  return entries.map((entry) => {
    const max = initClampBytes(entry);
    return entry.content.length <= max
      ? entry
      : {
          ...entry,
          content: entry.content.slice(0, max),
          contentClamped: true,
          contentLength: entry.contentLength ?? entry.content.length,
        };
  });
}

/**
 * Estimate a stored row's cost after clampV2InitEntries. Tool results get 512
 * bytes of headroom above their content preview for identifiers and metadata.
 */
export function v2SnapshotEntryWeight(
  kind: string,
  storedBytes: number
): number {
  const wireBudget =
    kind === "tool_result"
      ? INIT_TOOL_RESULT_CLAMP_BYTES + 512
      : INIT_WIRE_CLAMP_BYTES;
  return Math.min(storedBytes, wireBudget);
}

function initClampBytes(entry: SeqEntry): number {
  return entry.type === "tool_result"
    ? INIT_TOOL_RESULT_CLAMP_BYTES
    : INIT_WIRE_CLAMP_BYTES;
}
