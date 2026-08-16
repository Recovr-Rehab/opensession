import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { runDirectSmokeDriver } from "./direct-smoke";
import type { StreamEvent } from "./adapter-types";

function options(overrides: Record<string, unknown> = {}) {
  const root = mkdtempSync(join(tmpdir(), "opensession-direct-smoke-"));
  return {
    root,
    value: {
      startedAt: Date.now(),
      enabled: true,
      dryRun: false,
      sessionId: "os-test-direct-smoke",
      model: "test-model",
      cwd: join(root, "smoke"),
      dryRunReason: "dry run",
      disabledReason: "disabled",
      cancel: () => {},
      storeRows: () => 3,
      startTurn: async function* (): AsyncIterable<StreamEvent> {
        yield { type: "init", sessionId: "engine-session" } as StreamEvent;
        yield { type: "text_chunk", text: "hel" } as StreamEvent;
        yield { type: "text_chunk", text: "lo" } as StreamEvent;
        yield { type: "done", usage: { inputTokens: 1 } } as StreamEvent;
      },
      ...overrides,
    },
  };
}

describe("runDirectSmokeDriver", () => {
  test("collects the common direct-adapter smoke result", async () => {
    const fixture = options();
    try {
      const result = await runDirectSmokeDriver(fixture.value);
      expect(result.ok).toBe(true);
      expect(result.engineSessionId).toBe("engine-session");
      expect(result.eventTypes).toEqual(["init", "text_chunk", "text_chunk", "done"]);
      expect(result.text).toBe("hello");
      expect(result.usage?.inputTokens).toBe(1);
      expect(result.storeRows).toBe(3);
    } finally {
      rmSync(fixture.root, { recursive: true, force: true });
    }
  });

  test("an enabled dry run does not start, cancel, or inspect the store", async () => {
    let calls = 0;
    const fixture = options({
      dryRun: true,
      startTurn: () => {
        calls++;
        throw new Error("must not start");
      },
      cancel: () => calls++,
      storeRows: () => {
        calls++;
        return 1;
      },
    });
    try {
      const result = await runDirectSmokeDriver(fixture.value);
      expect(result.ok).toBe(true);
      expect(result.dryRun).toBe(true);
      expect(result.reason).toBe("dry run");
      expect(calls).toBe(0);
    } finally {
      rmSync(fixture.root, { recursive: true, force: true });
    }
  });

  test("turn and store failures are reported rather than thrown", async () => {
    const fixture = options({
      startTurn: async function* (): AsyncIterable<StreamEvent> {
        throw new Error("turn failed");
      },
      storeRows: () => {
        throw new Error("store failed");
      },
    });
    try {
      const result = await runDirectSmokeDriver(fixture.value);
      expect(result.ok).toBe(false);
      expect(result.error).toBe("turn failed");
      expect(result.storeRows).toBe(0);
    } finally {
      rmSync(fixture.root, { recursive: true, force: true });
    }
  });
});
