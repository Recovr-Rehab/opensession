import type { SphereLifecycle, SphereRecord } from "./state";

export type SphereDesiredState = "awake" | "sleeping" | "destroyed";
export type SphereLifecycleEffect =
  "none" | "wake" | "pause" | "destroy" | "wait" | "repair";

/** Pure projection for a SessionKernel desired-state effect planner. */
export function desiredLifecycleEffect(
  lifecycle: SphereLifecycle,
  desired: SphereDesiredState,
): SphereLifecycleEffect {
  if (desired === "destroyed") return "destroy";
  if (lifecycle === "needs_attention") return "repair";
  if (lifecycle === "preparing" || lifecycle === "waking") return "wait";
  if (desired === "awake") return lifecycle === "awake" ? "none" : "wake";
  return lifecycle === "sleeping" ? "none" : "pause";
}

export function beginTransition(
  record: SphereRecord,
  lifecycle: "preparing" | "waking",
  nowMs: number,
): SphereRecord {
  return {
    ...record,
    instanceGeneration: record.instanceGeneration + 1,
    lifecycle,
    updatedAtMs: nowMs,
    error: undefined,
  };
}

export function settleTransition(
  record: SphereRecord,
  lifecycle: "awake" | "sleeping" | "needs_attention",
  nowMs: number,
  error?: string,
): SphereRecord {
  return {
    ...record,
    lifecycle,
    updatedAtMs: nowMs,
    ...(error ? { error } : { error: undefined }),
  };
}
