import { lazy, Suspense } from "react";
import { createRoot } from "react-dom/client";
import markUrl from "../os1-mac/build/icon-512.png";
import "./site.css";
import { TellaBackground } from "./TellaBackground";

const Agentation = lazy(() =>
	import("agentation").then((module) => ({ default: module.Agentation })),
);

/**
 * One screen, nothing to scroll. The product is not ready to be explained in
 * feature sections yet, so the page says the name, the one line that is true,
 * and where the code lives. Everything else waits until there is something
 * worth showing.
 */
function LandingPage() {
	return (
		<section className="hero">
			<div className="gradient-fallback" aria-hidden="true" />
			<TellaBackground />
			<div className="hero-wash" aria-hidden="true" />

			<header className="site-header page-width">
				<a className="brand" href="/" aria-label="Open Session home">
					<span className="mark">
						<img src={markUrl} alt="" />
					</span>
					<span>Open Session</span>
				</a>
				<nav aria-label="Main navigation">
					<a href="https://github.com/tellahq/opensession">
						GitHub <span aria-hidden="true">↗</span>
					</a>
				</nav>
			</header>

			<div className="hero-content page-width">
				<h1>Run your coding agents. Together.</h1>
				<p>Coming soon.</p>
			</div>
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
