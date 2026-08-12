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
 * The read tool's result envelope. Its body is quoted source, so a URL in it
 * belongs to the code, not to the session: a ReScript test's
 * `"https://example.com/image.png"` and a Rust test's
 * `http://example.com/delayed.mp4` filled a workspace filmstrip with broken
 * tiles (2026-08-12), the same failure grep output caused a day earlier.
 *
 * Kept tied to the envelope for the same reason as grep, and for the same
 * reason nothing here tries to recognise "code-like" URLs: an MCP tool that
 * returns a real media URL in its JSON must keep rendering.
 */
const READ_RESULT_HEADER = /^<path>[^\n]*<\/path>\r?\n<type>file<\/type>/;

export function isFileReadOutput(text: string): boolean {
  return READ_RESULT_HEADER.test(text.trimStart());
}

/**
 * Names reserved for documentation and testing (RFC 2606, RFC 6761). Nothing
 * real is ever served from them, so a URL on one is a fixture wherever it was
 * found — an envelope-independent rule, which is what makes it worth having
 * next to the two envelope checks above. `.localhost` and `.test` are included
 * deliberately: the strip renders in the reader's browser, which is not the
 * machine the agent ran on.
 */
const RESERVED_HOST_RE =
  /(?:^|\.)(?:example\.(?:com|net|org)|example|test|invalid|localhost)$/i;

export function isReservedMediaHost(src: string): boolean {
  try {
    return RESERVED_HOST_RE.test(new URL(src).hostname);
  } catch {
    // Unparseable as a URL — not something a browser can load either.
    return true;
  }
}

/**
 * Read-time repair for transcript-v2 rows persisted before these guards
 * existed. Explicit marker media (`featuredMedia`) is always preserved; only
 * media *inferred* from quoted code — a search snippet, a file listing, or any
 * reserved-name URL — is removed. This is the only path that heals the rows
 * already in the store, so it carries every predicate the extractor applies.
 */
export function sanitizeTranscriptMediaEntry<T extends TranscriptEntry>(entry: T): T {
  if (!entry.images?.length && !entry.videos?.length) return entry;

  const content = entry.content || "";
  const quotedCode =
    entry.type === "tool_result" &&
    (isGrepResultOutput(content) || isFileReadOutput(content));
  const featured = new Set(entry.featuredMedia || []);
  const keep = (src: string) =>
    featured.has(src) ||
    (!quotedCode && !(/^https?:\/\//i.test(src) && isReservedMediaHost(src)));
  if ((entry.images || []).every(keep) && (entry.videos || []).every(keep))
    return entry;

  const images = entry.images?.filter(keep);
  const videos = entry.videos?.filter(keep);
  const repaired = { ...entry };
  if (images?.length) repaired.images = images;
  else delete repaired.images;
  if (videos?.length) repaired.videos = videos;
  else delete repaired.videos;
  return repaired;
}
