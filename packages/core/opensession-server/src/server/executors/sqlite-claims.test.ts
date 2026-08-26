import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SqliteExecutorInstanceClaims } from "./sqlite-claims";

const roots: string[] = [];
function path(): string {
  const root = mkdtempSync(join(tmpdir(), "executor-claims-"));
  roots.push(root);
  return join(root, "claims.sqlite");
}
afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

describe("SqliteExecutorInstanceClaims", () => {
  test("atomically keeps one instance identity for a generation", () => {
    const claims = new SqliteExecutorInstanceClaims(path());
    expect(
      claims.claim({
        source: "runner",
        executorId: "runner-1",
        generation: 4,
        instanceId: "instance-1",
      }),
    ).toBe(true);
    expect(
      claims.claim({
        source: "runner",
        executorId: "runner-1",
        generation: 4,
        instanceId: "instance-1",
      }),
    ).toBe(true);
    expect(
      claims.claim({
        source: "runner",
        executorId: "runner-1",
        generation: 4,
        instanceId: "instance-2",
      }),
    ).toBe(false);
    expect(
      claims.claim({
        source: "runner",
        executorId: "runner-1",
        generation: 5,
        instanceId: "instance-2",
      }),
    ).toBe(true);
    claims.close();
  });

  test("persists claims and fail-closed generation revocations", () => {
    const dbPath = path();
    let claims = new SqliteExecutorInstanceClaims(dbPath);
    expect(
      claims.claim({
        source: "managed",
        executorId: "executor-1",
        generation: 2,
        instanceId: "instance-1",
      }),
    ).toBe(true);
    claims.revokeThrough("managed", "executor-1", 3);
    claims.close();

    claims = new SqliteExecutorInstanceClaims(dbPath);
    expect(
      claims.claim({
        source: "managed",
        executorId: "executor-1",
        generation: 2,
        instanceId: "instance-1",
      }),
    ).toBe(false);
    expect(
      claims.claim({
        source: "managed",
        executorId: "executor-1",
        generation: 3,
        instanceId: "instance-2",
      }),
    ).toBe(false);
    expect(
      claims.claim({
        source: "managed",
        executorId: "executor-1",
        generation: 4,
        instanceId: "instance-2",
      }),
    ).toBe(true);
    claims.close();
  });
});
