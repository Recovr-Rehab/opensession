import { describe, expect, it } from "bun:test";
import { featurebaseMentionRe } from "./mention";

describe("featurebaseMentionRe", () => {
  const re = featurebaseMentionRe("sam");

  it("matches a complete handle with or without @", () => {
    expect(re.test("@sam please look")).toBe(true);
    expect(re.test("hey sam, please look")).toBe(true);
  });

  it("does not match the handle as a prefix of a longer word", () => {
    expect(re.test("@samantha please look")).toBe(false);
    expect(re.test("sample note")).toBe(false);
  });
});
