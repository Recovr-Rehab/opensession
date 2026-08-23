import type { ReactNode } from "react";
import { WS_SUMMARY_REVIEW_BAR_CLEARANCE } from "../../lib/workspace-summary-classes";

/**
 * The floating review toolbar shared by branches with and without a pull
 * request. It stays edge to edge on phone and clears the standing workspace
 * summary on wide review canvases. The sticky outer surface also masks code
 * scrolling through the insets around the bordered toolbar.
 */
export function ReviewToolbar({
  children,
  compact,
}: {
  children: ReactNode;
  compact: boolean;
}) {
  const placement = compact
    ? `sticky top-0 z-20 desktop:mb-0 desktop:ml-2 desktop:pb-2 desktop:after:pointer-events-none desktop:after:absolute desktop:after:inset-x-0 desktop:after:top-full desktop:after:h-3 desktop:after:[background:linear-gradient(to_bottom,var(--bg)_0%,transparent_100%)] desktop:after:content-[''] ${WS_SUMMARY_REVIEW_BAR_CLEARANCE}`
    : "desktop:mx-2 desktop:mb-2";

  return (
    <div className={`relative shrink-0 bg-surface ${placement}`}>
      <div
        className={`relative bg-surface desktop:mt-2.5 desktop:rounded-lg desktop:border desktop:border-line ${compact ? "desktop:overflow-hidden" : "desktop:overflow-visible"}`}
      >
        {children}
      </div>
    </div>
  );
}
