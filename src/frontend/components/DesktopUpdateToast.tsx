/**
 * Native-app update toast, docked bottom-right. Only renders inside the OS¹
 * mac shell (feature-detected via window.os1.updates, exposed by
 * os1-mac/src/preload.js): the shell's Squirrel updater reports "available"
 * (download in progress) then "downloaded". Only the latter is worth
 * interrupting for, so this stays quiet until the update is staged, then
 * offers a restart button and stays until dismissed. Distinct from
 * UpdatePill, which nudges about the *web* frontend rebuilding — this one is
 * about the shell binary itself.
 */

import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";
import { Button } from "../ui/button";
import { IconX } from "./icons";

type ShellUpdateState = {
	state: "idle" | "available" | "downloaded";
	version?: string | null;
};

type Os1Bridge = {
	updates?: {
		onState: (cb: (s: ShellUpdateState) => void) => (() => void) | void;
		install: () => void;
	};
};

function os1(): Os1Bridge | undefined {
	return (window as { os1?: Os1Bridge }).os1;
}

export function DesktopUpdateToast() {
	const [update, setUpdate] = useState<ShellUpdateState | null>(null);
	// Dismissal is keyed on version so waving one update away still lets the
	// next one announce itself.
	const [dismissedKey, setDismissedKey] = useState<string | null>(null);

	useEffect(() => {
		const updates = os1()?.updates;
		if (!updates?.onState) return;
		const off = updates.onState((s) => setUpdate(s));
		return typeof off === "function" ? off : undefined;
	}, []);

	// "available" only means the download started — nothing the person can act
	// on yet, so stay quiet until the update is staged and restarting will
	// actually install it.
	const downloaded = update?.state === "downloaded";
	const key = downloaded ? `downloaded:${update?.version ?? ""}` : "";
	const show = Boolean(downloaded && key !== dismissedKey);

	return (
		<div className="pointer-events-none fixed bottom-6 right-6 z-[100] phone:bottom-[calc(84px+env(safe-area-inset-bottom))]">
			<AnimatePresence>
				{show && (
					<motion.div
						role="status"
						aria-live="polite"
						initial={{ opacity: 0, y: 14, scale: 0.94 }}
						animate={{ opacity: 1, y: 0, scale: 1 }}
						exit={{ opacity: 0, y: 8, scale: 0.96 }}
						transition={{ type: "spring", duration: 0.34, bounce: 0.22 }}
						className="pointer-events-auto flex w-72 items-start gap-3 rounded-lg border border-line-strong bg-panel px-3.5 py-3 text-sm text-fg shadow-[0_8px_24px_rgba(0,0,0,0.34)]"
					>
						<div className="min-w-0 flex-1">
							<div className="font-medium">
								{`Update ready${update?.version ? ` — ${update.version}` : ""}`}
							</div>
							<div className="mt-0.5 leading-snug text-dim">
								Restart OS¹ to finish installing.
							</div>
							<Button
								size="sm"
								className="mt-2.5"
								onClick={() => os1()?.updates?.install()}
							>
								Restart to update
							</Button>
						</div>
						<button
							aria-label="Dismiss"
							title="Dismiss"
							className="-mr-2 -mt-2 grid size-8 shrink-0 cursor-pointer place-items-center rounded-control text-dim hover:text-fg"
							onClick={() => setDismissedKey(key)}
						>
							<IconX size={20} />
						</button>
					</motion.div>
				)}
			</AnimatePresence>
		</div>
	);
}
