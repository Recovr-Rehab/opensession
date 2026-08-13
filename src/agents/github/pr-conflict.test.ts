import { beforeEach, describe, expect, test } from "bun:test";
import type { PrInfo } from "../../server/pr-cache";
import {
  conflictMessage,
  resetConflictWatch,
  scanConflictTransitions,
} from "./pr-conflict";

function pr(overrides: Partial<PrInfo> = {}): PrInfo {
  return {
    url: "https://github.com/tellahq/tella-fusion/pull/42",
    state: "OPEN",
    number: 42,
    title: "Test PR",
    isDraft: false,
    additions: 1,
    deletions: 1,
    changedFiles: 1,
    reviewDecision: "",
    author: "author",
    createdAt: "2026-08-01T00:00:00Z",
    updatedAt: "2026-08-01T00:00:00Z",
    checks: { total: 0, passed: 0, failed: 0, pending: 0 },
    mergeable: "MERGEABLE",
    reviewRequested: [],
    reviewedBy: [],
    assignees: [],
    ...overrides,
  };
}

/** One sweep of a single repo whose PR sits on `fix/test`. */
function sweep(mergeable: string, overrides: Partial<PrInfo> = {}) {
  return scanConflictTransitions(
    new Map([["tella-fusion", new Map([["fix/test", pr({ mergeable, ...overrides })]])]]),
    new Set(["tella-fusion"]),
  );
}

describe("scanConflictTransitions", () => {
  beforeEach(() => resetConflictWatch());

  test("fires on MERGEABLE → CONFLICTING", () => {
    expect(sweep("MERGEABLE")).toEqual([]);
    const events = sweep("CONFLICTING");
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      repoId: "tella-fusion",
      branch: "fix/test",
      number: 42,
    });
  });

  test("a PR first seen as CONFLICTING never fires", () => {
    // Restart safety: pre-existing conflicts are adopted silently rather than
    // waking every session at once.
    expect(sweep("CONFLICTING")).toEqual([]);
    expect(sweep("CONFLICTING")).toEqual([]);
  });

  test("fires once, not on every following sweep", () => {
    sweep("MERGEABLE");
    expect(sweep("CONFLICTING")).toHaveLength(1);
    expect(sweep("CONFLICTING")).toEqual([]);
    expect(sweep("CONFLICTING")).toEqual([]);
  });

  test("a flicker through UNKNOWN does not hide the transition", () => {
    // GitHub reports UNKNOWN whenever its background merge test is still
    // running, which is common on the sweep right after a base push.
    sweep("MERGEABLE");
    expect(sweep("UNKNOWN")).toEqual([]);
    expect(sweep("CONFLICTING")).toHaveLength(1);
  });

  test("UNKNOWN alone never fires", () => {
    expect(sweep("UNKNOWN")).toEqual([]);
    expect(sweep("UNKNOWN")).toEqual([]);
  });

  test("re-fires after a conflict is resolved and returns", () => {
    sweep("MERGEABLE");
    expect(sweep("CONFLICTING")).toHaveLength(1);
    sweep("MERGEABLE");
    expect(sweep("CONFLICTING")).toHaveLength(1);
  });

  test("carries the PR body's session ref when it has one", () => {
    sweep("MERGEABLE", { sessionRef: "os-abc" });
    expect(sweep("CONFLICTING", { sessionRef: "os-abc" })[0]?.sessionRef).toBe("os-abc");
  });

  test("ignores PRs that are no longer open", () => {
    sweep("MERGEABLE");
    expect(sweep("CONFLICTING", { state: "MERGED" })).toEqual([]);
  });

  test("ignores repos the sweep did not refresh", () => {
    const data = new Map([
      ["tella-fusion", new Map([["fix/test", pr({ mergeable: "MERGEABLE" })]])],
    ]);
    // A repo whose open-PR query failed is carried forward untouched, so its
    // rows must not be compared against.
    expect(scanConflictTransitions(data, new Set())).toEqual([]);
    data.get("tella-fusion")!.set("fix/test", pr({ mergeable: "CONFLICTING" }));
    expect(scanConflictTransitions(data, new Set())).toEqual([]);
    expect(scanConflictTransitions(data, new Set(["tella-fusion"]))).toEqual([]);
  });

  test("forgets a PR that leaves the open set, so a reopen starts clean", () => {
    sweep("MERGEABLE");
    // Sweep with the PR gone entirely (merged and aged out of the window).
    expect(
      scanConflictTransitions(new Map([["tella-fusion", new Map()]]), new Set(["tella-fusion"])),
    ).toEqual([]);
    expect(sweep("CONFLICTING")).toEqual([]);
  });

  test("tracks the same PR number in two repos independently", () => {
    const data = (fusion: string, backstage: string) =>
      new Map([
        ["tella-fusion", new Map([["fix/test", pr({ mergeable: fusion })]])],
        ["opensession", new Map([["fix/test", pr({ mergeable: backstage })]])],
      ]);
    const fresh = new Set(["tella-fusion", "opensession"]);
    scanConflictTransitions(data("MERGEABLE", "CONFLICTING"), fresh);
    const events = scanConflictTransitions(data("CONFLICTING", "CONFLICTING"), fresh);
    expect(events).toHaveLength(1);
    expect(events[0]?.repoId).toBe("tella-fusion");
  });
});

describe("conflictMessage", () => {
  test("names the PR and tells the session it can finish what it is doing", () => {
    const msg = conflictMessage({
      repoId: "tella-fusion",
      branch: "fix/test",
      number: 42,
      title: "Test PR",
      url: "https://github.com/tellahq/tella-fusion/pull/42",
    });
    expect(msg).toContain("PR #42");
    expect(msg).toContain("finish that first");
    expect(msg).toContain("gh pr view 42 --json baseRefName");
    expect(msg).toContain("Never force-push");
  });
});
