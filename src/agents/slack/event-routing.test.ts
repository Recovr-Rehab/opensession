import { describe, expect, test } from "bun:test";
import { shouldHandleAppMention } from "./event-routing";

describe("shouldHandleAppMention", () => {
  test("handles user mentions", () => {
    expect(
      shouldHandleAppMention({
        type: "app_mention",
        user: "U123",
        text: "<@U999> help",
      }),
    ).toBe(true);
  });

  test("ignores channel archive system messages", () => {
    expect(
      shouldHandleAppMention({
        type: "app_mention",
        subtype: "channel_archive",
        user: "U999",
        text: "<@U999> archived the channel <#C123>",
      }),
    ).toBe(false);
  });

  test("ignores other app mention system messages", () => {
    expect(
      shouldHandleAppMention({
        type: "app_mention",
        subtype: "channel_unarchive",
        user: "U999",
        text: "<@U999> unarchived the channel <#C123>",
      }),
    ).toBe(false);
  });
});
