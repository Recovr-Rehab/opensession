/**
 * Streaming assistant text as the model produces it: the personal opt-in, and
 * the bookkeeping that makes partial delivery safe.
 *
 * The opencode engine mirrors a text part into the UI only once the part is
 * COMPLETE (makePartMirror in opencode-runner.ts gates on `part.time?.end`),
 * so the whole reply lands in one `stream_text` frame and the transcript looks
 * frozen until the model stops. Turning this on makes the runner forward each
 * growing text part as a delta instead, which is what every client already
 * expects `stream_text` to be.
 *
 * It is per-user rather than global because it changes the shape of the live
 * wire traffic for every watcher of a run, and a fast model can push tens of
 * frames a second. Scope: the RUN'S user decides, not the viewer — a session
 * is broadcast to all its watchers on one channel, so this reads as "my runs
 * stream" rather than "I see streaming". Automations pass no user and stay on
 * the whole-part path.
 */

import { getUiPrefs } from "./ui-prefs";

/** Key inside the per-user ui-prefs map (also written by the web Settings). */
export const STREAM_TEXT_PREF_KEY = "stream-text";

/**
 * Whether this user's runs stream partial assistant text. Opt-in: anything
 * other than a stored "on" keeps the existing whole-part behavior, so an
 * unknown/absent user (automation, auto-continue with no author) is off.
 */
export function streamPartialTextEnabled(user?: string | null): boolean {
  return getUiPrefs(user || "Anonymous")[STREAM_TEXT_PREF_KEY] === "on";
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
