import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { BASE_PATH } from "../lib/base";
import { DEFAULT_DOC_TITLE, PRODUCT_NAME } from "../lib/brand";
import { useSetupStatus } from "../hooks/useSetupStatus";
import { Button } from "../ui/button";
import { cn } from "../ui/cn";
import { duration, ease } from "../ui/motion";
import { SettingCard } from "../ui/settings";
import { LoadingState } from "../ui/state";
import { EngineRow, SetupChecklist } from "./SetupChecklist";
import { IdentityCard } from "./SetupIdentity";
import { IntegrationsList } from "./SetupIntegrations";
import { ReposSection } from "./SetupRepos";
import { SetupRestart } from "./SetupRestart";
import {
	ClaudeAccountsSection,
	CodexAccountsSection,
} from "./settings/ModelAccounts";
import { ModelProvidersPanel } from "./ModelProviders";
import { ModelDefaultsSection } from "./Models";
import { IconCheck, IconChevronLeft } from "./icons";

interface FirstMileStep {
	id: "welcome" | "connections" | "ai" | "repos" | "identity" | "ready";
	label: string;
	title: string;
	description: string;
}

const STEPS: FirstMileStep[] = [
	{
		id: "welcome",
		label: "Welcome",
		title: `Your ${PRODUCT_NAME} is ready`,
		description:
			"Connect the tools and models your team uses, then start your first session.",
	},
	{
		id: "connections",
		label: "Connections",
		title: "Connect your work",
		description:
			"Bring in code, conversations, issues, support, and observability. Set up what you use now and add the rest later.",
	},
	{
		id: "ai",
		label: "AI",
		title: "Choose your AI",
		description:
			"Connect Claude, OpenAI Codex, or another provider, then choose the default for new sessions.",
	},
	{
		id: "repos",
		label: "Repositories",
		title: "Add repositories",
		description:
			"Register the codebases sessions can work in. Each session gets its own isolated worktree.",
	},
	{
		id: "identity",
		label: "Identity",
		title: "Make it yours",
		description:
			"Choose the names this instance and its agent use when they introduce themselves.",
	},
	{
		id: "ready",
		label: "Ready",
		title: "Start your first session",
		description:
			"Review what is connected. You can change every choice later in Settings.",
	},
];

const CONNECTION_ORDER = [
	"github",
	"linear",
	"slack",
	"plain",
	"codestorage",
	"stripe",
	"grafana",
];

export function FirstMile({ onDone }: { onDone: () => void }) {
	const setup = useSetupStatus();
	const { status, failed, refetch } = setup;
	const [index, setIndex] = useState(0);
	const [direction, setDirection] = useState(1);
	const [aiRevision, setAiRevision] = useState(0);
	const headingRef = useRef<HTMLHeadingElement>(null);
	const reducedMotion = useReducedMotion();
	const step = STEPS[index]!;

	useEffect(() => {
		document.title = `Welcome to ${PRODUCT_NAME}`;
		return () => {
			document.title = DEFAULT_DOC_TITLE;
		};
	}, []);

	useEffect(() => {
		if (index > 0) headingRef.current?.focus({ preventScroll: true });
	}, [index]);

	function goTo(next: number) {
		const nextIndex = Math.min(Math.max(next, 0), STEPS.length - 1);
		if (nextIndex === index) return;
		setDirection(nextIndex > index ? 1 : -1);
		setIndex(nextIndex);
		void refetch();
	}

	async function refreshAi() {
		setAiRevision((revision) => revision + 1);
		await refetch();
	}

	const variants = {
		initial: (travel: number) => ({
			opacity: 0,
			x: reducedMotion ? 0 : travel * 34,
		}),
		animate: { opacity: 1, x: 0 },
		exit: (travel: number) => ({
			opacity: 0,
			x: reducedMotion ? 0 : travel * -22,
		}),
	};

	return (
		<div
			data-first-mile
			className="relative grid h-[100dvh] min-h-[560px] w-full grid-rows-[76px_minmax(0,1fr)_84px] overflow-hidden bg-bg text-fg phone:min-h-[620px] phone:grid-rows-[68px_minmax(0,1fr)_78px]"
		>
			<div
				className="pointer-events-none absolute inset-0 opacity-70 [background:radial-gradient(circle_at_18%_8%,var(--accent-soft),transparent_34%),radial-gradient(circle_at_82%_92%,var(--blue-soft),transparent_36%)]"
				aria-hidden="true"
			/>

			<header className="relative z-10 grid grid-cols-[1fr_auto_1fr] items-center px-8 phone:px-4">
				<div className="flex min-w-0 items-center gap-2.5">
					<img
						src={`${BASE_PATH}/mac-app-icon.png`}
						alt=""
						className="size-9 rounded-md shadow-sm phone:size-8"
					/>
					<span className="truncate text-label font-semibold text-fg phone:hidden">
						{PRODUCT_NAME}
					</span>
				</div>

				<nav className="flex items-center gap-2" aria-label="Onboarding progress">
					{STEPS.map((item, itemIndex) => (
						<button
							key={item.id}
							type="button"
							aria-label={`${itemIndex + 1}. ${item.label}`}
							aria-current={itemIndex === index ? "step" : undefined}
							onClick={() => goTo(itemIndex)}
							className={cn(
								"focus-ring h-2 cursor-pointer rounded-full transition-[width,background-color] duration-200",
								itemIndex === index
									? "w-8 bg-fg"
									: itemIndex < index
										? "w-2 bg-fg/45"
										: "w-2 bg-faint/35 hover:bg-faint/60",
							)}
						/>
					))}
				</nav>

				<div className="justify-self-end text-meta tabular-nums text-faint">
					{index + 1} of {STEPS.length}
				</div>
			</header>

			<main className="relative z-10 min-h-0 overflow-y-auto px-6 [scrollbar-width:thin] phone:px-4">
				{!status ? (
					<div className="flex h-full items-center justify-center">
						<LoadingState>
							{failed ? "Couldn't load setup." : "Preparing your workspace…"}
						</LoadingState>
					</div>
				) : (
					<AnimatePresence initial={false} mode="wait" custom={direction}>
						<motion.section
							key={step.id}
							custom={direction}
							variants={variants}
							initial="initial"
							animate="animate"
							exit="exit"
							transition={{
								type: "tween",
								duration: reducedMotion ? duration.micro : duration.large,
								ease,
							}}
							className={cn(
								"mx-auto flex min-h-full w-full max-w-[960px] flex-col items-center py-8 phone:py-5",
								step.id === "welcome" && "justify-center pb-16 phone:pb-10",
							)}
						>
							{step.id === "welcome" ? (
								<div className="flex max-w-[720px] flex-col items-center text-center">
									<img
										src={`${BASE_PATH}/mac-app-icon.png`}
										alt=""
										className="mb-8 size-24 rounded-xl shadow-[0_24px_80px_rgba(0,0,0,0.16)] phone:mb-6 phone:size-20"
									/>
									<p className="m-0 mb-3 text-label font-semibold text-faint">
										Server connected
									</p>
									<h1
										ref={headingRef}
										className="m-0 text-center text-[clamp(2.4rem,5vw,5rem)] font-title leading-[0.98] tracking-[-0.055em] text-fg outline-none"
									>
										{step.title}
									</h1>
									<p className="m-0 mt-6 max-w-[46ch] text-[clamp(1rem,1.5vw,1.25rem)] leading-relaxed text-dim text-pretty phone:mt-5">
										{step.description}
									</p>
									<div className="mt-8 rounded-[999px] bg-panel px-4 py-2 text-label text-dim shadow-sm phone:max-w-full phone:truncate">
										{status.publicBaseUrl}
									</div>
								</div>
							) : (
								<>
									<div className="mb-8 max-w-[700px] text-center phone:mb-6">
										<p className="m-0 mb-2 text-label font-semibold text-faint">
											Step {index + 1}
										</p>
										<h1
											ref={headingRef}
											tabIndex={-1}
											className="m-0 text-[clamp(2rem,4vw,3.5rem)] font-title leading-[1.04] tracking-[-0.045em] text-fg outline-none"
										>
											{step.title}
										</h1>
										<p className="m-0 mt-4 max-w-[58ch] text-body leading-relaxed text-dim text-pretty">
											{step.description}
										</p>
									</div>

									<div className="w-full max-w-[820px] pb-8">
										{step.id === "connections" && (
											<IntegrationsList
												integrations={status.integrations
													.slice()
													.sort(
														(a, b) =>
															CONNECTION_ORDER.indexOf(a.id) -
															CONNECTION_ORDER.indexOf(b.id),
													)}
												publicBaseUrl={status.publicBaseUrl}
												onSaved={setup.applyIntegration}
											/>
										)}
										{step.id === "ai" && (
											<div className="flex flex-col gap-4">
												<SettingCard>
													<EngineRow engine={status.engine} onChanged={refetch} />
												</SettingCard>
												<ClaudeAccountsSection compact onChanged={refreshAi} />
												<CodexAccountsSection compact onChanged={refreshAi} />
												<ModelProvidersPanel compact onChanged={refreshAi} />
												<ModelDefaultsSection
													key={aiRevision}
													compact
													onChanged={refreshAi}
												/>
											</div>
										)}
										{step.id === "repos" && (
											<ReposSection repos={status.repos} onChanged={refetch} />
										)}
										{step.id === "identity" && <IdentityCard />}
										{step.id === "ready" && (
											<>
												<div className="mx-auto mb-6 flex size-16 items-center justify-center rounded-full bg-green-soft text-green">
													<IconCheck size={30} />
												</div>
												<SetupChecklist status={status} onChanged={refetch} />
											</>
										)}
									</div>
								</>
							)}
						</motion.section>
					</AnimatePresence>
				)}
			</main>

			<footer className="relative z-10 grid grid-cols-[1fr_auto_1fr] items-center bg-[linear-gradient(to_bottom,transparent,var(--bg)_30%)] px-8 pt-3 phone:px-4">
				<Button
					variant="ghost"
					size="lg"
					icon={<IconChevronLeft size={18} />}
					onClick={() => goTo(index - 1)}
					className={cn("justify-self-start", index === 0 && "invisible")}
				>
					Back
				</Button>

				{index > 0 && index < STEPS.length - 1 ? (
					<button
						type="button"
						onClick={() => goTo(index + 1)}
						className="focus-ring min-h-11 rounded-control px-3 text-label font-medium text-dim hover:text-fg phone:invisible"
					>
						Do this later
					</button>
				) : (
					<span />
				)}

				<Button
					variant="primary"
					size="lg"
					onClick={() => {
						if (index === STEPS.length - 1) onDone();
						else goTo(index + 1);
					}}
					disabled={!status}
					className="justify-self-end"
				>
					{index === 0
						? "Start setup"
						: index === STEPS.length - 1
							? `Enter ${PRODUCT_NAME}`
							: index === STEPS.length - 2
								? "Review"
								: "Next"}
				</Button>
			</footer>

			<SetupRestart setup={setup} />
		</div>
	);
}
