import { activeRunRecords } from "./run-journal";
import type { DurableSessionQuarantine } from "./session-kernel/store";
import type { SessionSafetyState } from "./types";

const OPERATION_LABELS: Record<string, string> = {
  acknowledge: "saving the completed action",
  agent_operation: "an agent action",
  core: "updating session state",
  creation_event: "setting up the session",
  delivery: "delivering a message",
  gateway: "processing a session command",
  run_event: "updating the active run",
  run_state: "recovering the active run",
  timer: "running scheduled work",
  turn: "finishing the current turn",
};

/** Human-facing operation name. The durable command kind stays available to
 * operators through the admin reliability endpoint, never through this view. */
export function safetyOperationLabel(commandKind: string): string {
  const normalized = commandKind.replace(/^store:/, "").replace(/^command:/, "");
  const [kind, operation] = normalized.split(":", 2);
  if (OPERATION_LABELS[kind]) return OPERATION_LABELS[kind];
  if (operation) return operation.replaceAll("_", " ");
  return normalized.replaceAll("_", " ") || "session work";
}

export function automaticSafetyReconciliationRunning(sessionId: string): boolean {
  return activeRunRecords().some(
    (run) => run.osSessionId === sessionId && !!run.claimedAt,
  );
}

export function publicSessionSafety(
  quarantine: DurableSessionQuarantine,
): SessionSafetyState {
  return {
    status: "paused_for_safety",
    explanation:
      "Open Session paused this session because it could not confirm whether the last action finished. Nothing will be retried automatically unless it can be proven safe.",
    automaticReconciliationRunning: automaticSafetyReconciliationRunning(
      quarantine.sessionId,
    ),
    pausedAt: new Date(quarantine.quarantinedAt).toISOString(),
    operation: safetyOperationLabel(quarantine.commandKind),
    repairAvailable: quarantine.repairable,
  };
}
