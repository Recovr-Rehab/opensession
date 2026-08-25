import { describe, expect, test } from "bun:test";
import type { ExecutorFence } from "@tellahq/opensession-protocol/executor";
import { ExecutorGrantAuthority } from "./grants";

const scope = {
  rootId: "root-1",
  sessionId: "session-1",
  runId: "run-1",
  generation: 4,
  expiresAtMs: 2_000,
};

function fence(overrides: Partial<ExecutorFence> = {}): ExecutorFence {
  return {
    rootId: "root-1",
    sessionId: "session-1",
    runId: "run-1",
    generation: 4,
    deadlineMs: 1_500,
    ...overrides,
  };
}

describe("ExecutorGrantAuthority", () => {
  test("uses opaque random tokens and validates the full scope", () => {
    const authority = new ExecutorGrantAuthority({ now: () => 1_000 });
    const first = authority.issue(scope);
    const second = authority.issue(scope);
    expect(first).not.toBe(second);
    expect(first).not.toContain(scope.rootId);
    expect(authority.validate(first, fence())).toEqual(scope);

    for (const changed of [
      { rootId: "root-2" },
      { sessionId: "session-2" },
      { runId: "run-2" },
    ]) {
      expect(() => authority.validate(first, fence(changed))).toThrow(
        "does not authorize",
      );
    }
    expect(() => authority.validate(first, fence({ generation: 5 }))).toThrow(
      "generation is stale",
    );
  });

  test("expires, revokes, and revokes one generation without timers", () => {
    let now = 1_000;
    const authority = new ExecutorGrantAuthority({ now: () => now });
    const expired = authority.issue(scope);
    now = 2_000;
    expect(() => authority.validate(expired, fence())).toThrow("expired");

    now = 1_000;
    const revoked = authority.issue(scope);
    expect(authority.revoke(revoked)).toBe(true);
    expect(() => authority.validate(revoked, fence())).toThrow(
      "invalid or revoked",
    );

    const generation4 = authority.issue(scope);
    const generation5 = authority.issue({ ...scope, generation: 5 });
    expect(authority.revokeGeneration(scope)).toBe(1);
    expect(() => authority.validate(generation4, fence())).toThrow();
    expect(
      authority.validate(generation5, fence({ generation: 5 })).generation,
    ).toBe(5);
  });

  test("bounds live grant count and prunes expired grants on issue", () => {
    let now = 1_000;
    const authority = new ExecutorGrantAuthority({
      now: () => now,
      maxGrants: 1,
    });
    authority.issue(scope);
    expect(() => authority.issue(scope)).toThrow("capacity");
    now = 2_000;
    expect(authority.issue({ ...scope, expiresAtMs: 3_000 })).toBeString();
    expect(authority.size).toBe(1);
  });
});
