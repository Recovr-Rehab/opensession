export interface ReviewDebounceTiming {
  firstPushAt: number;
  dueAt: number;
}

/** Preserve both the quiet period after the latest push and the burst's max wait. */
export function nextReviewDebounce(
  firstPushAt: number | undefined,
  now: number,
  quietMs: number,
  maxWaitMs: number,
): ReviewDebounceTiming {
  const first =
    typeof firstPushAt === "number" && Number.isFinite(firstPushAt) ? firstPushAt : now;
  return {
    firstPushAt: first,
    dueAt: Math.min(now + quietMs, first + maxWaitMs),
  };
}

export function reviewDebounceDelay(dueAt: number, now: number): number {
  return Math.max(0, dueAt - now);
}
