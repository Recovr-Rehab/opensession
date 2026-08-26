import { useState } from "react";
import type { SessionSafetyState } from "../lib/types";
import { fullTime } from "../lib/time";
import { Button } from "../ui/button";
import { IconShieldCheck } from "./icons";

export function SessionSafetyNotice({
  safety,
  onContinue,
  onRepair,
}: {
  safety: SessionSafetyState;
  onContinue: () => void;
  onRepair?: () => Promise<void>;
}) {
  const [repairing, setRepairing] = useState(false);
  const [repairError, setRepairError] = useState<string | null>(null);

  return (
    <section
      aria-labelledby="session-safety-title"
      className="mx-auto my-4 w-full max-w-[52rem] rounded-xl bg-yellow-soft p-4 text-fg phone:my-3 phone:rounded-lg"
    >
      <div className="flex items-start gap-3">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-control bg-panel text-yellow">
          <IconShieldCheck size={22} />
        </div>
        <div className="min-w-0 flex-1">
          <h2 id="session-safety-title" className="m-0 text-item-title font-semibold">
            Paused for safety
          </h2>
          <p className="mt-1 text-body leading-relaxed text-dim">{safety.explanation}</p>
          <dl className="mt-3 grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1 text-supporting phone:grid-cols-1 phone:gap-y-0.5">
            <dt className="text-faint">Automatic checks</dt>
            <dd className="m-0 text-dim">
              {safety.automaticReconciliationRunning
                ? "Still checking what completed"
                : "Stopped until you choose a safe next step"}
            </dd>
            <dt className="text-faint">Affected action</dt>
            <dd className="m-0 text-dim">{safety.operation}</dd>
            <dt className="text-faint">Paused</dt>
            <dd className="m-0 text-dim">
              <time dateTime={safety.pausedAt}>{fullTime(safety.pausedAt)}</time>
            </dd>
          </dl>
          {repairError && (
            <p role="alert" className="mt-3 text-supporting text-red">
              {repairError}
            </p>
          )}
          <div className="mt-4 flex flex-wrap items-center gap-2 phone:flex-col phone:items-stretch">
            <Button variant="primary" size="lg" onClick={onContinue}>
              Continue in a new session
            </Button>
            {onRepair && safety.repairAvailable && (
              <Button
                size="lg"
                disabled={repairing}
                onClick={() => {
                  setRepairing(true);
                  setRepairError(null);
                  void onRepair()
                    .catch((error) =>
                      setRepairError(
                        error instanceof Error
                          ? error.message
                          : "This session could not be repaired safely.",
                      ),
                    )
                    .finally(() => setRepairing(false));
                }}
              >
                {repairing ? "Checking evidence…" : "Repair session"}
              </Button>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
