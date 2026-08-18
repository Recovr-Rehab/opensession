/**
 * Streaming assistant text as the model writes it, and the bookkeeping that
 * makes partial delivery safe.
 *
 * The opencode engine publishes a text part over SSE exactly twice, empty at
 * creation and complete at the end, so mirroring part snapshots can only ever
 * deliver a finished reply in one frame. Partial text exists in exactly one
 * place: the `message.part.delta` feed. Forwarding that is what makes a reply
 * type out, and it is what opencode's own client consumes.
 *
 * What goes out is not the raw delta feed, though. A model writes markdown,
 * and markdown mid-write does not render as itself: a paragraph stops
 * mid-word, a code fence has no closing fence, a backtick has no partner. So
 * deltas are held to the next boundary where the text stands on its own — the
 * end of a sentence, a line, or a block (`safeFlushLength`) — and a viewer
 * only ever holds something it can render. It also cuts a fast turn from
 * hundreds of frames to a handful.
 *
 * Delivery is unconditional, which is what makes the engines agree: the
 * codex-direct adapter has always streamed its `item/agentMessage/delta` feed,
 * and this puts opencode on the same footing rather than behind a setting.
 * OPENSESSION_OC_STREAM_TEXT=0 is a kill switch for an instance that needs the
 * old whole-part behaviour back without waiting for a deploy.
 */

/**
 * Whether the opencode runner forwards partial assistant text. On unless the
 * kill switch is set. Read per call, never pinned at module load, so flipping
 * it needs only a restart rather than an edit.
 */
export function streamPartialTextEnabled(): boolean {
  return process.env.OPENSESSION_OC_STREAM_TEXT !== "0";
}

/** A fence opener/closer, indented up to three spaces like CommonMark allows. */
const FENCE_LINE = /^ {0,3}(`{3,}|~{3,})/;

/**
 * The end of the last sentence in `line`, or 0 when it holds none. A sentence
 * ends at `.`, `!`, `?` or `:` followed by a space — the cut lands after the
 * space, so the next frame starts a word rather than continuing one.
 */
function lastSentenceEnd(line: string): number {
  for (let i = line.length - 1; i >= 1; i--) {
    if (line[i] !== " ") continue;
    const punctuation = line[i - 1];
    if (punctuation !== "." && punctuation !== "!" && punctuation !== "?" && punctuation !== ":") {
      continue;
    }
    // "e.g. " and friends are not the end of anything worth cutting at.
    if (punctuation === "." && /\b[a-z]$/i.test(line.slice(0, i - 1))) continue;
    return i + 1;
  }
  return 0;
}

/**
 * Whether the inline markdown in `text` is closed: every code span, link and
 * bold run finished. An open one is exactly what makes a half-written reply
 * render wrong — a lone backtick shows as a backtick, `[` swallows the words
 * after it — so text with one open is held back rather than sent.
 *
 * Underscores are not counted: `snake_case` is not emphasis in CommonMark,
 * and treating it as an open run would hold most code-flavoured prose back to
 * its paragraph end.
 */
function inlineClosed(text: string): boolean {
  const body = text.replace(/\\./g, "");
  const backticks = body.match(/`+/g);
  if (backticks && backticks.length % 2 !== 0) return false;
  let brackets = 0;
  for (const ch of body) {
    if (ch === "[") brackets++;
    else if (ch === "]") brackets--;
    if (brackets < 0) brackets = 0;
  }
  if (brackets > 0) return false;
  // An inline link's destination, opened and not yet closed.
  const lastOpen = body.lastIndexOf("](");
  if (lastOpen !== -1 && body.indexOf(")", lastOpen) === -1) return false;
  const bold = body.match(/\*\*/g);
  if (bold && bold.length % 2 !== 0) return false;
  const stars = body.replace(/\*\*/g, "").replace(/^ {0,3}\* /gm, "").match(/\*/g);
  if (stars && stars.length % 2 !== 0) return false;
  return true;
}

/**
 * How much of a block being written can be shown now.
 *
 * Streaming raw deltas types the reply out a token at a time, which is what
 * every viewer then has to render: a paragraph mid-word, a code fence with no
 * closing fence, a backtick with no partner. Markdown that is still being
 * written does not render as itself, so the bubble flickered between raw
 * source and formatted text for the length of the turn.
 *
 * So a frame is cut at a boundary where what has been sent stands on its own:
 * the end of a completed line (or of a code line inside a fence), or the end
 * of a sentence when the paragraph's inline constructs are all closed. Text
 * after the last such boundary is held until the next delta, and a block's
 * completion flushes whatever is left (see `TextPartStream.tail`).
 */
export function safeFlushLength(text: string): number {
  let cut = 0;
  let inFence = false;
  let fence = "";
  let paragraphStart = 0;
  let i = 0;
  while (i < text.length) {
    const newline = text.indexOf("\n", i);
    const end = newline === -1 ? text.length : newline + 1;
    const line = text.slice(i, end);
    if (newline === -1) {
      // The trailing partial line: a sentence inside it is still a boundary.
      if (!inFence) {
        const sentence = lastSentenceEnd(line);
        if (sentence > 0 && inlineClosed(text.slice(paragraphStart, i + sentence))) {
          cut = Math.max(cut, i + sentence);
        }
      }
      break;
    }
    const fenceMark = line.match(FENCE_LINE);
    if (inFence) {
      // Inside a fence every complete line is safe, and the closing fence
      // ends the block.
      if (fenceMark && line.trimStart().startsWith(fence)) {
        inFence = false;
        paragraphStart = end;
      }
      cut = end;
    } else if (fenceMark) {
      // Hold the opening fence: on its own it renders as an empty code block.
      inFence = true;
      fence = fenceMark[1];
    } else if (line.trim() === "") {
      cut = end;
      paragraphStart = end;
    } else if (inlineClosed(text.slice(paragraphStart, end))) {
      cut = end;
    }
    i = end;
  }
  return cut;
}

/**
 * Per-part hold for the text between block boundaries.
 *
 * `push` takes the engine's raw delta and hands back only what can be shown
 * (see `safeFlushLength`); the rest waits for the delta that completes it.
 * The held text is never lost: the part's completion snapshot emits every
 * character the stream has not carried, so `clear` at completion is all the
 * bookkeeping a finished block needs.
 */
export class BlockFlusher {
  private held = new Map<string, string>();

  push(id: string, delta: string): string {
    if (!delta) return "";
    const text = (this.held.get(id) || "") + delta;
    const cut = safeFlushLength(text);
    if (cut <= 0) {
      this.held.set(id, text);
      return "";
    }
    const rest = text.slice(cut);
    if (rest) this.held.set(id, rest);
    else this.held.delete(id);
    return text.slice(0, cut);
  }

  clear(id: string): void {
    this.held.delete(id);
  }

  /** How many parts are holding text (test/diagnostic seam). */
  get size(): number {
    return this.held.size;
  }
}

/**
 * Per-run ledger of how much of each text part has already gone out.
 *
 * The invariant it exists to hold: every chunk emitted for one part
 * concatenates to exactly that part's final text, never more and never less.
 * run-session sums `text_chunk` into the turn's assistant text and the viewers
 * accumulate it into one bubble, so a re-sent prefix would duplicate the reply
 * and a dropped tail would truncate it.
 */
export class TextPartStream {
  private sent = new Map<string, number>();

  /**
   * The not-yet-emitted tail of this part, or "" when there is nothing new.
   * Records the new length, so consecutive calls walk the text forward.
   *
   * Text parts only grow. A body SHORTER than what already went out means the
   * part was rewritten (or re-delivered by a reconnect); there is no way to
   * un-say what the viewers already have, so this yields nothing further for
   * that part and lets the durable transcript entry — which lands at
   * completion and supersedes the live bubble — be the correction.
   */
  tail(id: string, text: unknown): string {
    const body = typeof text === "string" ? text : "";
    const sent = this.sent.get(id) || 0;
    if (body.length <= sent) return "";
    this.sent.set(id, body.length);
    return body.slice(sent);
  }

  /**
   * Record a delta the engine emitted for this part (message.part.delta) and
   * hand it back to be sent. The engine's deltas are a growing prefix of the
   * part's final text, so counting them here is what lets the completion
   * snapshot know it has only the remainder left to say.
   */
  advance(id: string, delta: unknown): string {
    const piece = typeof delta === "string" ? delta : "";
    if (!piece) return "";
    this.sent.set(id, (this.sent.get(id) || 0) + piece.length);
    return piece;
  }

  /** Forget a completed part. The ledger is per-run, so a part that never
   * completes is released with the turn. */
  done(id: string): void {
    this.sent.delete(id);
  }

  /** How many parts are still in flight (test/diagnostic seam). */
  get size(): number {
    return this.sent.size;
  }
}
