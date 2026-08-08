import React, { useEffect, useState } from "react";
import { useSetupStatus } from "../hooks/useSetupStatus";
import { DEFAULT_DOC_TITLE, docTitle } from "../lib/brand";
import { Button } from "../ui/button";
import { cn } from "../ui/cn";
import {
	SettingCard,
	SettingsHeader,
	SettingsHint,
	SettingsPanel,
} from "../ui/settings";
import { LoadingState } from "../ui/state";
import { EngineRow, SetupChecklist } from "./SetupChecklist";
import { IdentityCard } from "./SetupIdentity";
import { GithubAuthCard, IntegrationsList } from "./SetupIntegrations";
import { ReposSection } from "./SetupRepos";
import { SetupRestart } from "./SetupRestart";
import { TeamSection } from "./SetupTeam";
import {
	Code,
	chipDotColor,
	githubAuthState,
	integrationState,
	type ChipTone,
	type SetupStatus,
	type SetupStepId,
} from "./setup-shared";

// Settings → Setup: bringing a fresh instance up, one step at a time. On a
// first run nothing else in the UI says what an instance needs — an engine
// that can run a turn, repos to work in, the people it acts for, and the
// credentials for anything it should reach — so this walks through them in
// that order and ends on a review of what's still missing.
//
// Every step is also a Workspace settings page of its own (Identity,
// Repositories, Members, Integrations), rendered from these same components:
// the wizard is for the first hour, the pages are for the next year. Nothing
// here is a second implementation of a setting — a step is a heading, a
// sentence, and the same section the settings page shows.

interface StepDef {
	id: SetupStepId;
	/** Short label for the step rail. */
	label: string;
	title: string;
	description: React.ReactNode;
}

const STEPS: StepDef[] = [
	{
		id: "engine",
		label: "Engine",
		title: "Engine",
		description:
			"The model capacity sessions run on. Without this nothing else on this page matters — no session can run a single turn.",
	},
	{
		id: "identity",
		label: "Identity",
		title: "Identity",
		description:
			"What this instance and its agent are called, everywhere they introduce themselves. Optional — both have defaults.",
	},
	{
		id: "repos",
		label: "Repositories",
		title: "Repositories",
		description:
			"The repos sessions work in. Registering clones the repo onto the server; sessions then branch into isolated worktrees of it.",
	},
	{
		id: "team",
		label: "Members",
		title: "Members",
		description:
			"Everyone who uses this instance. The identity table drives commit attribution, access scoping and GitHub sign-in, so add the people before the credentials.",
	},
	{
		id: "integrations",
		label: "Integrations",
		title: "Integrations",
		description:
			"The tools the agent can reach — Slack, Linear, Plain, Stripe, Grafana, GitHub. Paste the credentials, flip the switch, save. All optional; connect what you use.",
	},
	{
		id: "github",
		label: "GitHub sign-in",
		title: "GitHub sign-in",
		description:
			"Let teammates sign in with GitHub and open PRs as themselves instead of as the bot account.",
	},
	{
		id: "review",
		label: "Review",
		title: "Review",
		description:
			"What's wired up, and what's still missing. Every row here stays reachable from its own page under Workspace.",
	},
];

/** A step's state for the rail, or null when the step has nothing to report
 *  (identity always has a value; review is a summary of the others). */
function stepTone(id: SetupStepId, status: SetupStatus): ChipTone | null {
	switch (id) {
		case "engine":
			return status.engine.ready ? "on" : "warn";
		case "repos":
			return status.repos.length > 0 ? "on" : "warn";
		case "team":
			return status.team.count > 0 ? "on" : "warn";
		case "github":
			return githubAuthState(status.github).tone;
		case "integrations": {
			const tones = status.integrations.map((i) => integrationState(i).tone);
			if (tones.some((t) => t === "warn")) return "warn";
			return tones.some((t) => t === "on") ? "on" : "off";
		}
		default:
			return null;
	}
}

/** The step rail: every step, its state, and a way straight to it. It doubles
 *  as the progress indicator — a wizard that hides where you are in it is
 *  just a form with extra clicks. */
function StepRail({
	current,
	status,
	onSelect,
}: {
	current: number;
	status: SetupStatus;
	onSelect: (index: number) => void;
}) {
	return (
		<nav aria-label="Setup steps" className="mb-5 flex flex-wrap gap-1 px-4">
			{STEPS.map((step, i) => {
				const tone = stepTone(step.id, status);
				const active = i === current;
				return (
					<button
						key={step.id}
						type="button"
						aria-current={active ? "step" : undefined}
						onClick={() => onSelect(i)}
						className={cn(
							"focus-ring flex items-center gap-1.5 rounded-control px-2 py-1 text-label transition-colors",
							active
								? "bg-active font-medium text-fg"
								: "text-dim hover:bg-hover hover:text-fg",
						)}
					>
						<span
							className={cn(
								"h-1.5 w-1.5 shrink-0 rounded-full",
								!tone && "border border-current opacity-40",
							)}
							style={tone ? { background: chipDotColor(tone) } : undefined}
						/>
						{step.label}
					</button>
				);
			})}
		</nav>
	);
}

export function SetupPanel({ onDone }: { onDone?: () => void }) {
	const setup = useSetupStatus();
	const { status, failed, refetch } = setup;
	const [index, setIndex] = useState(0);

	useEffect(() => {
		document.title = docTitle("Setup");
		return () => {
			document.title = DEFAULT_DOC_TITLE;
		};
	}, []);

	const step = STEPS[index]!;
	const last = index === STEPS.length - 1;

	function goTo(next: number) {
		setIndex(Math.min(Math.max(next, 0), STEPS.length - 1));
		// A step change is a page change: start it at the top, the way the
		// settings pages these steps mirror open.
		document
			.querySelector("[data-settings-scroll]")
			?.scrollTo({ top: 0, behavior: "smooth" });
	}

	function jumpTo(id: SetupStepId) {
		const i = STEPS.findIndex((s) => s.id === id);
		if (i >= 0) goTo(i);
	}

	return (
		<SettingsPanel className="relative">
			<SettingsHeader
				title="Setup"
				description="What a new instance needs, one step at a time. Every step is also a page of its own under Workspace."
			/>
			{!status ? (
				<LoadingState>
					{failed ? "Couldn't load setup status." : "Loading…"}
				</LoadingState>
			) : (
				<>
					<StepRail current={index} status={status} onSelect={goTo} />

					<div className="px-4">
						<h2 className="m-0 text-section-title font-semibold text-fg">
							{step.title}
						</h2>
						<p className="m-0 mt-1 text-supporting leading-relaxed text-dim">
							{step.description}
						</p>
					</div>

					<div className="mt-4">
						{step.id === "engine" && (
							<>
								<SettingCard>
									<EngineRow engine={status.engine} onChanged={refetch} />
								</SettingCard>
								<SettingsHint>
									Which models are available, and which one sessions start on,
									live under Workspace → Models. Accounts you sign into
									yourself are under Personal → My accounts.
								</SettingsHint>
							</>
						)}
						{step.id === "identity" && <IdentityCard />}
						{step.id === "repos" && (
							<ReposSection repos={status.repos} onChanged={refetch} />
						)}
						{step.id === "team" && <TeamSection onChanged={refetch} />}
						{step.id === "integrations" && (
							<IntegrationsList
								integrations={status.integrations}
								onSaved={setup.applyIntegration}
							/>
						)}
						{step.id === "github" && (
							<>
								<GithubAuthCard
									github={status.github}
									onSaved={setup.applyGithub}
								/>
								<SettingsHint>
									Teammates connect their own accounts under Workspace →
									Connections. Full guide: <Code>docs/setup/github.md</Code>.
								</SettingsHint>
							</>
						)}
						{step.id === "review" && (
							<SetupChecklist
								status={status}
								onChanged={refetch}
								onJump={jumpTo}
							/>
						)}
					</div>

					<div className="mt-8 flex items-center gap-3 px-4">
						<Button
							variant="ghost"
							onClick={() => goTo(index - 1)}
							disabled={index === 0}
						>
							Back
						</Button>
						<span className="flex-1 text-center text-meta tabular-nums text-faint">
							Step {index + 1} of {STEPS.length}
						</span>
						{last ? (
							<Button variant="primary" onClick={onDone} disabled={!onDone}>
								Done
							</Button>
						) : (
							<Button variant="primary" onClick={() => goTo(index + 1)}>
								Next
							</Button>
						)}
					</div>
				</>
			)}
			<SetupRestart setup={setup} />
		</SettingsPanel>
	);
}
