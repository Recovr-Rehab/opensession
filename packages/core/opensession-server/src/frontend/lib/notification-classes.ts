/**
 * Screen-level notification lanes.
 *
 * Live status stays near the app header. Toast receipts sit above the composer,
 * where they confirm an action without pulling attention away from the input.
 * Persistent prompts use the bottom-left desktop shelf; their phone equivalents
 * belong in the app header so they remain visible without covering controls.
 */
export const TRANSIENT_NOTICE_LANE =
	"pointer-events-none fixed right-4 top-[calc(var(--desktop-header-h)+8px)] z-[200] " +
	"phone:inset-x-0 phone:right-auto phone:top-[calc(var(--header-h)+8px)]";

export const TOAST_NOTICE_LANE =
	"pointer-events-none fixed inset-x-0 bottom-[112px] z-[200] " +
	"phone:bottom-[calc(max(16px,env(safe-area-inset-bottom,0px))+132px)]";

export const PERSISTENT_NOTICE_SHELF =
	"pointer-events-none fixed bottom-2 left-2 z-[9500] flex w-fit " +
	"max-w-[calc(100vw-16px)] flex-col gap-2";

/** Card shared by durable update and desktop-link prompts. */
export const PERSISTENT_NOTICE_CARD =
	"pointer-events-auto flex w-full items-center justify-between gap-2 " +
	"rounded-row border border-[color:var(--composer-border)] bg-[var(--composer-surface)] " +
	"smooth-shadow-md py-1.5 pr-1.5 pl-3 phone:shadow-[var(--composer-shadow)] " +
	"animate-[update-toast-in_var(--dur-lg)_var(--ease)] motion-reduce:animate-none";
