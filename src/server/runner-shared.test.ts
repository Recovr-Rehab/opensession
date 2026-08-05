import { describe, expect, test } from "bun:test";
import { isClaudeBridgeLaunchError, isUpstreamIdleStallError } from "./runner-shared";

describe("isClaudeBridgeLaunchError", () => {
  test("matches the two shapes the agent SDK emits", () => {
    expect(
      isClaudeBridgeLaunchError(
        "Claude Code native binary at /home/ubuntu/projects/opensession/node_modules/.bin/claude exists but failed to launch.",
      ),
    ).toBe(true);
    expect(
      isClaudeBridgeLaunchError(
        "Claude Code native binary not found at /opt/claude. Please ensure Claude Code is installed via native installer.",
      ),
    ).toBe(true);
  });

  test("does not claim faults that belong to another recovery lane", () => {
    // Usage limits and subscription faults are account-level and own their own
    // (much longer) sideline; a model's own words about a launch must never
    // wedge the account either.
    expect(isClaudeBridgeLaunchError("Claude AI usage limit reached")).toBe(false);
    expect(
      isClaudeBridgeLaunchError("Claude Max subscription issue. Check your subscription status."),
    ).toBe(false);
    expect(isClaudeBridgeLaunchError("the deploy script failed to launch the server")).toBe(false);
    expect(isClaudeBridgeLaunchError("command not found: claude")).toBe(false);
    expect(isClaudeBridgeLaunchError("")).toBe(false);
  });
});

describe("isUpstreamIdleStallError", () => {
  test("matches Meridian's idle-guard kill", () => {
    // The exact shape from the 2026-08-03 bks-019fc819 incident.
    expect(isUpstreamIdleStallError("Upstream stalled: no data for 160090ms")).toBe(true);
    expect(
      isUpstreamIdleStallError("AI_APICallError: Upstream stalled: no data for 91150ms"),
    ).toBe(true);
  });

  test("does not match other stalls or provider errors", () => {
    expect(isUpstreamIdleStallError("Claude AI usage limit reached")).toBe(false);
    expect(isUpstreamIdleStallError("upstream timeout while connecting")).toBe(false);
    expect(isUpstreamIdleStallError("no data received")).toBe(false);
    expect(isUpstreamIdleStallError("")).toBe(false);
  });
});
