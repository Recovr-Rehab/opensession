import { BASE_PATH } from "../lib/base";
import React, { useEffect, useState } from "react";
import { cn } from "../ui/cn";
import { CopyCheck, useCopy } from "../ui/copy";
import { LoadingState } from "../ui/state";
import {
	SettingCard,
	SettingRow,
	SettingRowDescription,
	SettingRowText,
	SettingRowTitle,
	SettingsGroupLabel,
	SettingsHeader,
	SettingsHint,
	SettingsPanel,
	SettingsSection,
} from "../ui/settings";
import { IconCopy } from "./icons";
import { DEFAULT_DOC_TITLE, docTitle } from "../lib/brand";

// Settings → Setup: per-integration onboarding state with concrete connect
// steps. On a fresh install nothing else in the UI says how to wire up Linear,
// Plain, Slack, Stripe, Grafana or GitHub — this page turns the integration
// registry (surfaced by GET /api/setup/status) into a checklist plus a
// numbered how-to per integration. Read-only: the actual wiring happens in
// ~/.opensession.env + the `opensession` CLI, which is what the steps say.

interface SetupEnvVar {
	name: string;
	required: boolean;
	description: string;
	present: boolean;
}

interface SetupIntegration {
	id: string;
	label: string;
	doc: string;
	enabled: boolean;
	env: SetupEnvVar[];
	missingRequired: string[];
}

interface SetupStatus {
	publicBaseUrl: string;
	repos: { id: string; label: string; path: string }[];
	team: { count: number; names: string[] };
	github: {
		userPrAuth: boolean;
		clientIdConfigured: boolean;
		redirectFlowAvailable: boolean;
		callbackUrl: string;
		botTokenPresent: boolean;
	};
	integrations: SetupIntegration[];
}

type ChipTone = "on" | "warn" | "off";

const CHIP_DOTS: Record<ChipTone, string> = {
	on: "var(--green)",
	warn: "var(--yellow)",
	off: "var(--text-faint)",
};

function StateChip({ tone, label }: { tone: ChipTone; label: string }) {
	return (
		<span className="flex shrink-0 items-center gap-1.5 whitespace-nowrap text-label text-dim">
			<span
				className="h-1.5 w-1.5 rounded-full"
				style={{ background: CHIP_DOTS[tone] }}
			/>
			{label}
		</span>
	);
}

/** Inline monospace token — env var names, CLI commands, paths. Sits as a
 * well on the raised card surface so it reads as literal text to type. */
function Code({
	className,
	children,
}: {
	className?: string;
	children: React.ReactNode;
}) {
	return (
		<code
			className={cn(
				"whitespace-nowrap rounded-sm bg-surface px-1.5 py-0.5 font-mono text-[0.92em] text-fg",
				className,
			)}
		>
			{children}
		</code>
	);
}

/** The callback URL and similar values you paste elsewhere: mono well + the
 * house copy affordance (inline check swap + toast). */
function CopyableCode({ value }: { value: string }) {
	const { copied, copy } = useCopy();
	return (
		<button
			type="button"
			className="inline-flex max-w-full items-center gap-1.5 rounded-sm bg-surface py-0.5 pl-1.5 pr-1 text-left font-mono text-[0.92em] text-fg transition-colors hover:bg-active"
			onClick={() => copy(value, { toast: "Copied" })}
			title="Copy"
		>
			<span className="min-w-0 break-all [overflow-wrap:anywhere] whitespace-normal">
				{value}
			</span>
			<CopyCheck
				copied={copied}
				size={14}
				className="shrink-0 text-faint"
				idle={<IconCopy size={14} />}
			/>
		</button>
	);
}

function Steps({ children }: { children: React.ReactNode }) {
	return <ol className="m-0 flex list-none flex-col gap-2.5 p-0">{children}</ol>;
}

function Step({ n, children }: { n: number; children: React.ReactNode }) {
	return (
		<li className="flex items-start gap-2.5 text-supporting leading-relaxed text-dim">
			<span className="mt-0.5 flex size-[18px] shrink-0 items-center justify-center rounded-full bg-surface text-[10px] font-semibold tabular-nums text-faint">
				{n}
			</span>
			<span className="min-w-0 flex-1">{children}</span>
		</li>
	);
}

function integrationState(i: SetupIntegration): { tone: ChipTone; label: string } {
	if (i.enabled && i.missingRequired.length === 0) return { tone: "on", label: "On" };
	if (i.enabled) return { tone: "warn", label: "Enabled — missing credentials" };
	return { tone: "off", label: "Off" };
}

function githubAuthState(g: SetupStatus["github"]): { tone: ChipTone; label: string } {
	if (g.userPrAuth && g.clientIdConfigured)
		return {
			tone: "on",
			label: g.redirectFlowAvailable ? "Active" : "Active — device flow only",
		};
	if (g.userPrAuth) return { tone: "warn", label: "Missing client id" };
	return { tone: "off", label: "Off" };
}

/** One row of the Getting-started checklist: title, one-liner, state chip. */
function ChecklistRow({
	title,
	description,
	tone,
	label,
}: {
	title: React.ReactNode;
	description: React.ReactNode;
	tone: ChipTone;
	label: string;
}) {
	return (
		<SettingRow>
			<SettingRowText>
				<SettingRowTitle>{title}</SettingRowTitle>
				<SettingRowDescription>{description}</SettingRowDescription>
			</SettingRowText>
			<StateChip tone={tone} label={label} />
		</SettingRow>
	);
}

function IntegrationCard({ integration }: { integration: SetupIntegration }) {
	const state = integrationState(integration);
	const configured = state.tone === "on";
	return (
		<SettingsSection className="mb-3">
			<div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
				<div className="min-w-0 flex-1 text-item-title font-medium text-fg">
					{integration.label}
				</div>
				<StateChip tone={state.tone} label={state.label} />
			</div>
			{integration.missingRequired.length > 0 && (
				<div className="mt-1 text-supporting text-dim">
					Missing:{" "}
					{integration.missingRequired.map((name, i) => (
						<React.Fragment key={name}>
							{i > 0 && ", "}
							<Code>{name}</Code>
						</React.Fragment>
					))}
				</div>
			)}
			{configured ? (
				<div className="mt-1 text-supporting text-dim">
					Connected and running. Full guide: <Code>{integration.doc}</Code> in the
					checkout.
				</div>
			) : (
				<div className="mt-3">
					<Steps>
						<Step n={1}>
							Obtain the {integration.label} credentials — <Code>{integration.doc}</Code>{" "}
							in the checkout is the full walkthrough.
						</Step>
						<Step n={2}>
							Add {integration.env.length === 1 ? "the key" : "the keys"} to{" "}
							<Code>~/.opensession.env</Code>:
							<span className="mt-1.5 flex flex-col gap-1">
								{integration.env.map((e) => (
									<span
										key={e.name}
										className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5"
									>
										<Code>{e.name}</Code>
										{e.required && (
											<span className="text-meta font-medium text-yellow">required</span>
										)}
										{e.present && <span className="text-meta text-green">set</span>}
										<span className="min-w-0 text-meta text-faint">{e.description}</span>
									</span>
								))}
							</span>
						</Step>
						<Step n={3}>
							Turn it on: <Code>opensession integrations enable {integration.id}</Code>
						</Step>
						<Step n={4}>
							Load it: <Code>opensession restart</Code>
						</Step>
					</Steps>
				</div>
			)}
		</SettingsSection>
	);
}

function GithubAuthCard({ github }: { github: SetupStatus["github"] }) {
	const state = githubAuthState(github);
	const active = github.userPrAuth && github.clientIdConfigured;
	return (
		<SettingsSection>
			<div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
				<div className="min-w-0 flex-1 text-item-title font-medium text-fg">
					GitHub sign-in &amp; PRs as yourself
				</div>
				<StateChip tone={state.tone} label={state.label} />
			</div>
			<div className="mt-1 text-supporting leading-relaxed text-dim">
				Opting in replaces the name picker with a real GitHub sign-in, and
				interactive sessions of a connected teammate open PRs as their own
				account instead of the bot.
			</div>
			{active ? (
				<div className="mt-2 text-supporting leading-relaxed text-dim">
					{github.redirectFlowAvailable
						? "Browser redirect sign-in and device codes both work."
						: "Device-code sign-in only — add oauthClientSecret to the config to enable the browser redirect flow."}{" "}
					Teammates connect their accounts under Workspace → Connections. Full
					guide: <Code>docs/setup/github.md</Code>.
				</div>
			) : (
				<div className="mt-3">
					<Steps>
						<Step n={1}>
							Create an org-owned GitHub App (org Settings → Developer settings →
							GitHub Apps). Full guide: <Code>docs/setup/github.md</Code> in the
							checkout.
						</Step>
						<Step n={2}>On the app, check “Enable Device Flow”.</Step>
						<Step n={3}>
							Set the app&rsquo;s callback URL to exactly:
							<span className="mt-1.5 block">
								<CopyableCode value={github.callbackUrl} />
							</span>
						</Step>
						<Step n={4}>
							Install the app on your org → All repositories (and make it
							installable only on that account).
						</Step>
						<Step n={5}>
							In <Code>~/.opensession/config.json</Code> set{" "}
							<Code>
								integrations.github: {"{"} userPrAuth: true, oauthClientId:
								&quot;…&quot; {"}"}
							</Code>{" "}
							— add <Code>oauthClientSecret</Code> too for the browser redirect
							flow — then <Code>opensession restart</Code>.
						</Step>
					</Steps>
				</div>
			)}
		</SettingsSection>
	);
}

export function SetupPanel() {
	const [status, setStatus] = useState<SetupStatus | null>(null);
	const [failed, setFailed] = useState(false);

	useEffect(() => {
		document.title = docTitle("Setup");
		let cancelled = false;
		(async () => {
			try {
				const res = await fetch(`${BASE_PATH}/api/setup/status`);
				if (!res.ok) throw new Error(String(res.status));
				const body = (await res.json()) as SetupStatus;
				if (!cancelled) setStatus(body);
			} catch {
				if (!cancelled) setFailed(true);
			}
		})();
		return () => {
			cancelled = true;
			document.title = DEFAULT_DOC_TITLE;
		};
	}, []);

	const githubState = status ? githubAuthState(status.github) : null;

	return (
		<SettingsPanel>
			<SettingsHeader
				title="Setup"
				description="What's wired up on this instance, and exactly how to connect the rest."
			/>
			{!status ? (
				<LoadingState>{failed ? "Couldn't load setup status." : "Loading…"}</LoadingState>
			) : (
				<>
					<SettingsGroupLabel className="mt-0">Getting started</SettingsGroupLabel>
					<SettingCard>
						<ChecklistRow
							title="Repositories"
							description={
								status.repos.length > 0
									? status.repos.map((r) => r.label).join(", ")
									: "Register the repos sessions work in under repos in ~/.opensession/config.json."
							}
							tone={status.repos.length > 0 ? "on" : "warn"}
							label={
								status.repos.length > 0
									? `${status.repos.length} registered`
									: "None registered"
							}
						/>
						<ChecklistRow
							title="Team roster"
							description={
								status.team.count > 0 ? (
									status.team.names.join(", ")
								) : (
									<>
										Add teammates with <Code>opensession team add</Code> so commits
										and sessions attribute to real people.
									</>
								)
							}
							tone={status.team.count > 0 ? "on" : "warn"}
							label={
								status.team.count > 0
									? `${status.team.count} ${status.team.count === 1 ? "member" : "members"}`
									: "Empty"
							}
						/>
						{githubState && (
							<ChecklistRow
								title="GitHub sign-in"
								description={
									status.github.userPrAuth && status.github.clientIdConfigured
										? "Teammates sign in with GitHub and open PRs as themselves."
										: "Off — the UI uses the name picker and PRs come from the bot account."
								}
								tone={githubState.tone}
								label={githubState.label}
							/>
						)}
						{status.integrations.map((i) => {
							const s = integrationState(i);
							return (
								<ChecklistRow
									key={i.id}
									title={i.label}
									description={
										s.tone === "on"
											? "Connected and running."
											: s.tone === "warn"
												? `Enabled, but missing ${i.missingRequired.join(", ")}.`
												: "Not enabled — see the card below to connect it."
									}
									tone={s.tone}
									label={s.label}
								/>
							);
						})}
					</SettingCard>

					<SettingsGroupLabel>Integrations</SettingsGroupLabel>
					{status.integrations.map((i) => (
						<IntegrationCard key={i.id} integration={i} />
					))}
					<SettingsHint>
						Env vars live in <Code>~/.opensession.env</Code>; the server reads them
						on restart. Enable flags can also be set per integration in{" "}
						<Code>~/.opensession/config.json</Code> — an{" "}
						<Code>ENABLE_*</Code> env var wins when set.
					</SettingsHint>

					<SettingsGroupLabel>GitHub sign-in</SettingsGroupLabel>
					<GithubAuthCard github={status.github} />
				</>
			)}
		</SettingsPanel>
	);
}
