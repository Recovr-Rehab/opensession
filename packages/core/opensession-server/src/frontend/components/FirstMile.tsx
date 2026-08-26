import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { BASE_PATH } from "../lib/base";
import { DEFAULT_DOC_TITLE, PRODUCT_NAME } from "../lib/brand";
import { useSetupStatus } from "../hooks/useSetupStatus";
import { effectiveTheme, onThemeChanged } from "../lib/theme";
import { Button } from "../ui/button";
import { cn } from "../ui/cn";
import { duration, ease } from "../ui/motion";
import { LoadingState } from "../ui/state";
import { BrandMark } from "./BrandTile";
import { GithubAuthCard } from "./SetupIntegrations";
import { ReposSection } from "./SetupRepos";
import { SetupRestart } from "./SetupRestart";
import { TeamSection } from "./SetupTeam";
import { UserAvatar } from "./UserAvatar";
import { OrganizationProfileSection } from "./settings/GeneralPanel";
import { ProviderAccountsSection } from "./settings/ModelAccounts";
import { IconCheck, IconChevronLeft, IconGlobe, IconRepo } from "./icons";
import { githubAuthState, type SetupStatus } from "./setup-shared";

interface FirstMileStep {
	id: "welcome" | "github" | "organization" | "team" | "ai" | "repos" | "ready";
	label: string;
	title: string;
	description: string;
}

// Organization and model setup come first. GitHub App creation no longer
// depends on a public callback origin: the manifest returns its credentials to
// the private app, while Domains and public callbacks stay in Settings. Members
// sit after repositories, since an identity is worth more once there is something
// to act on. Members remain independent from the optional GitHub sign-in gate.
const STEPS: FirstMileStep[] = [
	{
		id: "welcome",
		label: "Welcome",
		title: `Welcome to ${PRODUCT_NAME}`,
		description: "Set up this server before you start using Open Session.",
	},
	{
		id: "organization",
		label: "Organization",
		title: "Your organization",
		description: "Choose how your organization appears to your team in Open Session.",
	},
	{
		id: "ai",
		label: "Models",
		title: "Models",
		description: "Connect the AI subscriptions your team will use to run sessions.",
	},
	{
		id: "github",
		label: "GitHub",
		title: "Connect GitHub",
		description: "Connect a GitHub App so sessions can access repositories, push changes, and create and review pull requests.",
	},
	{
		id: "repos",
		label: "Repositories",
		title: "Repositories",
		description: "Add the repositories you want sessions to work in.",
	},
	{
		id: "team",
		label: "Members",
		title: "Add members",
		description: "Add yourself and anyone else sessions can act as. GitHub usernames are optional.",
	},
	{
		id: "ready",
		label: "Ready",
		title: "You’re ready",
		description: "Review your setup before entering Open Session.",
	},
];

function githubOrganizationImportEnabled(status: SetupStatus | null): boolean {
	return Boolean(
		status?.github.userPrAuth &&
			status.github.clientIdConfigured &&
			status.github.appOrg,
	);
}

function initialFirstMileIndex(): number {
	if (typeof window === "undefined") return 0;
	const stored = window.sessionStorage.getItem("opensession:first-mile-step");
	window.sessionStorage.removeItem("opensession:first-mile-step");
	const requested =
		new URLSearchParams(window.location.search).get("step") || stored;
	if (!requested) return 0;
	const index = STEPS.findIndex((item) => item.id === requested);
	return index < 0 ? 0 : index;
}

/** The GitHub organization this instance is wired to, for the organization
 *  step's defaults. Reads the App's own owner first, then falls back to the
 *  org named in the App-create URL the wizard built. */
function connectedGithubOrganization(status: SetupStatus): string {
	if (status.github.appOrg) return status.github.appOrg;
	try {
		const match = new URL(status.github.appCreateUrl).pathname.match(
			/^\/organizations\/([^/]+)/,
		);
		return match?.[1] ? decodeURIComponent(match[1]) : "";
	} catch {
		return "";
	}
}

function PreviewOverflow({
	count,
	transparent = false,
}: {
	count: number;
	transparent?: boolean;
}) {
	if (count <= 0) return null;
	return (
		<span
			className={cn(
				"flex size-7 items-center justify-center rounded-full border text-meta font-semibold text-dim",
				transparent ? "border-transparent bg-transparent" : "border-bg bg-bg/85",
			)}
		>
			+{count}
		</span>
	);
}

function FirstMileSummary({
	status,
	onSelect,
}: {
	status: SetupStatus;
	onSelect: (step: FirstMileStep["id"]) => void;
}) {
	const github = githubAuthState(status.github);
	let serverHost = status.publicBaseUrl;
	try {
		serverHost = new URL(status.publicBaseUrl).host;
	} catch {}
	let githubOrganization = status.github.appOrg || "";
	if (!githubOrganization) {
		try {
			const match = new URL(status.github.appCreateUrl).pathname.match(/^\/organizations\/([^/]+)/);
			githubOrganization = match?.[1] ? decodeURIComponent(match[1]) : "";
		} catch {}
	}
	const accountCount = status.engine.claudeAccounts + status.engine.codexAccounts;
	const accounts = [
		...Array.from({ length: status.engine.claudeAccounts }, () => ({
			label: "Claude subscription",
			provider: "claude" as const,
		})),
		...Array.from({ length: status.engine.codexAccounts }, () => ({
			label: "OpenAI subscription",
			provider: "codex" as const,
		})),
	];
	const tiles = [
		{
			title: "Server",
			step: null,
			ready: true,
			label: "Online",
			preview: (
				<div className="flex max-w-full items-center gap-1.5 rounded-full bg-bg/65 py-1 pr-2 pl-1 text-meta font-medium text-fg">
					<span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-bg/85 text-dim">
						<IconGlobe size={15} />
					</span>
					<span className="truncate">{serverHost}</span>
				</div>
			),
		},
		{
			title: "GitHub",
			step: "github" as const,
			ready: github.tone === "on",
			label: github.label,
			preview: (
				<div className="flex max-w-full items-center gap-1.5 rounded-full bg-bg/65 py-1 pr-2 pl-1 text-meta font-medium text-fg">
					{githubOrganization ? (
						<span className="relative flex size-6 shrink-0">
							<UserAvatar
								name={githubOrganization}
								login={githubOrganization}
								size={24}
								className="rounded-full"
							/>
							<span className="absolute -right-0.5 -bottom-0.5 flex size-2.5 items-center justify-center rounded-full bg-fg text-bg ring-1 ring-bg">
								<BrandMark name="github" size={7} />
							</span>
						</span>
					) : (
						<span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-fg text-bg">
							<BrandMark name="github" size={15} />
						</span>
					)}
					<span className="truncate">{githubOrganization || "GitHub"}</span>
				</div>
			),
		},
		{
			title: "AI subscriptions",
			step: "ai" as const,
			ready: status.engine.ready,
			label: `${accountCount} ${accountCount === 1 ? "account" : "accounts"} connected`,
			preview: (
				<div className="flex -space-x-2">
					{accounts.slice(0, 4).map((account, index) => (
						<span
							key={`${account.provider}-${index}`}
							title={account.label}
							className="flex size-7 items-center justify-center rounded-full border border-bg bg-bg/85 text-fg"
						>
							<BrandMark name={account.provider} size={15} />
						</span>
					))}
					<PreviewOverflow count={accounts.length - 4} />
				</div>
			),
		},
		{
			title: "Repositories",
			step: "repos" as const,
			ready: status.repos.length > 0,
			label: status.repos.length > 0 ? `${status.repos.length} added` : "None added",
			preview: (
				<div className="flex -space-x-2">
					{status.repos.slice(0, 4).map((repo) => (
						<span
							key={repo.id}
							title={repo.label}
							className="flex size-7 items-center justify-center rounded-full border border-bg bg-bg/85 text-dim"
						>
							<IconRepo size={14} />
						</span>
					))}
					<PreviewOverflow count={status.repos.length - 4} />
				</div>
			),
		},
		{
			title: "Team",
			step: "team" as const,
			ready: status.team.count > 0,
			label:
				status.team.count > 0
					? `${status.team.count} ${status.team.count === 1 ? "member" : "members"}`
					: "No members",
			preview: (
				<div className="flex -space-x-2">
					{status.team.names.slice(0, 4).map((name) => (
						<UserAvatar key={name} name={name} size={28} className="border border-bg" />
					))}
					<PreviewOverflow count={status.team.names.length - 4} transparent />
				</div>
			),
		},
	];

	return (
		<div
			className={cn(
				"grid gap-4 phone:grid-cols-2 phone:gap-3",
				"grid-cols-5",
			)}
		>
			{tiles.map((tile) => {
				const className = cn(
					"flex aspect-square min-w-0 flex-col justify-between rounded-3xl border p-5 text-left backdrop-blur-xl phone:rounded-2xl phone:p-3.5",
					tile.step &&
						"focus-ring cursor-pointer transition-[transform,filter] duration-150 hover:brightness-[0.98] active:scale-[0.96] motion-reduce:transform-none",
					tile.ready
						? "border-transparent bg-green-soft shadow-[inset_0_1px_0_color-mix(in_srgb,white_45%,transparent),0_12px_28px_-24px_color-mix(in_srgb,var(--green)_45%,transparent)]"
						: "border-divider-soft bg-settings-plate/65",
				);
				const content = (
					<>
						<div className="flex min-w-0 items-start justify-between gap-2">
							<div className="min-w-0">{tile.preview}</div>
							<div
								className={cn(
									"flex size-8 shrink-0 items-center justify-center rounded-full",
									tile.ready ? "bg-green text-white" : "bg-faint/10 text-faint",
								)}
							>
								{tile.ready ? (
									<IconCheck size={18} />
								) : (
									<span className="size-2 rounded-full bg-current" />
								)}
							</div>
						</div>
						<div className="min-w-0">
							<div className="text-item-title font-semibold text-fg">{tile.title}</div>
							<div className="mt-1 text-supporting leading-snug text-dim">{tile.label}</div>
						</div>
					</>
				);
				return tile.step ? (
					<button
						type="button"
						key={tile.title}
						onClick={() => onSelect(tile.step)}
						aria-label={`Edit ${tile.title}`}
						className={className}
					>
						{content}
					</button>
				) : (
					<div key={tile.title} className={className}>
						{content}
					</div>
				);
			})}
		</div>
	);
}

export function FirstMile({ onDone }: { onDone: () => Promise<void> }) {
	const setup = useSetupStatus();
	const { status, failed, refetch } = setup;
	const [index, setIndex] = useState(initialFirstMileIndex);
	const [direction, setDirection] = useState(1);
	const [finishing, setFinishing] = useState(false);
	const [theme, setTheme] = useState(effectiveTheme);
	const headingRef = useRef<HTMLHeadingElement>(null);
	const reducedMotion = useReducedMotion();
	const steps = STEPS;
	const step = steps[index]!;

	useEffect(() => {
		document.title = `Welcome to ${PRODUCT_NAME}`;
		return () => {
			document.title = DEFAULT_DOC_TITLE;
		};
	}, []);

	useEffect(() => onThemeChanged(() => setTheme(effectiveTheme())), []);

	useEffect(() => {
		if (index > 0) headingRef.current?.focus({ preventScroll: true });
	}, [index]);

	async function goTo(next: number) {
		const nextIndex = Math.min(Math.max(next, 0), steps.length - 1);
		if (nextIndex === index) return;
		setDirection(nextIndex > index ? 1 : -1);
		setIndex(nextIndex);
		void refetch();
	}

	async function finish() {
		if (finishing) return;
		setFinishing(true);
		await onDone();
		setFinishing(false);
	}

	const revealTransition = (delay = 0) => ({
		type: "tween" as const,
		duration: reducedMotion ? duration.micro : duration.base,
		ease,
		delay: reducedMotion ? 0 : delay,
	});
	const backdropName =
		theme === "dark" ? "onboarding-bg-dark" : "onboarding-bg";
	const nextLabel =
		index === 0
			? "Setup server"
			: index === steps.length - 1
				? finishing
					? "Finishing…"
					: null
				: index === steps.length - 2
					? "Review"
					: "Next";

	return (
		<div
			data-first-mile
			className="relative flex h-[100dvh] w-full items-center justify-center overflow-hidden bg-surface bg-cover bg-center p-6 text-fg phone:px-3 phone:pb-[max(12px,env(safe-area-inset-bottom))] phone:pt-[max(12px,env(safe-area-inset-top))]"
			// The vendored marketing artwork keeps first run independent of a CDN.
			style={{ backgroundImage: `url(${BASE_PATH}/${backdropName}.webp)` }}
		>
			{!status ? (
				<div className="flex min-h-40 w-full max-w-[560px] items-center justify-center rounded-2xl bg-palette-glass px-8 py-12 [--smooth-ring-color:var(--dialog-ring)] [backdrop-filter:var(--popup-blur)] smooth-shadow-ring-lg">
					<LoadingState>
						{failed ? "Couldn't load setup." : "Preparing your workspace…"}
					</LoadingState>
				</div>
			) : (
				<motion.section
					layout
					transition={{
						layout: {
							type: "spring",
							duration: reducedMotion ? duration.micro : duration.large,
							bounce: 0,
						},
					}}
					className={cn(
						"relative z-10 flex max-h-full w-full flex-col overflow-hidden rounded-2xl bg-palette-glass [--smooth-ring-color:var(--dialog-ring)] [backdrop-filter:var(--popup-blur)] smooth-shadow-ring-lg",
						step.id === "welcome"
							? "max-w-[560px]"
							: step.id === "ready"
								? "max-w-[1240px]"
								: "max-w-[860px]",
					)}
				>
					<AnimatePresence initial={false} mode="popLayout" custom={direction}>
						<motion.div key={step.id} layout className="flex min-h-0 flex-col">
							<header className="shrink-0 px-10 pb-2 pt-9 text-center phone:px-5 phone:pt-6">
								<motion.h1
									ref={headingRef}
									tabIndex={index > 0 ? -1 : undefined}
									initial={{
										opacity: 0,
										transform: reducedMotion ? "none" : "translateY(8px)",
									}}
									animate={{
										opacity: 1,
										transform: "translateY(0px)",
										transition: revealTransition(0.02),
									}}
									exit={{
										opacity: 0,
										transform: reducedMotion ? "none" : "translateY(-4px)",
									}}
									transition={revealTransition()}
									className="m-0 text-balance text-page-title font-title leading-[1.1] tracking-[-0.025em] text-fg outline-none phone:text-section-title"
								>
									{step.title}
								</motion.h1>
							</header>

							<motion.div
								initial={{
									opacity: 0,
									transform: reducedMotion
										? "none"
										: `translateY(10px) translateX(${direction * 8}px)`,
								}}
								animate={{
									opacity: 1,
									transform: "translateY(0px) translateX(0px)",
									transition: revealTransition(0.11),
								}}
								exit={{
									opacity: 0,
									transform: reducedMotion
										? "none"
										: `translateY(-4px) translateX(${direction * -6}px)`,
								}}
								transition={revealTransition()}
								className="min-h-0 overflow-y-auto overscroll-contain px-10 pb-9 pt-5 [scrollbar-width:thin] phone:px-4 phone:pb-6 phone:pt-4"
							>
								{step.id === "welcome" ? (
									<div className="mx-auto flex max-w-[420px] flex-col items-center py-5 text-center phone:py-3">
										<img
											src={`${BASE_PATH}/mac-app-icon.png`}
											alt=""
											className="size-20 scale-[1.13] [filter:drop-shadow(0_18px_28px_rgba(0,0,0,0.16))] phone:size-16"
										/>
									</div>
								) : (
									<div
										className={cn(
											"mx-auto w-full [&_[data-setting-title]]:text-dialog-title [&_[data-setting-title]]:phone:text-body [&_[data-settings-group-label]]:text-body [&_[data-settings-group-label]]:text-fg [&_[data-settings-hint]]:text-fg",
											step.id === "ready" ? "max-w-[1160px]" : "max-w-[780px]",
											"[&_.bg-settings-plate]:rounded-3xl [&_.bg-settings-plate]:border-divider-soft [&_.bg-settings-plate]:bg-[color-mix(in_srgb,var(--popup-surface)_95%,transparent)] [&_.bg-settings-plate]:shadow-[0_18px_46px_-36px_color-mix(in_srgb,var(--blue)_48%,transparent)] [&_.bg-settings-plate]:[backdrop-filter:blur(14px)_saturate(1.08)]",
											"[&_input]:h-9 [&_input]:min-h-9 [&_input]:px-3 [&_input]:text-base [&_select]:min-h-9 [&_textarea]:min-h-9",
										)}
									>
										{step.id === "github" && (
											<GithubAuthCard
												github={status.github}
												onSaved={setup.applyGithub}
												onboarding
											/>
										)}
										{step.id === "organization" && (
											<OrganizationProfileSection
												githubOrganization={connectedGithubOrganization(status)}
												onboarding
											/>
										)}
										{step.id === "team" && (
											<TeamSection
												onChanged={refetch}
												title="Members"
												showCount
												onboarding
												syncGithubOrganization={githubOrganizationImportEnabled(status)}
												compact
											/>
										)}
										{step.id === "ai" && (
											<ProviderAccountsSection onboarding onChanged={refetch} />
										)}
										{step.id === "repos" && (
											<ReposSection
												repos={status.repos}
												onChanged={refetch}
												compact
												showLifecycleStatus={false}
											/>
										)}
										{step.id === "ready" && (
											<FirstMileSummary
												status={status}
												onSelect={(stepId) =>
													goTo(steps.findIndex((item) => item.id === stepId))
												}
											/>
										)}
									</div>
								)}
							</motion.div>
						</motion.div>
					</AnimatePresence>

					<motion.footer
						layout="position"
						className="relative z-20 shrink-0 border-t border-divider-soft bg-[color-mix(in_srgb,var(--popup-surface)_76%,transparent)] px-6 py-4 [backdrop-filter:blur(18px)_saturate(1.12)] phone:px-3 phone:py-3"
					>
						<div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3">
							<Button
								variant="soft"
								size="lg"
								icon={<IconChevronLeft size={18} />}
								onClick={() => goTo(index - 1)}
								aria-label="Back"
								className={cn(
									"min-h-11 justify-self-start px-4 phone:size-11 phone:justify-center phone:p-0",
									index === 0 && "invisible pointer-events-none",
								)}
							>
								<span className="phone:hidden">Back</span>
							</Button>

							<div
								role="progressbar"
								aria-label="Onboarding progress"
								aria-valuemin={1}
								aria-valuemax={steps.length}
								aria-valuenow={index + 1}
								aria-valuetext={`${step.label}, step ${index + 1} of ${steps.length}`}
								className="flex items-center justify-center gap-1.5"
							>
								{steps.map((item, stepIndex) => (
									<span
										key={item.id}
										aria-hidden="true"
										className={cn(
											"h-1.5 rounded-full transition-[width,background-color,opacity] duration-[var(--dur)] ease-[var(--ease)] motion-reduce:transition-none",
											stepIndex === index
												? "w-6 bg-fg"
												: stepIndex < index
													? "w-1.5 bg-fg/45"
													: "w-1.5 bg-faint/35",
										)}
									/>
								))}
							</div>

							<Button
								variant="primary"
								size="lg"
								onClick={() => {
									if (index === steps.length - 1) void finish();
									else goTo(index + 1);
								}}
								disabled={finishing}
								className="min-h-11 justify-self-end px-4"
							>
								{nextLabel ?? (
									<>
										<span className="phone:hidden">Enter {PRODUCT_NAME}</span>
										<span className="desktop:hidden">Enter</span>
									</>
								)}
							</Button>
						</div>
					</motion.footer>
				</motion.section>
			)}

			<SetupRestart setup={setup} />
		</div>
	);
}
