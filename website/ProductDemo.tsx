import { type FormEvent, useRef, useState } from "react";
import {
	IconArrowUp,
	IconChart,
	IconCheck,
	IconChevronDown,
	IconChevronLeft,
	IconChevronRight,
	IconClock,
	IconCrosshair,
	IconDotsHorizontal,
	IconEye,
	IconHome,
	IconLink,
	IconListChecks,
	IconPaperclip,
	IconPlus,
	IconPullRequest,
	IconRepo,
	IconSearch,
	IconSidebarLeft,
	IconSidebarRight,
} from "../src/frontend/components/icons";

type DemoSession = {
	id: string;
	title: string;
	shortTitle: string;
	lane: "review" | "progress" | "ready";
	time?: string;
	owner: string;
	prompt: string;
	lead: string;
	steps: Array<{ label: string; meta: string; state: "done" | "active" }>;
	summary: string;
};

const demoSessions: DemoSession[] = [
	{
		id: "presence",
		title: "Add multiplayer workspace presence",
		shortTitle: "Add workspace presence",
		lane: "review",
		owner: "L",
		prompt:
			"Add multiplayer presence to project workspaces. Have a focused agent cover the tests, then open a pull request.",
		lead: "I found the existing presence channel and workspace header. I’m wiring those together while a focused worker adds coverage.",
		steps: [
			{ label: "Explore workspace presence", meta: "4 files", state: "done" },
			{ label: "Test worker", meta: "Adding coverage", state: "active" },
			{ label: "Run checks", meta: "16 passed", state: "done" },
		],
		summary:
			"Presence now appears in every shared workspace. The tests pass and pull request #1842 is ready for review.",
	},
	{
		id: "review",
		title: "Review checkout recovery",
		shortTitle: "Review checkout recovery",
		lane: "progress",
		time: "5:38",
		owner: "M",
		prompt:
			"Review the checkout recovery change, focus on regression risk, and leave the branch ready to merge.",
		lead: "I’m comparing the recovery path with the previous implementation and checking the tests around interrupted payments.",
		steps: [
			{ label: "Read checkout flow", meta: "7 files", state: "done" },
			{ label: "Review recovery states", meta: "In progress", state: "active" },
			{ label: "Run focused tests", meta: "24 passed", state: "done" },
		],
		summary:
			"The branch is structurally sound. One stale loading state still needs a guard before it is ready to merge.",
	},
	{
		id: "mobile",
		title: "Improve mobile navigation",
		shortTitle: "Improve mobile navigation",
		lane: "progress",
		time: "7:48",
		owner: "K",
		prompt:
			"Improve the mobile session navigation without changing the desktop information architecture.",
		lead: "I found the shared route state. I’m keeping the desktop tabs intact and moving the mobile controls into a compact sheet.",
		steps: [
			{ label: "Map navigation state", meta: "3 routes", state: "done" },
			{ label: "Build mobile sheet", meta: "Implementing", state: "active" },
			{ label: "Check keyboard access", meta: "Queued", state: "done" },
		],
		summary:
			"The mobile path now uses the same route model as desktop, with a smaller touch-first presentation.",
	},
	{
		id: "shortcuts",
		title: "Ship keyboard shortcuts",
		shortTitle: "Ship keyboard shortcuts",
		lane: "ready",
		owner: "J",
		prompt:
			"Finish the keyboard shortcut pass, verify conflicts, and prepare the pull request for review.",
		lead: "The command registry already centralizes most shortcuts. I’ve filled the two gaps and checked the browser-reserved combinations.",
		steps: [
			{ label: "Audit command registry", meta: "32 commands", state: "done" },
			{ label: "Resolve collisions", meta: "2 fixed", state: "done" },
			{ label: "Open pull request", meta: "#1837", state: "done" },
		],
		summary:
			"Shortcuts are documented, conflict-free, and ready to merge in pull request #1837.",
	},
];

const lanes = [
	{ id: "review", label: "Awaiting review", icon: IconEye },
	{ id: "progress", label: "In progress", icon: IconClock },
	{ id: "ready", label: "Ready to merge", icon: IconPullRequest },
] as const;

export function ProductDemo() {
	const [selectedId, setSelectedId] = useState(demoSessions[0].id);
	const [sidebarOpen, setSidebarOpen] = useState(true);
	const [collapsedLanes, setCollapsedLanes] = useState<string[]>([]);
	const [draft, setDraft] = useState("");
	const [demoPrompt, setDemoPrompt] = useState<string | null>(null);
	const composerRef = useRef<HTMLTextAreaElement>(null);
	const selected =
		demoSessions.find((session) => session.id === selectedId) ??
		demoSessions[0];
	const selectedIndex = demoSessions.findIndex(
		(session) => session.id === selected.id,
	);

	function toggleLane(lane: string) {
		setCollapsedLanes((current) =>
			current.includes(lane)
				? current.filter((item) => item !== lane)
				: [...current, lane],
		);
	}

	function submitPrompt(event: FormEvent) {
		event.preventDefault();
		const prompt = draft.trim();
		if (!prompt) return;
		setDemoPrompt(prompt);
		setDraft("");
	}

	function moveSelection(offset: number) {
		const nextIndex =
			(selectedIndex + offset + demoSessions.length) % demoSessions.length;
		setSelectedId(demoSessions[nextIndex].id);
		setDemoPrompt(null);
	}

	return (
		<figure className="preview-wrap">
			<div
				className={`product-demo ${sidebarOpen ? "" : "product-demo-sidebar-closed"}`}
			>
				<aside className="demo-sidebar" aria-label="Demo workspaces">
					<div className="demo-sidebar-top">
						<button
							type="button"
							className="demo-icon-button"
							aria-label="Hide sidebar"
							onClick={() => setSidebarOpen(false)}
						>
							<IconSidebarLeft size={18} />
						</button>
						<div className="demo-avatar demo-avatar-presence">K</div>
						<span className="demo-spacer" />
						<button
							type="button"
							className="demo-icon-button"
							aria-label="Previous session"
							onClick={() => moveSelection(-1)}
						>
							<IconChevronLeft size={18} />
						</button>
						<button
							type="button"
							className="demo-icon-button"
							aria-label="Next session"
							onClick={() => moveSelection(1)}
						>
							<IconChevronRight size={18} />
						</button>
						<button
							type="button"
							className="demo-icon-button"
							aria-label="Show all sessions"
							onClick={() => setCollapsedLanes([])}
						>
							<IconSearch size={18} />
						</button>
					</div>

					<nav className="demo-sidebar-nav" aria-label="Demo tools">
						<p>Tools</p>
						<button type="button">
							<IconHome size={17} />
							<span>Home</span>
							<span className="demo-presence-stack">
								<i>M</i>
								<i>L</i>
								<i>K</i>
								<em>+3</em>
							</span>
						</button>
						<button type="button">
							<IconListChecks size={17} />
							<span>Tasks</span>
						</button>
						<button type="button">
							<IconChart size={17} />
							<span>Reports</span>
						</button>
					</nav>

					<div className="demo-workspace-heading">
						<span>Workspaces</span>
						<button
							type="button"
							className="demo-icon-button"
							aria-label="Filter workspaces"
						>
							<IconListChecks size={17} />
						</button>
						<button
							type="button"
							className="demo-icon-button"
							aria-label="Create workspace"
						>
							<IconPlus size={18} />
						</button>
					</div>

					<div className="demo-lanes">
						{lanes.map((lane) => {
							const laneSessions = demoSessions.filter(
								(session) => session.lane === lane.id,
							);
							const collapsed = collapsedLanes.includes(lane.id);
							const LaneIcon = lane.icon;
							return (
								<section
									key={lane.id}
									className={`demo-lane demo-lane-${lane.id}`}
								>
									<button
										type="button"
										className="demo-lane-heading"
										onClick={() => toggleLane(lane.id)}
										aria-expanded={!collapsed}
									>
										<LaneIcon size={17} />
										<span>{lane.label}</span>
										<small>{laneSessions.length}</small>
										<IconChevronDown
											size={14}
											className={collapsed ? "demo-chevron-collapsed" : ""}
										/>
									</button>
									{!collapsed &&
										laneSessions.map((session) => (
											<button
												type="button"
												key={session.id}
												className={`demo-session-row ${session.id === selected.id ? "demo-session-row-active" : ""}`}
												onClick={() => {
													setSelectedId(session.id);
													setDemoPrompt(null);
												}}
											>
												<IconPullRequest size={16} />
												<span>{session.shortTitle}</span>
												{session.time ? (
													<time>{session.time}</time>
												) : (
													<i>{session.owner}</i>
												)}
											</button>
										))}
								</section>
							);
						})}
					</div>
				</aside>

				<section
					className="demo-main"
					aria-label="Interactive OpenSession demo"
				>
					<header className="demo-main-header">
						{!sidebarOpen && (
							<button
								type="button"
								className="demo-icon-button"
								aria-label="Show sidebar"
								onClick={() => setSidebarOpen(true)}
							>
								<IconSidebarRight size={18} />
							</button>
						)}
						<div className="demo-repo-mark">
							<IconRepo size={14} />
						</div>
						<strong>opensession</strong>
						<IconChevronRight size={14} />
						<span>{selected.title}</span>
						<button
							type="button"
							className="demo-icon-button"
							aria-label="Try a new prompt"
							onClick={() => composerRef.current?.focus()}
						>
							<IconPlus size={18} />
						</button>
						<div className="demo-header-actions">
							<div className="demo-avatar">K</div>
							<button
								type="button"
								className="demo-icon-button"
								aria-label="Copy session link"
							>
								<IconLink size={18} />
							</button>
							<button
								type="button"
								className="demo-icon-button"
								aria-label="Session actions"
							>
								<IconDotsHorizontal size={18} />
							</button>
							<button
								type="button"
								className="demo-icon-button"
								aria-label="Toggle review panel"
							>
								<IconSidebarRight size={18} />
							</button>
						</div>
					</header>

					<div
						className="demo-thread"
						key={`${selected.id}-${demoPrompt ?? "default"}`}
					>
						<div className="demo-thread-content">
							<div className="demo-user-prompt">
								{demoPrompt ?? selected.prompt}
							</div>
							<p className="demo-agent-lead">
								{demoPrompt
									? "This is an interactive product demo, so the prompt stays in your browser. In OpenSession, it would start a live agent turn here."
									: selected.lead}
							</p>
							<div className="demo-progress-list">
								{demoPrompt ? (
									<>
										<div>
											<IconCheck size={16} />
											<strong>Capture your prompt</strong>
											<span>Local only</span>
										</div>
										<div className="demo-progress-active">
											<i />
											<strong>Start an agent turn</strong>
											<span>Available in OpenSession</span>
										</div>
										<div>
											<IconCheck size={16} />
											<strong>Keep the session shared</strong>
											<span>Team visible</span>
										</div>
									</>
								) : (
									selected.steps.map((step) => (
										<div
											key={step.label}
											className={
												step.state === "active" ? "demo-progress-active" : ""
											}
										>
											{step.state === "done" ? <IconCheck size={16} /> : <i />}
											<strong>{step.label}</strong>
											<span>{step.meta}</span>
										</div>
									))
								)}
							</div>
							<p className="demo-agent-summary">
								{demoPrompt
									? "Try selecting another session in the sidebar, or submit a different prompt."
									: selected.summary}
							</p>
						</div>

						<form className="demo-composer" onSubmit={submitPrompt}>
							<textarea
								ref={composerRef}
								value={draft}
								onChange={(event) => setDraft(event.target.value)}
								placeholder="Ask OpenSession to change anything..."
								aria-label="Try the demo composer"
								rows={2}
							/>
							<div className="demo-composer-actions">
								<button
									type="button"
									className="demo-icon-button"
									aria-label="Add context"
								>
									<IconPlus size={18} />
								</button>
								<button
									type="button"
									className="demo-icon-button"
									aria-label="Use page context"
								>
									<IconCrosshair size={17} />
								</button>
								<button
									type="button"
									className="demo-icon-button"
									aria-label="Attach file"
								>
									<IconPaperclip size={17} />
								</button>
								<span className="demo-spacer" />
								<span className="demo-model">GPT-5.6 sol&nbsp; High</span>
								<strong className="demo-cost">$0.60</strong>
								<button
									type="submit"
									className="demo-send-button"
									disabled={!draft.trim()}
									aria-label="Submit demo prompt"
								>
									<IconArrowUp size={17} />
								</button>
							</div>
						</form>
					</div>
				</section>
			</div>
			<figcaption>Interactive demo · Try the sidebar or composer</figcaption>
		</figure>
	);
}
