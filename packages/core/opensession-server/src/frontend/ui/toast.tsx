import { Toast as BaseToast } from "@base-ui/react/toast";
import { useEffect, useRef } from "react";
import {
	IconArchive,
	IconArrowUp,
	IconBranches,
	IconCopy,
	IconLink,
	IconPlay,
	IconPlug,
	IconPlus,
	IconRestore,
	IconServer,
	IconTrash,
} from "../components/icons";
import { TOAST_NOTICE_LANE } from "../lib/notification-classes";
import { toastIconName, type ToastIconName } from "../lib/toast-icon";
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
	duration: number;
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
	if (
		/\b(could not|couldn'?t|can not|can'?t|failed|failure|error|nothing|missed|lost|unavailable)\b|\bno\s|larger than|waiting for approval/i.test(
			message,
		)
	)
		return "error";
	if (
		/\b(copied|saved|done|created|sent|updated|added|removed|enabled|disabled|registered|connected|disconnected|linked|unlinked|archived|reopened|restored|forgotten|started|works|restarted|switched)\b/i.test(
			message,
		)
	)
		return "success";
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
	// Link controls already confirm the copy inline or through the platform share
	// surface. A second floating receipt repeats the same result in a louder place.
	if (/\blink copied\b/i.test(message)) return 0;

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
		data: { ...item, duration },
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
				className={`${TOAST_NOTICE_LANE} toast-viewport mx-auto h-[var(--toast-frontmost-height)] w-[min(480px,calc(100vw-32px))] outline-none phone:w-full phone:px-3`}
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
	if (!data) return null;

	return (
		<BaseToast.Root
			toast={item}
			// Receipts rise into view above the composer. The bottom anchor makes
			// additional receipts stack upward instead of covering the input.
			swipeDirection={["down", "right"]}
			onClick={() => dismissToast(data.id)}
			className={[
				"pointer-events-auto absolute bottom-0 left-1/2 w-max max-w-full outline-none phone:max-w-[calc(100vw-24px)]",
				"[z-index:calc(100-var(--toast-index))] [transform-origin:center_bottom]",
				"[transform:translateX(calc(-50%+var(--toast-swipe-movement-x)))_translateY(calc(var(--toast-swipe-movement-y)-var(--toast-index)*8px))_scale(calc(1-(var(--toast-index)*0.04)))]",
				"data-[expanded]:[transform:translateX(calc(-50%+var(--toast-swipe-movement-x)))_translateY(calc(var(--toast-swipe-movement-y)-var(--toast-offset-y)-var(--toast-index)*8px))_scale(1)]",
				"transition-[transform,translate,scale,opacity] duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] motion-reduce:transition-opacity",
				"data-[starting-style]:opacity-0 data-[starting-style]:[translate:0_8px] data-[starting-style]:[scale:0.96] data-[ending-style]:opacity-0 data-[ending-style]:[translate:0_8px] data-[ending-style]:[scale:0.96] data-[limited]:opacity-0 motion-reduce:data-[starting-style]:[translate:0_0] motion-reduce:data-[starting-style]:[scale:1] motion-reduce:data-[ending-style]:[translate:0_0] motion-reduce:data-[ending-style]:[scale:1]",
			].join(" ")}
		>
			<BaseToast.Content
				className={[
					"relative flex max-w-full items-center gap-2 overflow-hidden whitespace-normal rounded-[999px] bg-popup-glass",
					"px-3 py-1.5 text-supporting font-medium leading-tight text-fg",
					"[backdrop-filter:var(--popup-blur)] [--smooth-ring-color:var(--popup-ring)] smooth-shadow-ring-sm",
					data.action ? "pr-1.5" : "",
				].join(" ")}
			>
				<ToastStatusIcon name={toastIconName(data.message, data.variant)} />
				{/* Description renders a <p>; remove its browser margins so the
				    visible height comes from the pill padding alone. */}
				<BaseToast.Description
					className="my-0 min-w-0 line-clamp-2"
					title={data.message}
				>
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
							// target on its own: 28px of box inside a 44px tap area.
							className="focus-ring relative -my-1 ml-1 shrink-0 cursor-pointer rounded-md px-2 py-1 text-supporting font-semibold text-accent transition-[background-color,transform] duration-150 hover:bg-hover active:scale-[0.96] phone:-my-1.5 phone:ml-0.5 phone:grid phone:min-h-7 phone:place-items-center phone:rounded-[999px] phone:px-2.5 phone:after:absolute phone:after:inset-x-0 phone:after:top-1/2 phone:after:h-11 phone:after:-translate-y-1/2 phone:after:content-['']"
						>
							{data.action.label}
						</BaseToast.Action>
					</Tooltip>
				)}
				<ToastProgress duration={data.duration} />
			</BaseToast.Content>
		</BaseToast.Root>
	);
}

function ToastStatusIcon({ name }: { name: ToastIconName | null }) {
	const className = "shrink-0 text-dim";
	switch (name) {
		case "archive":
			return <IconArchive size={15} className={className} aria-hidden />;
		case "branches":
			return <IconBranches size={15} className={className} aria-hidden />;
		case "check":
			return <AnimatedCheck size={15} className={className} />;
		case "copy":
			return <IconCopy size={15} className={className} aria-hidden />;
		case "link":
			return <IconLink size={15} className={className} aria-hidden />;
		case "play":
			return <IconPlay size={15} className={className} aria-hidden />;
		case "plug":
			return <IconPlug size={15} className={className} aria-hidden />;
		case "plus":
			return <IconPlus size={15} className={className} aria-hidden />;
		case "restore":
			return <IconRestore size={15} className={className} aria-hidden />;
		case "send":
			return <IconArrowUp size={15} className={className} aria-hidden />;
		case "server":
			return <IconServer size={15} className={className} aria-hidden />;
		case "trash":
			return <IconTrash size={15} className={className} aria-hidden />;
		case "error":
			return (
				<span
					aria-hidden
					className="grid size-[15px] shrink-0 place-items-center rounded-full text-meta font-semibold text-dim"
				>
					!
				</span>
			);
		default:
			return null;
	}
}

/**
 * A visual timer that follows Base UI's pause rules. The store pauses expiry
 * while the stack is hovered, focused, or the tab is hidden; this line reads
 * the same viewport state and advances only while the timer can advance.
 */
function ToastProgress({ duration }: { duration: number }) {
	const lineRef = useRef<HTMLSpanElement>(null);

	useEffect(() => {
		const line = lineRef.current;
		if (!line || duration <= 0) return;
		let elapsed = 0;
		let previous = performance.now();
		let frame = 0;

		const resetClock = () => {
			previous = performance.now();
		};
		const draw = (now: number) => {
			const viewport = line.closest(".toast-viewport");
			const paused =
				document.visibilityState !== "visible" ||
				viewport?.hasAttribute("data-expanded");
			if (!paused) elapsed += now - previous;
			previous = now;
			line.style.transform = `scaleX(${Math.max(0, 1 - elapsed / duration)})`;
			if (elapsed < duration) frame = requestAnimationFrame(draw);
		};

		document.addEventListener("visibilitychange", resetClock);
		frame = requestAnimationFrame(draw);
		return () => {
			document.removeEventListener("visibilitychange", resetClock);
			cancelAnimationFrame(frame);
		};
	}, [duration]);

	return (
		<span
			ref={lineRef}
			aria-hidden
			className="pointer-events-none absolute inset-x-0 bottom-0 h-0.5 origin-left bg-dim/35"
		/>
	);
}
