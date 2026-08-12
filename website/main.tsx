import type { FormEvent } from "react";
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import markUrl from "../os1-mac/build/icon-512.png";
import { IconCheck } from "../src/frontend/components/icons";
import "./site.css";
import { ProductDemo } from "./ProductDemo";
import { TellaBackground } from "./TellaBackground";

/**
 * Where a waitlist signup goes. Until it points at a real collector the form
 * says so instead of pretending an address was stored.
 */
const waitlistEndpoint = "";

const Agentation = lazy(() =>
	import("agentation").then((module) => ({ default: module.Agentation })),
);

function Mark({ small = false }: { small?: boolean }) {
	return (
		<span className={small ? "mark mark-small" : "mark"}>
			<img src={markUrl} alt="" />
		</span>
	);
}

const features = [
	{
		number: "01",
		title: "Run agents in parallel",
		body: "Fan work out across models and focused child sessions. Each task keeps its own context and progress, then reports back to the main thread.",
	},
	{
		number: "02",
		title: "Collaborate in every session",
		body: "Teammates can watch live, answer questions, steer runs, and review agent output together from the web, desktop, or phone.",
	},
	{
		number: "03",
		title: "Ship from your own stack",
		body: "Run in git worktrees or isolated sandboxes on machines you control, using your existing model accounts, tools, and integrations.",
	},
];

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
				<IconCheck size={20} /> You are on the list. We will be in touch.
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
				{state === "sending" ? "Joining…" : "Join the waitlist"}
			</button>
			{state === "error" && (
				<p className="waitlist-error" role="alert">
					That did not go through. Try again in a moment.
				</p>
			)}
		</form>
	);
}

function LandingPage() {
	const [activeFeature, setActiveFeature] = useState(0);
	const featureRefs = useRef<Array<HTMLElement | null>>([]);

	useEffect(() => {
		const observer = new IntersectionObserver(
			(entries) => {
				for (const entry of entries) {
					if (!entry.isIntersecting) continue;
					const index = Number((entry.target as HTMLElement).dataset.feature);
					if (Number.isInteger(index)) setActiveFeature(index);
				}
			},
			{ rootMargin: "-45% 0px -45%", threshold: 0 },
		);
		for (const node of featureRefs.current) if (node) observer.observe(node);
		return () => observer.disconnect();
	}, []);

	return (
		<>
			<section className="hero">
				<div className="gradient-fallback" aria-hidden="true" />
				<TellaBackground />
				<div className="hero-wash" aria-hidden="true" />

				<header className="site-header page-width">
					<a className="brand" href="#top" aria-label="Open Session home">
						<Mark />
						<span>Open Session</span>
					</a>
					<nav aria-label="Main navigation">
						<a href="#why">How it works</a>
						<a className="nav-cta" href="#waitlist">
							Join the waitlist
						</a>
					</nav>
				</header>

			<div className="hero-content page-width" id="top">
				<div className="hero-story">
					<div className="hero-copy">
						<h1>Run your coding agents. Together.</h1>
						<p className="hero-description">
							Run Claude, Codex, and other coding agents side by side. Work in
							parallel and bring your team into every session.
						</p>
						<div className="hero-actions">
							<a className="button button-primary" href="#waitlist">
								Join the waitlist
							</a>
						</div>
						<div className="proof-line">
							<span>Use your existing subscriptions</span>
							<i />
							<span>Worktrees and sandboxes</span>
						</div>
					</div>

					<div className="hero-scroll-notes" id="why">
						{features.map((feature, index) => (
							<article
								className="hero-scroll-note"
								data-active={activeFeature === index}
								data-feature={index}
								key={feature.number}
								ref={(node) => {
									featureRefs.current[index] = node;
								}}
							>
								<span>{feature.number}</span>
								<h2>{feature.title}</h2>
								<p>{feature.body}</p>
							</article>
						))}
					</div>
				</div>
				<div className="hero-stage">
					<ProductDemo feature={activeFeature} />
				</div>
			</div>
		</section>

		<main>
			<section className="install-section page-width" id="waitlist">
					<div className="install-card">
						<div className="install-copy">
							<p className="section-kicker section-kicker-dark">Early access</p>
							<h2>Join the waitlist.</h2>
							<p>
								We are opening Open Session to a few teams at a time. Leave your
								email and we will tell you when it is your turn.
							</p>
						</div>
						<WaitlistForm />
						<p className="waitlist-note">
							One email when your invite is ready. Nothing else.
						</p>
					</div>
				</section>
			</main>

			<footer className="site-footer page-width">
				<a className="brand brand-footer" href="#top">
					<Mark small />
					<span>Open Session</span>
				</a>
				<p>The workspace for teams building with agents.</p>
			</footer>
		</>
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
