/**
 * Pi engine adapter: the EngineAdapter facade over pi-runner.ts (mirrors
 * opencode-adapter.ts — a conformance mapping, not logic).
 *
 * Delegation map (all real exports of ../pi-runner):
 *  - startTurn              → runPi(opts, model)  (init with the pi session
 *                             id, text_chunk/tool_use/tool_result/
 *                             usage_snapshot, exactly one terminal done or
 *                             error with usageLimitExhausted semantics)
 *  - steer                  → steerPiRun (native session.steer — delivered
 *                             after the current step's in-flight tools,
 *                             before the next LLM call)
 *  - cancel                 → cancelPiRun (aborts the registered handle for
 *                             any alias key; the run drives session.abort)
 *  - isBusy                 → isPiSessionBusy (activeRuns alias lookup)
 *  - reattach               → null by design: pi runs in-process, nothing
 *                             survives a restart — the runner journals
 *                             WITHOUT a serverKey, so boot takes the
 *                             continuation re-prompt path.
 *  - activeDetachedRunCount → 0 (same reason).
 */

import type { EngineAdapter } from "./adapter-types";
import {
  runPi,
  steerPiRun,
  cancelPiRun,
  isPiSessionBusy,
} from "../pi-runner";

export const piAdapter: EngineAdapter = {
  name: "pi",
  startTurn: (opts, model) => runPi(opts, model),
  steer: (id, text, images) => steerPiRun(id, text, images),
  cancel: (id) => cancelPiRun(id),
  isBusy: (id) => isPiSessionBusy(id),
  reattach: async () => null,
  activeDetachedRunCount: () => 0,
};
