import { describe, expect, test } from "bun:test";
import { publicSessionSafety, safetyOperationLabel } from "./session-safety";

describe("public session safety state", () => {
  test("explains quarantine without exposing internal failure text", () => {
    const safety = publicSessionSafety({
      sessionId: "safety-session",
      reason: "SQLITE_IOERR secret internal path",
      commandKind: "turn:settle_outcome_projection",
      quarantinedAt: Date.parse("2026-08-26T12:00:00.000Z"),
      repairable: false,
    });

    expect(safety).toMatchObject({
      status: "paused_for_safety",
      automaticReconciliationRunning: false,
      pausedAt: "2026-08-26T12:00:00.000Z",
      operation: "finishing the current turn",
      repairAvailable: false,
    });
    expect(safety.explanation).not.toContain("SQLITE");
    expect(safety.explanation).toContain("paused");
  });

  test("turns actor command kinds into readable operations", () => {
    expect(safetyOperationLabel("delivery:ack_dispatch")).toBe("delivering a message");
    expect(safetyOperationLabel("run_state:reattaching")).toBe("recovering the active run");
  });
});
