import type { TranscriptEntry } from "./types";

/**
 * The built-in grep tool starts successful result sets with this line. URLs
 * in the following source snippets are code, fixtures, or docs — they are not
 * artifacts the tool produced. Treating `https://example.com/demo.mp4` in a
 * Rust test as media created broken workspace filmstrips (2026-08-11).
 *
 * Keep this deliberately tied to grep's output envelope instead of trying to
 * identify "code-like" URLs: MCP tools legitimately return JSON containing a
 * real media URL, and those should continue to render implicitly.
 */
const GREP_RESULT_HEADER = /^Found \d+ match(?:es)?(?: \(more matches available\))?\s*$/;

export function isGrepResultOutput(text: string): boolean {
  const firstLine = text.trimStart().split(/\r?\n/, 1)[0]?.trim() || "";
  return GREP_RESULT_HEADER.test(firstLine);
}

/**
 * Read-time repair for transcript-v2 rows persisted before grep output was
 * excluded from implicit media detection. Explicit marker media is preserved;
 * only unfeatured media inferred from the search snippets is removed.
 */
export function sanitizeTranscriptMediaEntry<T extends TranscriptEntry>(entry: T): T {
  if (
    entry.type !== "tool_result" ||
    !isGrepResultOutput(entry.content || "") ||
    (!entry.images?.length && !entry.videos?.length)
  )
    return entry;

  const featured = new Set(entry.featuredMedia || []);
  const images = entry.images?.filter((src) => featured.has(src));
  const videos = entry.videos?.filter((src) => featured.has(src));
  const repaired = { ...entry };
  if (images?.length) repaired.images = images;
  else delete repaired.images;
  if (videos?.length) repaired.videos = videos;
  else delete repaired.videos;
  return repaired;
}
