import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { defaultRepo } from "../../server/config";
import type { SessionControl, SessionSummary } from "../../server/session-control";
import {
  candidateSessions,
  claimShippedChangeAnnouncement,
  selectShippedVisualChange,
  settleShippedChangeAnnouncement,
  shippedChangeOneLiner,
  validWalkthroughScreenshot,
} from "./shipped-change-notify";

const scratch: string[] = [];

afterEach(() => {
  for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function session(
  id: string,
  publishedAt: string,
  shots: Array<{ before?: string; after?: string }>,
): SessionSummary {
  return {
    id,
    state: "idle",
    queuedCount: 0,
    controllable: false,
    repo: defaultRepo().id,
    branch: "visual-branch",
    worktreeDir: defaultRepo().repo,
    walkthrough: { summary: `Why ${id} matters.`, publishedAt, shots },
  } as SessionSummary;
}

describe("shipped visual change selection", () => {
  test("prefers the PR-attributed session's after screenshot", () => {
    const older = session("preferred", "2026-08-10T10:00:00Z", [
      { before: "/tmp/before.png", after: "/tmp/preferred.png" },
    ]);
    const newer = session("newer", "2026-08-11T10:00:00Z", [
      { after: "/tmp/newer.png" },
    ]);

    expect(
      selectShippedVisualChange([newer, older], "preferred", () => true),
    ).toEqual({
      sessionId: "preferred",
      screenshot: "/tmp/preferred.png",
      summary: "Why preferred matters.",
    });
  });

  test("falls back to the newest valid visual proof", () => {
    const textOnly = session("text-only", "2026-08-12T10:00:00Z", [
      { before: "/tmp/before.png" },
    ]);
    const missing = session("missing", "2026-08-11T10:00:00Z", [
      { after: "/tmp/missing.png" },
    ]);
    const valid = session("valid", "2026-08-10T10:00:00Z", [
      { after: "/tmp/valid.png" },
    ]);

    expect(
      selectShippedVisualChange(
        [valid, textOnly, missing],
        undefined,
        (path) => path === "/tmp/valid.png",
      )?.sessionId,
    ).toBe("valid");
  });

  test("does not trust a PR body session link outside the matching branch", () => {
    const matched = session("matched", "2026-08-10T10:00:00Z", [
      { after: "/tmp/matched.png" },
    ]);
    const unrelated = {
      ...session("unrelated", "2026-08-11T10:00:00Z", [
        { after: "/tmp/unrelated.png" },
      ]),
      branch: "another-branch",
    };
    const control = {
      listSessions: () => [unrelated, matched],
    } as SessionControl;

    expect(
      candidateSessions(control, defaultRepo().id, "visual-branch", "unrelated").map(
        (candidate) => candidate.id,
      ),
    ).toEqual([]);
    expect(
      candidateSessions(control, defaultRepo().id, "visual-branch", "matched").map(
        (candidate) => candidate.id,
      ),
    ).toEqual(["matched"]);
    expect(candidateSessions(control, defaultRepo().id, "visual-branch")).toEqual([]);
  });

  test("accepts only bounded images inside the session walkthrough directory", () => {
    const root = mkdtempSync(join(tmpdir(), "shipped-change-assets-"));
    scratch.push(root);
    const sessionDir = join(root, "walkthrough", "safe-session");
    mkdirSync(sessionDir, { recursive: true });
    const inside = join(sessionDir, "after.png");
    const outside = join(root, "outside.png");
    writeFileSync(inside, "png");
    writeFileSync(outside, "png");

    expect(validWalkthroughScreenshot(inside, "safe-session", root)).toBe(true);
    expect(validWalkthroughScreenshot(outside, "safe-session", root)).toBe(false);
  });
});

describe("shipped change copy", () => {
  test("uses the first prose paragraph and strips markdown", () => {
    expect(
      shippedChangeOneLiner(
        "## What changed\n\n**Tabs** now stay visible through [navigation](https://example.com).\nThey are easier to find.\n\nVerified on mobile.",
      ),
    ).toBe("Tabs now stay visible through navigation. They are easier to find.");
  });

  test("truncates long copy on a word boundary", () => {
    const result = shippedChangeOneLiner("A visual improvement that makes the editor easier to scan.", 34);
    expect(result).toBe("A visual improvement that makes…");
    expect(result.length).toBeLessThanOrEqual(34);
  });

  test("does not announce without a prose explanation", () => {
    expect(shippedChangeOneLiner("## Screenshot only")).toBe("");
  });
});

describe("shipped change announcement receipts", () => {
  test("deduplicates a sent merge and releases failed claims", () => {
    const root = mkdtempSync(join(tmpdir(), "shipped-change-state-"));
    scratch.push(root);
    const statePath = join(root, "state.json");
    const key = "tellahq/example#12@abc";
    const claim = claimShippedChangeAnnouncement(key, statePath, 1_000);
    expect(claim).toBeString();
    expect(claimShippedChangeAnnouncement(key, statePath, 1_001)).toBeNull();
    settleShippedChangeAnnouncement(key, claim!, true, "session-1", statePath);
    expect(claimShippedChangeAnnouncement(key, statePath, 2_000)).toBeNull();

    const retryKey = "tellahq/example#13@def";
    const failed = claimShippedChangeAnnouncement(retryKey, statePath, 3_000)!;
    settleShippedChangeAnnouncement(retryKey, failed, false, undefined, statePath);
    expect(claimShippedChangeAnnouncement(retryKey, statePath, 3_001)).toBeString();
  });
});
