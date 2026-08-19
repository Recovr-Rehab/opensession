/**
 * App-wide toast system. A tiny module-level store drives a single <ToastHost/>
 * mounted once at the app root, so any code — component, hook, or plain helper —
 * can fire a toast by importing `toast()` without threading an `onToast` prop
 * down the tree.
 *
 *   import { toast } from "../ui/toast";
 *   toast("Link copied");                       // auto-detects the ✓ success look
 *   toast("Couldn't load the transcript");      // auto-detects the error look
 *   toast("Saved", { variant: "success" });     // or be explicit
 *
 * Toasts stack bottom-center, newest on top, auto-dismiss, and animate in/out
 * with the shared Motion vocabulary. Success toasts draw an animated checkmark —
 * that's the "you copied the link" confirmation.
 */

import { AnimatePresence } from "motion/react";
import { useSyncExternalStore } from "react";
import { cn } from "./cn";
import { AnimatedCheck } from "./copy";
import { FloatingStatus } from "./floating-status";

export type ToastVariant = "default" | "success" | "error";

/** One action offered next to the message, for a toast that has to be
 *  actionable rather than only informative ("Archived · Undo"). One at most:
 *  a toast that needs a choice is a dialog. Label it with a verb. */
export type ToastAction = {
	label: string;
	onClick: () => void;
};

export type ToastOptions = {
	variant?: ToastVariant;
	/** ms before auto-dismiss. Default 3200 (success/default), 4200 (error),
	 *  7000 with an action, which has to outlast noticing and reaching it. */
	duration?: number;
	action?: ToastAction;
};

export type Toast = {
	id: number;
	message: string;
	variant: ToastVariant;
	action?: ToastAction;
};

// Cap the stack so a burst (e.g. archiving many sessions) can't wallpaper the
// screen — older toasts drop off the top.
const MAX_VISIBLE = 3;

let toasts: Toast[] = [];
let nextId = 1;
const listeners = new Set<() => void>();
const timers = new Map<number, ReturnType<typeof setTimeout>>();

function emit() {
	for (const l of listeners) l();
}

function subscribe(fn: () => void) {
	listeners.add(fn);
	return () => listeners.delete(fn);
}

function getSnapshot() {
	return toasts;
}

/** Infer the visual tone from the message when the caller didn't specify one, so
 * the many existing `onToast("… copied")` / `onToast("Couldn't …")` call sites
 * light up with the right icon for free. */
function inferVariant(message: string): ToastVariant {
	if (/\b(copied|saved|done|created|sent|updated)\b/i.test(message))
		return "success";
	if (/couldn'?t|can'?t|failed|error|no |nothing/i.test(message))
		return "error";
	return "default";
}

/** Fire a toast. Returns its id so it can be dismissed early. */
export function toast(message: string, opts: ToastOptions = {}): number {
	const id = nextId++;
	const variant = opts.variant ?? inferVariant(message);
	toasts = [...toasts, { id, message, variant, action: opts.action }];
	// Drop the oldest if we're over the cap.
	if (toasts.length > MAX_VISIBLE) {
		const overflow = toasts.slice(0, toasts.length - MAX_VISIBLE);
		for (const t of overflow) clearToastTimer(t.id);
		toasts = toasts.slice(toasts.length - MAX_VISIBLE);
	}
	const duration =
		opts.duration ?? (opts.action ? 7000 : variant === "error" ? 4200 : 3200);
	timers.set(
		id,
		setTimeout(() => dismissToast(id), duration),
	);
	emit();
	return id;
}

function clearToastTimer(id: number) {
	const t = timers.get(id);
	if (t) {
		clearTimeout(t);
		timers.delete(id);
	}
}

export function dismissToast(id: number) {
	clearToastTimer(id);
	toasts = toasts.filter((t) => t.id !== id);
	emit();
}

/** The live stack, for tests and for anything that needs to read it without
 *  subscribing through React. */
export function activeToasts(): readonly Toast[] {
	return toasts;
}

/**
 * Renders the live toast stack. Mount once, near the app root, above everything
 * else. Reads the module store via useSyncExternalStore so it re-renders on
 * every toast()/dismiss without a Context provider wrapping the tree.
 */
export function ToastHost() {
	const items = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
	return (
		<div className="pointer-events-none fixed inset-x-0 bottom-6 z-[100] flex flex-col items-center gap-2 px-4 phone:bottom-[calc(84px+env(safe-area-inset-bottom))]">
			<AnimatePresence initial={false}>
				{items.map((t) => (
					<ToastCard key={t.id} toast={t} />
				))}
			</AnimatePresence>
		</div>
	);
}

function ToastCard({ toast: t }: { toast: Toast }) {
	return (
		<FloatingStatus
			layout
			role="status"
			aria-live="polite"
			initial={{ opacity: 0, y: 14, scale: 0.94 }}
			animate={{ opacity: 1, y: 0, scale: 1 }}
			exit={{ opacity: 0, y: 8, scale: 0.96 }}
			transition={{ type: "spring", duration: 0.34, bounce: 0.22 }}
			onClick={() => dismissToast(t.id)}
			className={cn(
				"pointer-events-auto cursor-default",
				// The pill is nowrap by default, which a phone cannot afford: at
				// 390px a message like "Archived 3 sessions · stopped 1 running
				// turn" plus a button runs off both edges (measured). Wrap instead,
				// and never grow past the host's padded width.
				"max-w-full whitespace-normal",
				// The action carries its own padding, so the pill gives its right
				// edge back rather than sitting the button in a gutter.
				t.action && "pr-1.5",
			)}
		>
			{t.variant === "success" && (
				<AnimatedCheck size={17} className="shrink-0 text-green" />
			)}
			{t.variant === "error" && (
				<span
					aria-hidden
					className="grid size-[17px] shrink-0 place-items-center rounded-full text-label font-semibold text-accent"
				>
					!
				</span>
			)}
			<span>{t.message}</span>
			{t.action && (
				<button
					type="button"
					onClick={(e) => {
						// The card dismisses on click, so take the event: the action
						// runs once, and the toast still goes away after it.
						e.stopPropagation();
						dismissToast(t.id);
						t.action?.onClick();
					}}
					className="focus-ring -my-1 ml-1 shrink-0 cursor-pointer rounded-md px-2 py-1 text-label font-semibold text-accent hover:bg-hover"
				>
					{t.action.label}
				</button>
			)}
		</FloatingStatus>
	);
}
