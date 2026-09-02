import { describe, expect, test } from "bun:test";
import {
  PASTED_TEXT_THRESHOLD,
  composePastedText,
  pastedTextLineLabel,
  shouldCollapsePastedText,
  type PastedTextAttachment,
} from "./pasted-text";

const attachment = (text: string, id = text): PastedTextAttachment => ({
  id,
  text,
});

describe("pasted text attachments", () => {
  test("collapse starts at 2500 characters", () => {
    expect(
      shouldCollapsePastedText("x".repeat(PASTED_TEXT_THRESHOLD - 1)),
    ).toBe(false);
    expect(shouldCollapsePastedText("x".repeat(PASTED_TEXT_THRESHOLD))).toBe(
      true,
    );
  });

  test("summarizes Unix and Windows line endings", () => {
    expect(pastedTextLineLabel("one")).toBe("+1 line");
    expect(pastedTextLineLabel("one\ntwo\r\nthree\rfour")).toBe("+4 lines");
  });

  test("pasted blocks follow the message behind a divider", () => {
    expect(
      composePastedText("Summarize this", [
        attachment("First block"),
        attachment("Second block"),
      ]),
    ).toBe(
      [
        "Summarize this",
        "---",
        "Pasted text:",
        "First block",
        "---",
        "Pasted text:",
        "Second block",
      ].join("\n\n"),
    );
    expect(composePastedText("Visible", [])).toBe("Visible");
  });

  test("a lone paste goes out bare, later ones still split", () => {
    expect(composePastedText("", [attachment("Only block")])).toBe(
      "Only block",
    );
    expect(
      composePastedText("", [attachment("First"), attachment("Second")]),
    ).toBe("First\n\n---\n\nPasted text:\n\nSecond");
    expect(
      composePastedText("Ask", [attachment("", "empty"), attachment("Body")]),
    ).toBe("Ask\n\n---\n\nPasted text:\n\nBody");
  });
});
