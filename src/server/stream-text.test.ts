import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  STREAM_TEXT_PREF_KEY,
  TextPartStream,
  streamPartialTextEnabled,
} from "./stream-text";
import { patchUiPrefs } from "./ui-prefs";

const originalStateDir = process.env.OPENSESSION_STATE_DIR;
let tempDir: string | undefined;

/** Point the per-user stores at a scratch dir. user-store resolves the
 * directory per call precisely so a test can do this without touching the
 * live operator's prefs. */
function useTempState(): void {
  tempDir = mkdtempSync(join(tmpdir(), "opensession-stream-text-"));
  process.env.OPENSESSION_STATE_DIR = tempDir;
}

afterEach(() => {
  if (originalStateDir === undefined) delete process.env.OPENSESSION_STATE_DIR;
  else process.env.OPENSESSION_STATE_DIR = originalStateDir;
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  tempDir = undefined;
});

describe("TextPartStream", () => {
  test("walks a growing part forward, emitting each tail once", () => {
    const stream = new TextPartStream();
    expect(stream.tail("p1", "Hel")).toBe("Hel");
    expect(stream.tail("p1", "Hello")).toBe("lo");
    expect(stream.tail("p1", "Hello there")).toBe(" there");
  });

  test("emits nothing when a part has not grown", () => {
    const stream = new TextPartStream();
    expect(stream.tail("p1", "same")).toBe("same");
    expect(stream.tail("p1", "same")).toBe("");
    expect(stream.tail("p1", "")).toBe("");
  });

  test("deltas plus the completion tail equal the finished text exactly", () => {
    // The load-bearing invariant: run-session sums text_chunk into the turn's
    // assistant text, so a re-sent prefix duplicates and a lost tail truncates.
    const stream = new TextPartStream();
    const final = "The quick brown fox jumps over the lazy dog";
    const emitted: string[] = [];
    for (let i = 4; i < final.length; i += 7) {
      emitted.push(stream.tail("p1", final.slice(0, i)));
    }
    emitted.push(stream.tail("p1", final)); // completion
    expect(emitted.join("")).toBe(final);
  });

  test("counts engine deltas so completion only says the remainder", () => {
    // The real shape of a turn: message.part.delta carries the text as it is
    // written, then message.part.updated publishes the finished part. Saying
    // the whole part again at the end would double the reply.
    const stream = new TextPartStream();
    const final = "Hello there, world";
    const sent: string[] = [];
    sent.push(stream.advance("p1", "Hello "));
    sent.push(stream.advance("p1", "there, "));
    sent.push(stream.tail("p1", final)); // the completion snapshot
    expect(sent.join("")).toBe(final);
    expect(sent.at(-1)).toBe("world");
  });

  test("a fully streamed part adds nothing at completion", () => {
    const stream = new TextPartStream();
    stream.advance("p1", "all of it");
    expect(stream.tail("p1", "all of it")).toBe("");
  });

  test("ignores empty and non-string deltas", () => {
    const stream = new TextPartStream();
    expect(stream.advance("p1", "")).toBe("");
    expect(stream.advance("p1", undefined)).toBe("");
    expect(stream.advance("p1", 42)).toBe("");
    // None of that counted, so the whole text still has to go out.
    expect(stream.tail("p1", "real text")).toBe("real text");
  });

  test("a part nobody streamed yields its whole text at completion", () => {
    // The pref-off path: the mirror calls tail() once, at part end.
    const stream = new TextPartStream();
    expect(stream.tail("p1", "a whole block")).toBe("a whole block");
  });

  test("stops emitting when a part shrinks instead of re-sending text", () => {
    const stream = new TextPartStream();
    expect(stream.tail("p1", "abcdef")).toBe("abcdef");
    // A rewritten or re-delivered part: nothing can un-say what already went
    // out, so the durable entry is left to correct it.
    expect(stream.tail("p1", "abc")).toBe("");
    expect(stream.tail("p1", "abcdef")).toBe("");
  });

  test("tracks parts independently and releases them on done", () => {
    const stream = new TextPartStream();
    stream.tail("p1", "first");
    stream.tail("p2", "second");
    expect(stream.size).toBe(2);
    expect(stream.tail("p2", "second block")).toBe(" block");
    stream.done("p1");
    stream.done("p2");
    expect(stream.size).toBe(0);
    // A recycled id starts clean.
    expect(stream.tail("p1", "first")).toBe("first");
  });
});

describe("streamPartialTextEnabled", () => {
  test("is off unless the user opted in", () => {
    useTempState();
    expect(streamPartialTextEnabled("Nobody")).toBe(false);
    expect(streamPartialTextEnabled(undefined)).toBe(false);
    expect(streamPartialTextEnabled(null)).toBe(false);
    expect(streamPartialTextEnabled("")).toBe(false);
  });

  test("is on for the user who stored it, and only for them", () => {
    useTempState();
    patchUiPrefs("Michiel", { [STREAM_TEXT_PREF_KEY]: "on" });
    expect(streamPartialTextEnabled("Michiel")).toBe(true);
    expect(streamPartialTextEnabled("Someone else")).toBe(false);
  });

  test("treats any other stored value as off", () => {
    useTempState();
    patchUiPrefs("Michiel", { [STREAM_TEXT_PREF_KEY]: "off" });
    expect(streamPartialTextEnabled("Michiel")).toBe(false);
    patchUiPrefs("Michiel", { [STREAM_TEXT_PREF_KEY]: "true" });
    expect(streamPartialTextEnabled("Michiel")).toBe(false);
  });
});
