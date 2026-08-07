import { checkClass, formatCheckDuration } from "../../lib/pr-status-derive";
import type { PrCheck } from "../../lib/types";

export function CheckRow({ check }: { check: PrCheck }) {
  const cls = checkClass(check.status, check.conclusion);
  const mark = cls === "check-success" ? "✓" : cls === "check-failure" ? "✕" : "●";
  const duration = formatCheckDuration(check);
  return (
    <div className="pr-check pr-check-row">
      <a className="pr-check-main" href={check.url} target="_blank" rel="noopener">
        <span className={`pr-check-mark ${cls}-text ${cls === "check-pending" ? "pr-check-mark-pending" : ""}`}>
          {mark}
        </span>
        <span className="pr-check-name">{check.name}</span>
        {duration && <span className="pr-check-duration">{duration}</span>}
        {check.url && <span className="pr-check-open">↗</span>}
      </a>
    </div>
  );
}
