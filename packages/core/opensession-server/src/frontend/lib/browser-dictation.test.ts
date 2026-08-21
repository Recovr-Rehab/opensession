import { describe, expect, test } from "bun:test";
import { speechResultsText } from "./browser-dictation";

function results(...transcripts: string[]) {
  return transcripts.map((transcript, index) => ({
    0: { transcript },
    isFinal: index < transcripts.length - 1,
    length: 1,
  }));
}

describe("speechResultsText", () => {
  test("joins final and interim browser results", () => {
    expect(speechResultsText(results("Open the pull request.", "Then review it"))).toBe(
      "Open the pull request. Then review it",
    );
  });

  test("normalizes service whitespace without changing words", () => {
    expect(speechResultsText(results("  First thought ", " and another  "))).toBe(
      "First thought and another",
    );
  });

  test("ignores an empty recognition result", () => {
    expect(speechResultsText(results("", "Keep this"))).toBe("Keep this");
  });
});
