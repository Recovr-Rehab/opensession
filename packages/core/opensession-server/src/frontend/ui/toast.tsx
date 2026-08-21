import { Toast as BaseToast } from "@base-ui/react/toast";
import { useEffect } from "react";
import { useIsPhone } from "../hooks/useIsPhone";
import { AnimatedCheck } from "./copy";
import { Tooltip } from "./tooltip";
import {
	clearUndoAction,
	isEditableUndoTarget,
	isUndoShortcut,
	registerUndoAction,
	UNDO_SHORTCUT_KEYS,
	undoLatestAction,
	type UndoHandle,
} from "../lib/undo";

export type ToastVariant = "default" | "success" | "error";

/** One action beside a message. A toast that needs a choice is a dialog. */
export type ToastAction = {
	label: string;
	onClick: () => void;
};

export type ToastOptions = {
	variant?: ToastVariant;
	/** Defaults: 3200ms, 4200ms for errors, and 7000ms with an action. */
	duration?: number;
	action?: ToastAction;
};

export type Toast = {
	id: number;
	message: string;
	variant: ToastVariant;
	action?: ToastAction;
};

type ToastData = {
	id: number;
	message: string;
	variant: ToastVariant;
	action?: ToastAction;
};

const MAX_VISIBLE = 3;
const manager = BaseToast.createToastManager<ToastData>();
let toasts: Toast[] = [];
let nextId = 1;
const undoHandles = new Map<number, UndoHandle>();

function managerId(id: number) {
	return `opensession-toast-${id}`;
}

function inferVariant(message: string): ToastVariant {
	if (/\b(copied|saved|done|created|sent|updated)\b/i.test(message))
		return "success";
	if (/couldn'?t|can'?t|failed|error|no |nothing/i.test(message))
		return "error";
	return "default";
}

function removeToastState(id: number) {
	toasts = toasts.filter((item) => item.id !== id);
	clearUndoAction(undoHandles.get(id));
	undoHandles.delete(id);
}

function runToastAction(id: number) {
	const item = toasts.find((candidate) => candidate.id === id);
	if (!item?.action) return;
	dismissToast(id);
	item.action.onClick();
}

/** Fire an app-wide toast. Returns its id so callers can close it early. */
export function toast(message: string, options: ToastOptions = {}): number {
	const id = nextId++;
	const variant = options.variant ?? inferVariant(message);
	const item: Toast = { id, message, variant, action: options.action };
	toasts = [...toasts, item];

	if (item.action?.label.toLowerCase() === "undo") {
		undoHandles.set(
			id,
			registerUndoAction(`toast:${id}`, () => runToastAction(id)),
		);
	}

	if (toasts.length > MAX_VISIBLE) {
		const overflow = toasts.slice(0, toasts.length - MAX_VISIBLE);
		for (const old of overflow) {
			removeToastState(old.id);
			manager.close(managerId(old.id));
		}
	}

	const duration =
		options.duration ??
		(options.action ? 7000 : variant === "error" ? 4200 : 3200);
	manager.add({
		id: managerId(id),
		description: message,
		type: variant,
		timeout: duration,
		data: { ...item },
		onClose: () => removeToastState(id),
	});
	return id;
}

export function dismissToast(id: number) {
	removeToastState(id);
	manager.close(managerId(id));
}

/** The visible stack, exposed for store-level tests. */
export function activeToasts(): readonly Toast[] {
	return toasts;
}

/**
 * Base UI owns measurement, stacking, hover and focus expansion, timer pausing,
 * swipe dismissal, and accessibility. Keep one host mounted at the app root.
 */
export function ToastHost() {
	return (
		<BaseToast.Provider toastManager={manager} limit={MAX_VISIBLE}>
			<ToastViewport />
		</BaseToast.Provider>
	);
}

function ToastViewport() {
	const { toasts: items } = BaseToast.useToastManager<ToastData>();

	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			if (
				!isUndoShortcut(event) ||
				isEditableUndoTarget(event.target) ||
				!undoLatestAction()
			)
				return;
			event.preventDefault();
			// The archive fallback also listens on window. Only one reversible
			// action should consume this Command-Z.
			event.stopImmediatePropagation();
		};
		window.addEventListener("keydown", onKeyDown, true);
		return () => window.removeEventListener("keydown", onKeyDown, true);
	}, []);

	return (
		<BaseToast.Portal>
			<BaseToast.Viewport
				className={[
					"pointer-events-none fixed inset-x-0 bottom-6 z-[100] mx-auto h-[var(--toast-frontmost-height)] w-full max-w-full px-4 outline-none",
					// A phone hangs the stack from the top, just under the bar, where
					// the thumb and the composer are not. --header-h already carries the
					// status-bar inset, and collapses to 0 above the breakpoint.
					"phone:bottom-auto phone:top-[calc(var(--header-h)+8px)] phone:px-3",
				].join(" ")}
			>
				{items.map((item) => (
					<ToastCard key={item.id} toast={item} />
				))}
			</BaseToast.Viewport>
		</BaseToast.Portal>
	);
}

function ToastCard({ toast: item }: { toast: BaseToast.Root.ToastObject<ToastData> }) {
	const data = item.data;
	const isPhone = useIsPhone();
	if (!data) return null;

	return (
		<BaseToast.Root
			toast={item}
			// The stack hangs from whichever edge it sits on, so the swipe that
			// throws a toast away is the one that pushes it off that edge.
			swipeDirection={isPhone ? ["up", "right"] : ["down", "right"]}
			onClick={() => dismissToast(data.id)}
			className={[
				"pointer-events-auto absolute bottom-0 left-1/2 w-max max-w-[calc(100vw-32px)] outline-none",
				"phone:bottom-auto phone:top-0 phone:max-w-[calc(100vw-24px)]",
				// One transform serves both edges: --toast-dir is the sign of the
				// stack, so the cards behind the frontmost one sit above it on
				// desktop and below it on a phone.
				"[--toast-dir:-1] phone:[--toast-dir:1]",
				"[z-index:calc(100-var(--toast-index))] [transform-origin:center_bottom] phone:[transform-origin:center_top]",
				"[transform:translateX(calc(-50%+var(--toast-swipe-movement-x)))_translateY(calc(var(--toast-swipe-movement-y)+var(--toast-dir)*var(--toast-index)*8px))_scale(calc(1-(var(--toast-index)*0.04)))]",
				"data-[expanded]:[transform:translateX(calc(-50%+var(--toast-swipe-movement-x)))_translateY(calc(var(--toast-swipe-movement-y)+var(--toast-dir)*var(--toast-offset-y)+var(--toast-dir)*var(--toast-index)*8px))_scale(1)]",
				"transition-[transform,scale,opacity] duration-200 ease-[cubic-bezier(0.23,1,0.32,1)]",
				"data-[starting-style]:opacity-0 data-[starting-style]:[scale:0.96] data-[ending-style]:opacity-0 data-[ending-style]:[scale:0.96] data-[limited]:opacity-0",
			].join(" ")}
		>
			<BaseToast.Content
				className={[
					"flex max-w-full items-center gap-2.5 whitespace-normal rounded-[999px] bg-popup-glass",
					"px-3.5 pt-2.5 pb-2 text-label font-medium leading-tight text-fg",
					"[backdrop-filter:var(--popup-blur)] [--smooth-ring-color:var(--popup-ring)] smooth-shadow-ring-sm",
					// A phone keeps the same pill, only tighter: it is a passing note
					// under the bar, not a panel.
					"phone:gap-2 phone:py-1.5 phone:pl-3.5",
					data.action ? "pr-1.5" : "phone:pr-3.5",
				].join(" ")}
			>
				{data.variant === "success" && (
					<AnimatedCheck size={17} className="shrink-0 text-green" />
				)}
				{data.variant === "error" && (
					<span
						aria-hidden
						className="grid size-[17px] shrink-0 place-items-center rounded-full text-label font-semibold text-accent"
					>
						!
					</span>
				)}
				{/* Description renders a <p>, and the preflight leaves its 14px
				    browser margins alone — which is most of the pill's height on a
				    phone, where there is no room to spend on them. */}
				<BaseToast.Description className="min-w-0 phone:my-0">
					{data.message}
				</BaseToast.Description>
				{data.action && (
					<Tooltip label="Undo" shortcut={UNDO_SHORTCUT_KEYS}>
						<BaseToast.Action
							onClick={(event) => {
								event.stopPropagation();
								runToastAction(data.id);
							}}
							// The pill stays tight, so the action carries the finger
							// target on its own: 32px of box inside a 44px tap area.
							className="focus-ring relative -my-1 ml-1 shrink-0 cursor-pointer rounded-md px-2 py-1 text-label font-semibold text-accent transition-[background-color,transform] duration-150 hover:bg-hover active:scale-[0.96] phone:-my-1.5 phone:ml-0.5 phone:grid phone:min-h-8 phone:place-items-center phone:rounded-[999px] phone:px-3 phone:after:absolute phone:after:inset-x-0 phone:after:top-1/2 phone:after:h-11 phone:after:-translate-y-1/2 phone:after:content-['']"
						>
							{data.action.label}
						</BaseToast.Action>
					</Tooltip>
				)}
			</BaseToast.Content>
		</BaseToast.Root>
	);
}
