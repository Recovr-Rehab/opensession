/**
 * Screen-level notification lanes.
 *
 * Short-lived feedback and live status share the top-center lane. Persistent
 * prompts use the bottom-left desktop shelf; their phone equivalents belong in
 * the app header so they remain visible without covering bottom controls.
 */
export const TRANSIENT_NOTICE_LANE =
	"pointer-events-none fixed right-4 top-[calc(var(--desktop-header-h)+8px)] z-[200] " +
	"phone:inset-x-0 phone:right-auto phone:top-[calc(var(--header-h)+8px)]";

export const PERSISTENT_NOTICE_SHELF =
	"pointer-events-none fixed bottom-2 left-2 z-[9500] flex w-fit " +
	"max-w-[calc(100vw-16px)] flex-col gap-2";

/** Card shared by durable update and desktop-link prompts. */
export const PERSISTENT_NOTICE_CARD =
	"pointer-events-auto flex w-full items-center justify-between gap-2 " +
	"rounded-row border border-[color:var(--composer-border)] bg-[var(--composer-surface)] " +
	"smooth-shadow-md py-1.5 pr-1.5 pl-3 phone:shadow-[var(--composer-shadow)] " +
	"animate-[update-toast-in_var(--dur-lg)_var(--ease)] motion-reduce:animate-none";
