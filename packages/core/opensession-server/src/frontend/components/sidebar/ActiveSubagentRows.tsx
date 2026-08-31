import {
  sessionHasOpenPr,
  type ActiveWorkspaceSubagent,
} from "../../lib/sidebar-workspaces";
import {
  SIDEBAR_HOVER_LAYER,
  SIDEBAR_RAIL,
  SIDEBAR_RAIL_GAP,
  SIDEBAR_RAIL_PAD,
  SIDEBAR_STATUS_DOT,
} from "../../lib/sidebar-classes";
import type { UnifiedSession } from "../../lib/types";
import { cn } from "../../ui/cn";
import { IconArrowTurnDownRight } from "../icons";
import { WsPrStatusMark } from "./HoverCards";
import { SIDEBAR_ROW_TITLE } from "./SidebarItem";
import type { CSSProperties } from "react";

function stateLabel(session: UnifiedSession): string {
  if (session.waitingForInput) return "Waiting for input";
  if (session.isRunning) return "Running";
  if ((session.queuedCount ?? 0) > 0) return "Queued";
  if (sessionHasOpenPr(session)) return "PR open";
  return "Idle";
}

/** Active or awaiting-merge workers nested under their selected workspace. */
export function ActiveSubagentRows({
  items,
  selectedId,
  onSelect,
}: {
  items: ActiveWorkspaceSubagent[];
  selectedId: string | null;
  onSelect: (session: UnifiedSession) => void;
}) {
  if (items.length === 0) return null;
  return (
    <div data-active-subagents="">
      {items.map(({ session, depth }) => {
        const selected = session.id === selectedId;
        const label = stateLabel(session);
        const showPrStatus =
          !session.waitingForInput &&
          !session.isRunning &&
          (session.queuedCount ?? 0) === 0 &&
          sessionHasOpenPr(session);
        return (
          <button
            type="button"
            key={session.id}
            className={cn(
              "group relative mt-0.5 flex w-full items-center rounded-row border-0 bg-transparent py-[var(--sidebar-row-pad)] pr-2 text-left text-fg phone:py-[13px]",
              SIDEBAR_RAIL_GAP,
              SIDEBAR_RAIL_PAD,
              SIDEBAR_HOVER_LAYER,
              selected && "bg-selected",
            )}
            // A direct worker's title sits 13px past its parent, enough to
            // read as nested without spending a full icon column on empty
            // space. Deeper levels take two smaller steps, then stop so a
            // long delegation chain keeps room for its title.
            style={
              {
                "--sidebar-icon-left": `${29 + Math.min(depth - 1, 2) * 10}px`,
              } as CSSProperties
            }
            data-active-subagent-row=""
            data-parent-session-id={session.parentSessionId}
            data-selected={selected || undefined}
            aria-current={selected ? "page" : undefined}
            aria-label={`${session.title}, subagent, ${label}`}
            onClick={() => onSelect(session)}
          >
            <span className={cn(SIDEBAR_RAIL, "text-faint")} aria-hidden="true">
              <IconArrowTurnDownRight size={16} />
            </span>
            <span className={SIDEBAR_ROW_TITLE}>{session.title}</span>
            {showPrStatus ? (
              <WsPrStatusMark sessions={[session]} size={16} />
            ) : (
              <span
                className={cn(
                  "size-1.5 shrink-0 rounded-full",
                  session.waitingForInput
                    ? SIDEBAR_STATUS_DOT.waiting
                    : session.isRunning
                      ? SIDEBAR_STATUS_DOT.running
                      : "bg-yellow",
                )}
                aria-hidden="true"
                title={label}
              />
            )}
          </button>
        );
      })}
    </div>
  );
}
