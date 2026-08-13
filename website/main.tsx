import type { FormEvent } from "react";
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import markUrl from "../os1-mac/build/icon-512.png";
import { IconCheck } from "../src/frontend/components/icons";
import "./site.css";
import { ProductDemo } from "./ProductDemo";
import { TellaBackground } from "./TellaBackground";

/**
 * Where a waitlist signup goes: same origin, so whoever serves the site owns
 * the list. `bun run website:dev` handles it in scripts/website-dev.ts and
 * appends each address to a markdown file — no third-party collector yet.
 */
const waitlistEndpoint = "/api/waitlist";

const Agentation = lazy(() =>
	import("agentation").then((module) => ({ default: module.Agentation })),
);

function Mark() {
	return (
		<span className="mark">
			<img src={markUrl} alt="" />
		</span>
	);
}

function WaitlistForm() {
	const [email, setEmail] = useState("");
	const [state, setState] = useState<"idle" | "sending" | "done" | "error">(
		"idle",
	);

	async function submit(event: FormEvent) {
		event.preventDefault();
		if (state === "sending" || state === "done") return;
		setState("sending");
		try {
			if (!waitlistEndpoint) throw new Error("No waitlist endpoint configured");
			const response = await fetch(waitlistEndpoint, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ email }),
			});
			if (!response.ok) throw new Error(String(response.status));
			setState("done");
		} catch {
			setState("error");
		}
	}

	if (state === "done") {
		return (
			<p className="waitlist-done" role="status">
				<IconCheck size={20} /> You are added to the waitlist. We will get in
				touch when the product is ready.
			</p>
		);
	}

	return (
		<form className="waitlist-form" onSubmit={submit}>
			<input
				type="email"
				name="email"
				required
				autoComplete="email"
				placeholder="you@company.com"
				aria-label="Email address"
				value={email}
				onChange={(event) => setEmail(event.target.value)}
			/>
			<button type="submit" disabled={state === "sending"}>
				{state === "sending" ? "Sending…" : "Request"}
			</button>
			{state === "error" && (
				<p className="waitlist-error" role="alert">
					That did not go through. Try again in a moment.
				</p>
			)}
		</form>
	);
}

/**
 * The waitlist as a modal, so the CTA fills in the email where it stands
 * instead of scrolling somewhere. A native <dialog>
 * carries the backdrop, focus trap and Escape for free.
 */
function WaitlistDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
	const ref = useRef<HTMLDialogElement>(null);

	useEffect(() => {
		const dialog = ref.current;
		if (!dialog) return;
		if (open && !dialog.open) {
			dialog.showModal();
			// Otherwise the dialog's own autofocus lands on the close button.
			dialog.querySelector("input")?.focus();
		}
		if (!open && dialog.open) dialog.close();
	}, [open]);

	return (
		<dialog
			ref={ref}
			className="waitlist-dialog"
			onClose={onClose}
			// A click on the backdrop lands on the dialog element itself.
			onClick={(event) => {
				if (event.target === ref.current) onClose();
			}}
		>
			<div className="waitlist-dialog-head">
				<h2>Request a demo</h2>
				<button
					type="button"
					className="waitlist-dialog-close"
					onClick={onClose}
					aria-label="Close"
				>
					<span aria-hidden="true">×</span>
				</button>
			</div>
			<p className="waitlist-dialog-body">
				We will walk you through Open Session running on your own machines, with
				your team in the same session. Leave your email and we will find a time.
			</p>
			<WaitlistForm />
		</dialog>
	);
}

/** The whole page: header, the pitch, and the product running beside it. */
function LandingPage() {
	const [waitlistOpen, setWaitlistOpen] = useState(false);

	return (
		<section className="hero">
			<div className="gradient-fallback" aria-hidden="true" />
			<TellaBackground />
			<div className="hero-wash" aria-hidden="true" />

			<header className="site-header page-width">
				<a className="brand" href="/" aria-label="Open Session home">
					<Mark />
					<span>Open Session</span>
				</a>
			</header>

			<div className="hero-content page-width">
				<div className="hero-copy">
					<h1>Run your coding agents. Together.</h1>
					<p className="hero-description">
						Run Claude Code, Codex and OpenCode from one place, with your team
						in the session. Open source, on your own machines.
					</p>
					<div className="hero-actions">
						<button
							type="button"
							className="button button-primary"
							onClick={() => setWaitlistOpen(true)}
						>
							Request a demo
						</button>
					</div>
				</div>
				<div className="hero-stage">
					<ProductDemo />
				</div>
			</div>

			<WaitlistDialog
				open={waitlistOpen}
				onClose={() => setWaitlistOpen(false)}
			/>
		</section>
	);
}

const feedbackHost =
	["localhost", "127.0.0.1"].includes(window.location.hostname) ||
	window.location.hostname.endsWith(".ts.net");

const root = document.getElementById("root");
if (!root) throw new Error("Missing landing page root");

createRoot(root).render(
	<>
		<LandingPage />
		{feedbackHost && (
			<Suspense fallback={null}>
				<Agentation />
			</Suspense>
		)}
	</>,
);
