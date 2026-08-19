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
		label: "Organization",
		title: `Welcome to ${PRODUCT_NAME}`,
		description:
			"Set up a new organization or continue with one that already exists.",
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
	const [footerSeparated, setFooterSeparated] = useState(false);
	const headingRef = useRef<HTMLHeadingElement>(null);
	const mainRef = useRef<HTMLElement>(null);
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

	useEffect(() => {
		const main = mainRef.current;
		if (!main) return;
		const update = () => {
			const remaining = main.scrollHeight - main.scrollTop - main.clientHeight;
			setFooterSeparated(remaining > 1);
		};
		update();
		main.addEventListener("scroll", update, { passive: true });
		const resize = new ResizeObserver(update);
		resize.observe(main);
		const mutation = new MutationObserver(update);
		mutation.observe(main, { childList: true, subtree: true });
		return () => {
			main.removeEventListener("scroll", update);
			resize.disconnect();
			mutation.disconnect();
		};
	}, [index, status]);

	function goTo(next: number) {
		const nextIndex = Math.min(Math.max(next, 0), STEPS.length - 1);
		if (nextIndex === index) return;
		setDirection(nextIndex > index ? 1 : -1);
		setIndex(nextIndex);
		void refetch();
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
				<div />

				<nav
					className={cn("flex items-center gap-2", index === 0 && "invisible")}
					aria-label="Onboarding progress"
				>
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

				{index > 0 && index < STEPS.length - 1 ? (
					<button
						type="button"
						onClick={() => goTo(index + 1)}
						className="focus-ring min-h-9 justify-self-end rounded-control px-3 text-label font-medium text-dim hover:bg-hover hover:text-fg"
					>
						Skip
					</button>
				) : (
					<div />
				)}
			</header>

			<main
				ref={mainRef}
				className="relative z-10 min-h-0 overflow-y-auto px-6 [scrollbar-width:thin] phone:px-4"
			>
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
								<div className="flex max-w-[560px] flex-col items-center text-center">
									<img
										src={`${BASE_PATH}/mac-app-icon.png`}
										alt=""
										className="mb-7 size-20 scale-[1.13] [filter:drop-shadow(0_18px_28px_rgba(0,0,0,0.16))] phone:mb-6 phone:size-16"
									/>
									<h1
										ref={headingRef}
										className="m-0 text-center text-[clamp(1.6rem,2vw,2.15rem)] font-title leading-[1.08] tracking-[-0.03em] text-fg outline-none"
									>
										{step.title}
									</h1>
									<p className="m-0 mt-4 max-w-[42ch] text-body leading-relaxed text-dim text-pretty">
										{step.description}
									</p>
									<div className="mt-8 flex w-full max-w-[300px] flex-col gap-3">
										<Button
											variant="primary"
											size="lg"
											onClick={() => goTo(1)}
											className="min-h-11 w-full justify-center"
										>
											Create a new organization
										</Button>
										<Button
											variant="soft"
											size="lg"
											onClick={onDone}
											className="min-h-11 w-full justify-center"
										>
											Use an existing organization
										</Button>
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
											className="m-0 text-[clamp(1.6rem,2.5vw,2.25rem)] font-title leading-[1.08] tracking-[-0.035em] text-fg outline-none"
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
												<ClaudeAccountsSection />
												<CodexAccountsSection />
												<ModelProvidersPanel />
												<ModelDefaultsSection />
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

			<footer
				className={cn(
					"relative z-10 grid grid-cols-[1fr_auto_1fr] items-center border-t px-8 pt-3 transition-[border-color,background-color] phone:px-4",
					footerSeparated
						? "border-line bg-bg/95 backdrop-blur-xl"
						: "border-transparent bg-[linear-gradient(to_bottom,transparent,var(--bg)_30%)]",
					index === 0 && "invisible",
				)}
			>
				<Button
					variant="ghost"
					size="lg"
					icon={<IconChevronLeft size={18} />}
					onClick={() => goTo(index - 1)}
					className={cn("justify-self-start", index === 0 && "invisible")}
				>
					Back
				</Button>

				<span />

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
						? "Continue"
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
