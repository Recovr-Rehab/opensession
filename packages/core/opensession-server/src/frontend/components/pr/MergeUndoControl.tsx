import { cn } from "../../ui/cn";
import { IconUndo } from "../icons";

/** The merge button's five-second inline result and its reversal. */
export function MergeUndoControl({
  onUndo,
  compact = false,
  className,
}: {
  onUndo: () => void;
  compact?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "inline-flex shrink-0 items-stretch whitespace-nowrap rounded-control bg-control text-dim",
        compact ? "min-h-[22px] p-0.5" : "min-h-8 p-1 phone:min-h-11",
        className,
      )}
    >
      <span
        aria-live="polite"
        className={cn(
          "flex items-center font-medium",
          compact ? "px-1.5 text-meta" : "px-2 text-label",
        )}
      >
        PR merged
      </span>
      <button
        type="button"
        onClick={onUndo}
        title="Cancel the scheduled merge"
        className={cn(
          "focus-ring inline-flex cursor-pointer items-center justify-center gap-1 rounded-md bg-button font-semibold text-fg smooth-shadow-xs transition-[background-color,transform] duration-150 hover:bg-hover active:scale-[0.96]",
          compact
            ? "min-h-[18px] px-1.5 text-meta"
            : "min-h-6 px-2 text-label phone:min-h-9 phone:px-3",
        )}
      >
        <IconUndo size={compact ? 13 : 15} className="shrink-0 text-dim" />
        Undo
      </button>
    </div>
  );
}
