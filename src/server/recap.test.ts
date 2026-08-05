import { describe, expect, it } from "bun:test";
import { sanitizeRecap } from "./recap";

describe("sanitizeRecap", () => {
  it("passes a clean recap through unchanged", () => {
    const t =
      "We built and shipped the recap feature. Next: open a session to see it.";
    expect(sanitizeRecap(t)).toBe(t);
  });

  it("strips wrapping, a model-added prefix, and stray markers", () => {
    expect(
      sanitizeRecap('```\nrecap: "We shipped it. Next: try it."\n```'),
    ).toBe("We shipped it. Next: try it.");
    expect(sanitizeRecap("<recap>We shipped it.</recap>")).toBe(
      "We shipped it.",
    );
  });

  it("collapses whitespace to one line", () => {
    expect(sanitizeRecap("We shipped it.\n\nNext:  try\tit.")).toBe(
      "We shipped it. Next: try it.",
    );
  });

  it("rejects empty/degenerate output", () => {
    expect(sanitizeRecap(null)).toBeNull();
    expect(sanitizeRecap("")).toBeNull();
    expect(sanitizeRecap('"  "')).toBeNull();
    expect(sanitizeRecap("ok")).toBeNull();
  });

  it("clips runaway output at a word boundary", () => {
    const out = sanitizeRecap(`${"word ".repeat(300)}end`);
    expect(out).not.toBeNull();
    expect(out!.length).toBeLessThanOrEqual(601);
    expect(out!.endsWith("…")).toBe(true);
  });
});
