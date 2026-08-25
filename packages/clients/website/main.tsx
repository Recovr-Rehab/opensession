import { useEffect, useRef, useState, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import markAsset from "../mac/build/icon-512.png";
import nativeMarkAsset from "../ios/OS1/Assets.xcassets/AppIcon.appiconset/AppIcon-1024.png";
import {
	IconBranches,
	IconCheck,
	IconClock,
	IconCopy,
	IconGlobe,
	IconPeople,
	IconPhone,
	IconPullRequest,
	IconRepo,
	IconRobot,
	IconServer,
	IconSparkle,
	IconStack,
	IconTerminal,
	IconX,
} from "../../core/opensession-server/src/frontend/components/icons";
import "./site.css";
import { AgentationFeedback } from "./AgentationFeedback";
import { ProductDemo } from "./ProductDemo";
import { TellaBackground } from "./TellaBackground";
import { assetUrl } from "./asset-url";

const markUrl = assetUrl(markAsset);
const nativeMarkUrl = assetUrl(nativeMarkAsset);
const macDownloadUrl =
	"https://github.com/tellahq/opensession/releases/download/v0.4.22/OpenSession-0.4.22-arm64.dmg";
const installCommand =
	"curl -fsSL https://raw.githubusercontent.com/tellahq/opensession/main/install.sh | bash";

function Mark() {
	return (
		<span className="mark">
			<img src={markUrl} alt="" />
		</span>
	);
}

/**
 * One cell of the capability grid: a glyph, a name, and what it means. A cell
 * marked `soon` describes something that is not shipped yet, so the tag sits
 * on the name where nobody can read the sentence without it.
 */
function Feature({
	icon,
	name,
	soon,
	children,
}: {
	icon: ReactNode;
	name: string;
	soon?: boolean;
	children: ReactNode;
}) {
	return (
		<div className="feature">
			<span className="feature-icon" aria-hidden="true">
				{icon}
			</span>
			<div className="feature-head">
				<h3>{name}</h3>
				{soon && <span className="feature-soon">Coming soon</span>}
			</div>
			<p>{children}</p>
		</div>
	);
}

function Question({ q, children }: { q: string; children: ReactNode }) {
	return (
		<details className="faq-item">
			<summary>
				{q}
				<span className="faq-sign" aria-hidden="true" />
			</summary>
			<p>{children}</p>
		</details>
	);
}

function PwaGuide() {
	const dialogRef = useRef<HTMLDialogElement>(null);

	return (
		<>
			<button
				type="button"
				className="landing-setup-app"
				onClick={() => dialogRef.current?.showModal()}
			>
				<span className="landing-setup-app-mark landing-setup-app-mark-web" aria-hidden="true">
					<IconGlobe size={24} />
				</span>
				<span className="landing-setup-app-copy">
					<strong>PWA</strong>
					<small>Install from your browser</small>
				</span>
				<span className="landing-setup-app-action">How to install</span>
			</button>

			<dialog
				ref={dialogRef}
				className="pwa-guide"
				aria-labelledby="pwa-guide-title"
				onClick={(event) => {
					if (event.target === event.currentTarget) event.currentTarget.close();
				}}
			>
				<div className="pwa-guide-panel">
					<button
						type="button"
						className="pwa-guide-close"
						aria-label="Close"
						onClick={() => dialogRef.current?.close()}
					>
						<IconX size={20} />
					</button>
					<span className="pwa-guide-mark" aria-hidden="true">
						<IconGlobe size={26} />
					</span>
					<h2 id="pwa-guide-title">Install the PWA</h2>
					<p>Open your HTTPS Open Session address in a browser, then:</p>
					<div className="pwa-guide-options">
						<div>
							<strong>Mac or PC</strong>
							<span>
								In Chrome or Edge, select the install icon in the address bar.
								In Safari, choose File → Add to Dock.
							</span>
						</div>
						<div>
							<strong>iPhone or iPad</strong>
							<span>
								In Safari, tap Share, then Add to Home Screen and Add.
							</span>
						</div>
					</div>
					<p className="pwa-guide-note">
						Want a standalone Electron app instead? Download the Mac app.
					</p>
				</div>
			</dialog>
		</>
	);
}

function InstallCommand() {
	const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">(
		"idle",
	);

	useEffect(() => {
		if (copyState === "idle") return;
		const timeout = window.setTimeout(() => setCopyState("idle"), 2000);
		return () => window.clearTimeout(timeout);
	}, [copyState]);

	const copyLabel =
		copyState === "copied"
			? "Copied"
			: copyState === "failed"
				? "Try again"
				: "Copy";

	return (
		<div className="landing-install-command">
			<code>{installCommand}</code>
			<button
				type="button"
				onClick={async () => {
				try {
					await navigator.clipboard.writeText(installCommand);
					setCopyState("copied");
				} catch {
					setCopyState("failed");
				}
			}}
			>
				{copyState === "copied" ? (
					<IconCheck size={16} />
				) : (
					<IconCopy size={16} />
				)}
				<span aria-live="polite">{copyLabel}</span>
			</button>
		</div>
	);
}

function SetupOverview() {
	return (
		<section className="card landing-setup-overview">
			<div className="landing-setup-overview-head">
				<h2>Set up Open Session</h2>
				<p>Run it on your own machine and keep access private.</p>
			</div>

			<ol className="landing-setup-steps">
				<li>
					<span className="landing-setup-step-index">1</span>
					<span className="landing-setup-step-icon" aria-hidden="true">
						<IconServer size={22} />
					</span>
					<div className="landing-setup-step-copy">
						<strong>Get a server</strong>
						<span>
							Use a machine (VPS, Hetzner, or Mac mini) you can leave powered on
							and connected.
						</span>
					</div>
				</li>
				<li>
					<span className="landing-setup-step-index">2</span>
					<span className="landing-setup-step-icon" aria-hidden="true">
						<IconGlobe size={22} />
					</span>
					<div className="landing-setup-step-copy">
						<strong>Install Tailscale</strong>
						<span>Join the server and every device to the same tailnet.</span>
					</div>
					<a
						className="landing-setup-step-action"
						href="https://tailscale.com/download"
						target="_blank"
						rel="noreferrer"
					>
						Download
					</a>
				</li>
				<li>
					<span className="landing-setup-step-index">3</span>
					<span className="landing-setup-step-icon" aria-hidden="true">
						<IconPhone size={22} />
					</span>
					<div className="landing-setup-step-copy">
						<strong>Download the apps</strong>
						<span>Each app connects to the server you just installed.</span>
					</div>
				</li>
			</ol>

			<div className="landing-setup-apps">
				<a className="landing-setup-app" href={macDownloadUrl}>
					<img src={markUrl} alt="" />
					<span className="landing-setup-app-copy">
						<strong>Mac app</strong>
						<small>Electron · Apple silicon</small>
					</span>
					<span className="landing-setup-app-action">Download</span>
				</a>
				<PwaGuide />
				<div className="landing-setup-app" aria-disabled="true">
					<img src={nativeMarkUrl} alt="" />
					<span className="landing-setup-app-copy">
						<strong>iOS app</strong>
						<small>Native app · App Store</small>
					</span>
					<span className="landing-setup-app-action">Coming soon</span>
				</div>
			</div>

			<div className="landing-install-option">
				<div>
					<strong>Or install from Terminal</strong>
					<span>Run one command on Linux, macOS or WSL2.</span>
				</div>
				<InstallCommand />
			</div>
		</section>
	);
}

/**
 * The page: a rail that stays put, and a feed that explains the product one
 * quiet card at a time. The rail holds the whole pitch and the only CTA, so
 * the ask never scrolls away and the feed never has to repeat it.
 */
function LandingPage() {
	return (
		<div className="shell">
			<aside className="rail">
				<a className="brand" href="/" aria-label="Open Session home">
					<Mark />
				</a>

				<h1>
					Your team’s control room{" "}
					<span>for coding agents</span>
				</h1>

				<div className="rail-foot">
					<a
						className="button button-primary"
						href="https://github.com/tellahq/opensession"
					>
						View on GitHub
					</a>
					<p className="rail-note">
						Open source. Self-hosted. Any model provider.
					</p>
				</div>
			</aside>

			<main className="feed">
				<section className="stage">
					<div className="gradient-fallback" aria-hidden="true" />
					<TellaBackground />
					<ProductDemo />
				</section>

				<section className="card">
					<div className="features">
						<Feature icon={<IconSparkle size={28} />} name="Any model">
							Point a session at whatever model suits the work, and change it
							mid-run without losing the thread.
						</Feature>
						<Feature icon={<IconPeople size={28} />} name="Multiplayer by default">
							Anyone on the team opens the same session, sees the run as it
							happens, and sends the next turn.
						</Feature>
						<Feature icon={<IconGlobe size={28} />} name="On your machines">
							Self-hosted from the first minute. The checkouts, the transcripts
							and the keys stay on hardware you run.
						</Feature>
						<Feature icon={<IconBranches size={28} />} name="A worktree each">
							Every session gets its own branch and checkout, so ten agents work
							at once without stepping on each other.
						</Feature>
						<Feature icon={<IconPullRequest size={28} />} name="Ends in a pull request">
							Read the diff, then open the PR from the same place the work
							happened. Review stays next to the transcript.
						</Feature>
						<Feature icon={<IconRobot size={28} />} name="Agents that delegate">
							A session hands focused work to its own sub-agents and keeps their
							noise out of the conversation you are reading.
						</Feature>
						<Feature icon={<IconClock size={28} />} name="Runs without you">
							Schedules, webhooks and watched channels start sessions on their
							own, each scoped to the tools it is allowed.
						</Feature>
						<Feature icon={<IconTerminal size={28} />} name="Shells and previews">
							Open a terminal in the worktree, or a running preview of the
							branch, beside the session that built it.
						</Feature>
						<Feature icon={<IconStack size={28} />} name="Everywhere you are">
							A web app, a Mac app and a browser side panel, all on one server.
						</Feature>
						<Feature icon={<IconPhone size={28} />} name="Works on mobile">
							Read a session, answer a question and send the next turn from your
							phone. Native iOS coming soon.
						</Feature>
						<Feature icon={<IconRepo size={28} />} name="Open source">
							Read it, fork it, run it. There is no hosted tier in the path that
							you have to take on trust.
						</Feature>
					</div>
				</section>

				<SetupOverview />

				<section className="card">
					<h2>Common questions</h2>
					<div className="faq">
						<Question q="Is it really self-hosted?">
							Yes. You run the server and the agents run against your checkouts
							on your hardware. There is no Open Session cloud in the path.
						</Question>
						<Question q="Which agents can it run?">
							Whatever the engine supports. A session names a model rather than a
							vendor, and you can change that model between turns.
						</Question>
						<Question q="What does multiplayer actually mean?">
							One session, many people. The transcript updates live for everyone
							watching, you can see who else is there, and anyone can send the
							next turn or answer a question the agent asked.
						</Question>
						<Question q="Do parallel agents share a checkout?">
							No. Each session gets its own git worktree and branch. A session
							can attach a second repository when the work spans more than one.
						</Question>
						<Question q="How does the work get reviewed?">
							As a pull request on the session's branch, with the diff and the
							review beside the transcript that produced them.
						</Question>
						<Question q="Can it run when nobody is watching?">
							Yes. An automation starts a session on a schedule, a webhook or a
							message in a watched channel, with its own allowlist of tools and
							read-only access unless you grant more.
						</Question>
						<Question q="When can I use it?">
							You can use it now. Get started on GitHub and run Open Session on
							your own infrastructure.
						</Question>
					</div>
				</section>

				<footer className="feed-foot">
					<span>©2026</span>
				</footer>
			</main>
		</div>
	);
}

const root = document.getElementById("root");
if (!root) throw new Error("Missing landing page root");

createRoot(root).render(
	<>
		<LandingPage />
		<AgentationFeedback />
	</>,
);
