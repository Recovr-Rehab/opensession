import { describe, expect, test } from "bun:test";
import {
  declaredRunFailure,
  hasRunStatusDeclaration,
  isClaudeBridgeLaunchError,
  isClaudeMalformedTerminalError,
  isProviderOverloadError,
  isTransientRunError,
  isUpstreamIdleStallError,
} from "./runner-shared";

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

describe("isClaudeMalformedTerminalError", () => {
  test("matches Claude's malformed user-terminal diagnostic", () => {
    expect(
      isClaudeMalformedTerminalError(
        "Claude Code returned an error result: [ede_diagnostic] result_type=user last_content_type=n/a stop_reason=null\n" +
          "Subprocess stderr: Warning: Custom betas are only available for API key users. Ignoring provided betas.",
      ),
    ).toBe(true);
    expect(
      isTransientRunError(
        "Claude Code returned an error result: [ede_diagnostic] result_type=user last_content_type=n/a stop_reason=null",
      ),
    ).toBe(true);
  });

  test("does not mistake normal Claude errors or model text for the diagnostic", () => {
    expect(isClaudeMalformedTerminalError("Claude Code returned an error result: You've hit your weekly limit")).toBe(false);
    expect(isClaudeMalformedTerminalError("Please explain the ede_diagnostic field")).toBe(false);
    expect(isClaudeMalformedTerminalError("")).toBe(false);
  });
});

describe("status-poll watchdog failures", () => {
  test("recover through the bounded engine continuation path", () => {
    expect(
      isTransientRunError(
        "opencode server stopped answering status polls and refused a health probe — ending the turn " +
          "(engine state preserved; send again to continue)",
      ),
    ).toBe(true);
    expect(
      isTransientRunError(
        "opencode server answered health probes but was too starved to serve status for 10 minutes — " +
          "ending the turn (engine state preserved; send again to continue)",
      ),
    ).toBe(true);
  });

  test("does not treat ordinary poll wording as an engine failure", () => {
    expect(isTransientRunError("the model says status polls are useful")).toBe(false);
    expect(isTransientRunError("health probe results are ready")).toBe(false);
  });
});

describe("isProviderOverloadError", () => {
  test("matches provider-declared overloads", () => {
    expect(isProviderOverloadError("Our servers are currently overloaded. Please try again later.")).toBe(true);
    expect(isProviderOverloadError("overloaded_error")).toBe(true);
  });

  test("does not match unrelated transient failures", () => {
    expect(isProviderOverloadError("socket hang up")).toBe(false);
    expect(isProviderOverloadError("OpenAI usage limit reached")).toBe(false);
  });
});

describe("declaredRunFailure", () => {
  test("a failed declaration is returned with its reason, last line wins", () => {
    expect(declaredRunFailure("summary…\nSCAN STATUS: failed — claude CLI auth failure")).toBe(
      "SCAN STATUS: failed — claude CLI auth failure",
    );
    expect(declaredRunFailure("RUN STATUS: failed — dry pool")).toBe("RUN STATUS: failed — dry pool");
    // A closing ok clears an earlier quoted/failed line.
    expect(
      declaredRunFailure("SCAN STATUS: failed — transient\nretried fine\nSCAN STATUS: ok"),
    ).toBeNull();
  });

  test("ok, absent, and mid-line mentions do not declare failure", () => {
    expect(declaredRunFailure("all good\nSCAN STATUS: ok")).toBeNull();
    expect(declaredRunFailure("no status here")).toBeNull();
    // Not line-anchored ⇒ not a declaration (e.g. quoting the instruction).
    expect(declaredRunFailure("end with `SCAN STATUS: failed — <reason>` on errors")).toBeNull();
  });
});

describe("hasRunStatusDeclaration", () => {
  test("line-anchored status lines only", () => {
    expect(hasRunStatusDeclaration("done\nSCAN STATUS: ok")).toBe(true);
    expect(hasRunStatusDeclaration("done\nRUN STATUS: failed — x")).toBe(true);
    expect(hasRunStatusDeclaration("mentions SCAN STATUS: ok inline")).toBe(false);
    expect(hasRunStatusDeclaration("")).toBe(false);
  });
});
