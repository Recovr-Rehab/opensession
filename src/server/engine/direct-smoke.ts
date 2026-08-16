import { mkdirSync } from "fs";
import type { StreamEvent, TurnUsage } from "./adapter-types";

export interface DirectSmokeResult {
  ok: boolean;
  enabled: boolean;
  dryRun: boolean;
  reason?: string;
  sessionId: string;
  engineSessionId?: string;
  model: string;
  eventTypes: string[];
  text: string;
  error?: string;
  usage?: TurnUsage;
  timedOut: boolean;
  durationMs: number;
  storeRows: number;
}

interface DirectSmokeDriverOptions {
  startedAt: number;
  enabled: boolean;
  dryRun: boolean;
  timeoutMs?: number;
  sessionId: string;
  model: string;
  cwd: string;
  dryRunReason: string;
  disabledReason: string;
  startTurn: () => AsyncIterable<StreamEvent>;
  cancel: () => void;
  storeRows: () => number;
}

/**
 * Drive a direct adapter's smoke stream. Gate bypass state deliberately stays
 * outside this helper so each adapter remains the only code able to arm it.
 */
export async function runDirectSmokeDriver(
  opts: DirectSmokeDriverOptions
): Promise<DirectSmokeResult> {
  const timeoutMs = Math.max(5_000, Math.min(opts.timeoutMs ?? 120_000, 600_000));

  if (opts.enabled && opts.dryRun) {
    return {
      ok: true,
      enabled: true,
      dryRun: true,
      reason: opts.dryRunReason,
      sessionId: opts.sessionId,
      model: opts.model,
      eventTypes: [],
      text: "",
      timedOut: false,
      durationMs: Date.now() - opts.startedAt,
      storeRows: 0,
    };
  }

  if (opts.enabled) {
    try {
      mkdirSync(opts.cwd, { recursive: true });
    } catch {}
  }

  const eventTypes: string[] = [];
  let text = "";
  let error: string | undefined;
  let usage: TurnUsage | undefined;
  let engineSessionId: string | undefined;
  let done = false;
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    opts.cancel();
  }, timeoutMs);

  try {
    for await (const event of opts.startTurn()) {
      eventTypes.push(event.type);
      if (event.type === "init") engineSessionId = event.sessionId;
      if (event.type === "text_chunk") text += event.text || "";
      if (event.type === "error") error = event.content;
      if (event.type === "done") {
        usage = event.usage;
        done = true;
      }
    }
  } catch (cause) {
    error = String((cause as Error)?.message || cause);
  } finally {
    clearTimeout(timer);
  }

  let storeRows = 0;
  if (opts.enabled) {
    try {
      storeRows = opts.storeRows();
    } catch {}
  }

  return {
    ok: done && !timedOut && !error,
    enabled: opts.enabled,
    dryRun: !opts.enabled,
    reason: !opts.enabled
      ? opts.disabledReason
      : timedOut
        ? `smoke turn exceeded the ${timeoutMs}ms wall cap and was cancelled`
        : undefined,
    sessionId: opts.sessionId,
    engineSessionId,
    model: opts.model,
    eventTypes,
    text,
    error,
    usage,
    timedOut,
    durationMs: Date.now() - opts.startedAt,
    storeRows,
  };
}
