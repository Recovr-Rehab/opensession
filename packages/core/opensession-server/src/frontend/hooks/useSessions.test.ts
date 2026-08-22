import { describe, expect, test } from "bun:test";
import type { UnifiedSession } from "../lib/types";
import {
  reconcilePendingSessionPatches,
  sessionPatchNeedsAcknowledgement,
} from "./useSessions";

function session(archived: boolean): UnifiedSession {
  return { id: "session-1", archived } as UnifiedSession;
}

describe("reconcilePendingSessionPatches", () => {
  test("keeps the chat's running state applied across a stale list poll", () => {
    const pending = new Map<string, Partial<UnifiedSession>>([
      ["session-1", { isRunning: true, runStartedAt: "2026-08-22T12:00:00Z" }],
    ]);

    const [reconciled] = reconcilePendingSessionPatches(
      [{ ...session(false), isRunning: false }],
      pending,
    );

    expect(reconciled.isRunning).toBe(true);
    expect(reconciled.runStartedAt).toBe("2026-08-22T12:00:00Z");
    expect(pending.has("session-1")).toBe(true);
  });

  test("holds runtime and archive patches until the server acknowledges them", () => {
    expect(sessionPatchNeedsAcknowledgement({ isRunning: true })).toBe(true);
    expect(sessionPatchNeedsAcknowledgement({ archived: true })).toBe(true);
    expect(sessionPatchNeedsAcknowledgement({ title: "Renamed" })).toBe(false);
  });

  test("keeps an optimistic archive applied across a stale poll", () => {
    const pending = new Map<string, Partial<UnifiedSession>>([
      ["session-1", { archived: true, archivedReason: "manual" }],
    ]);

    const [reconciled] = reconcilePendingSessionPatches(
      [session(false)],
      pending,
    );

    expect(reconciled.archived).toBe(true);
    expect(reconciled.archivedReason).toBe("manual");
    expect(pending.has("session-1")).toBe(true);
  });

  test("drops the optimistic patch after the server acknowledges it", () => {
    const pending = new Map<string, Partial<UnifiedSession>>([
      ["session-1", { archived: true, archivedReason: "manual" }],
    ]);
    const acknowledged = {
      ...session(true),
      archivedReason: "manual" as const,
    };

    expect(reconcilePendingSessionPatches([acknowledged], pending)).toEqual([
      acknowledged,
    ]);
    expect(pending.has("session-1")).toBe(false);
  });
});
