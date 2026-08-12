import React, { useEffect, useState } from "react";
import { Button } from "../ui/button";
import { cn } from "../ui/cn";
import { Modal } from "../ui/modal";
import {
	SettingCard,
	SettingsHint,
	SettingsSection,
	settingsInputClass,
} from "../ui/settings";
import { InlineAlert } from "../ui/state";
import { Switch } from "../ui/switch";
import { toast } from "../ui/toast";
import {
	CopyableCode,
	StateChip,
	githubAuthState,
	integrationState,
	setupRequest,
	type SetupGithub,
	type SetupIntegration,
} from "./setup-shared";
import { IntegrationSetupDialog } from "./IntegrationSetupDialog";
import { IconTile } from "./BrandTile";

// The configuration forms behind the integration registry: paste the
// credentials, flip the enable switch, Save, restart. Rendered both as a Setup
// step and as the Workspace → Integrations settings page, so neither surface
// has its own idea of what an integration card looks like.

const INTEGRATION_DESCRIPTIONS: Record<string, string> = {
	plain: "Support threads, internal notes, and triage webhooks.",
	linear: "Assigned issues become scoped coding sessions.",
	slack: "DMs, mentions, session channels, and interactive controls.",
	stripe: "Dispute webhooks routed into scoped automations.",
	grafana: "Loki failure signatures routed into investigation automations.",
	github: "PR comments, reviews, webhooks, and fallback PR authorship.",
	codestorage: "Git hosting with branch-based reviews and local signing keys.",
};

function IntegrationCard({
	integration,
	publicBaseUrl,
	onSaved,
}: {
	integration: SetupIntegration;
	publicBaseUrl: string;
	onSaved: (updated: SetupIntegration, restartRequired: boolean) => void;
}) {
	const state = integrationState(integration);
	const [setupOpen, setSetupOpen] = useState(false);
	const [toggling, setToggling] = useState(false);
	const hasCredentials = integration.env.some((envVar) => envVar.present);
	const canToggle =
		integration.id !== "codestorage" &&
		(integration.enabled || integration.missingRequired.length === 0);

	async function toggle(enabled: boolean) {
		setToggling(true);
		try {
			const body = await setupRequest<{
				integration: SetupIntegration;
				restartRequired: boolean;
			}>(`/api/setup/integrations/${encodeURIComponent(integration.id)}`, {
				method: "PUT",
				json: { enabled },
			});
			toast(`${integration.label} ${enabled ? "enabled" : "disabled"}`);
			onSaved(body.integration, body.restartRequired !== false);
		} catch (cause) {
			toast(cause instanceof Error ? cause.message : `Could not update ${integration.label}`, {
				variant: "error",
			});
		} finally {
			setToggling(false);
		}
	}

	return (
		<>
			<SettingCard>
				<div className="flex flex-wrap items-start gap-3 px-4 py-4">
					<IconTile name={integration.id} size={40} />
					<div className="min-w-[14rem] flex-1">
						<div className="flex flex-wrap items-center gap-2">
							<div className="text-item-title font-semibold text-fg">{integration.label}</div>
							<StateChip tone={state.tone} label={state.label} />
						</div>
						<p className="m-0 mt-1 text-supporting leading-relaxed text-dim">
							{INTEGRATION_DESCRIPTIONS[integration.id] ?? `Connect ${integration.label} to Open Session.`}
						</p>
						{integration.missingRequired.length > 0 && (
							<div className="mt-2 text-meta text-yellow">
								Missing {integration.missingRequired.join(", ")}
							</div>
						)}
					</div>
					<div className="ml-auto flex min-h-10 shrink-0 items-center gap-2">
						{canToggle && (
							<Switch
								checked={integration.enabled}
								onCheckedChange={(enabled) => void toggle(enabled)}
								disabled={toggling}
								aria-label={`${integration.enabled ? "Disable" : "Enable"} ${integration.label}`}
							/>
						)}
						<Button
							size="sm"
							className="max-sm:min-h-10"
							variant={!hasCredentials && integration.env.length > 0 ? "primary" : "default"}
							onClick={() => setSetupOpen(true)}
						>
							{hasCredentials || integration.enabled ? "Configure" : "Set up"}
						</Button>
					</div>
				</div>
			</SettingCard>
			<IntegrationSetupDialog
				integration={integration}
				publicBaseUrl={publicBaseUrl}
				open={setupOpen}
				onOpenChange={setSetupOpen}
				onSaved={onSaved}
			/>
		</>
	);
}

/** Every integration the registry knows about, as configuration cards. */
export function IntegrationsList({
	integrations,
	publicBaseUrl,
	onSaved,
}: {
	integrations: SetupIntegration[];
	publicBaseUrl: string;
	onSaved: (updated: SetupIntegration, restartRequired: boolean) => void;
}) {
	return (
		<>
			<div className="grid gap-3 px-4">
				{integrations.map((i) => (
					<IntegrationCard
						key={i.id}
						integration={i}
						publicBaseUrl={publicBaseUrl}
						onSaved={onSaved}
					/>
				))}
			</div>
			<SettingsHint>
				Credentials stay on this server and are never shown again. Changes apply after
				you restart.
			</SettingsHint>
		</>
	);
}

function RecipeStep({ n, children }: { n: number; children: React.ReactNode }) {
	return (
		<li className="flex items-start gap-2.5 text-supporting leading-relaxed text-dim">
			<span className="mt-0.5 flex size-[18px] shrink-0 items-center justify-center rounded-full bg-surface text-[10px] font-semibold tabular-nums text-faint">
				{n}
			</span>
			<span className="min-w-0 flex-1">{children}</span>
		</li>
	);
}

function GithubAuthSetupDialog({
	github,
	open,
	onOpenChange,
	configuration,
	error,
	dirty,
	saving,
	onSave,
}: {
	github: SetupGithub;
	open: boolean;
	onOpenChange: (open: boolean) => void;
	configuration: React.ReactNode;
	error: string | null;
	dirty: boolean;
	saving: boolean;
	onSave: () => void;
}) {
	return (
		<Modal.Root open={open} onOpenChange={onOpenChange}>
			<Modal.Content widthClassName="max-w-[38rem]">
				<Modal.Header
					title="Set up GitHub sign-in"
					description="Let teammates connect GitHub so interactive sessions open PRs as them."
				/>
				<section>
					<h3 className="m-0 text-label font-semibold text-fg">Setup</h3>
					<ol className="m-0 mt-2 flex list-none flex-col gap-2.5 p-0">
						<RecipeStep n={1}>
							Create an organization-owned GitHub App. {" "}
							<a
								href={github.appCreateUrl}
								target="_blank"
								rel="noreferrer"
								className="text-fg underline decoration-line underline-offset-2 transition-colors hover:decoration-fg"
							>
								open the New GitHub App form ↗
							</a>
							.
						</RecipeStep>
						<RecipeStep n={2}>Enable Device Flow on the app.</RecipeStep>
						<RecipeStep n={3}>
							Under Repository permissions, grant <strong>Contents: read and write</strong>, <strong>Pull requests: read and write</strong>, and <strong>Issues: read and write</strong>. Metadata remains read-only.
						</RecipeStep>
						<RecipeStep n={4}>
							Set the callback URL to exactly:
							<span className="mt-1.5 block">
								<CopyableCode value={github.callbackUrl} />
							</span>
						</RecipeStep>
						<RecipeStep n={5}>
							Install the app only on your organization. Choose all repositories, or select only the repositories Open Session should work in.
						</RecipeStep>
						<RecipeStep n={6}>
							Paste the client id below. Add the client secret to enable browser redirect sign-in; device-code sign-in works without it.
						</RecipeStep>
						<RecipeStep n={7}>
							Enable GitHub sign-in, save, restart Open Session, then have each teammate connect under Workspace → Connections.
						</RecipeStep>
					</ol>
				</section>
				<section>
					<h3 className="m-0 text-label font-semibold text-fg">Permissions</h3>
					<ul className="m-0 mt-2 flex flex-col gap-1.5 pl-5 text-supporting leading-relaxed text-dim">
						<li>Contents write lets a connected teammate&rsquo;s interactive session push commits; pull-request and issue write cover PR creation, reviews, and conversation comments.</li>
						<li>A connected user can reach only repositories allowed by both their own GitHub access and the app installation.</li>
						<li>Personal tokens are injected only into interactive runs owned by that teammate. Automations continue to use the bot account.</li>
					</ul>
				</section>
				<SettingsSection>{configuration}</SettingsSection>
				{error && <InlineAlert>{error}</InlineAlert>}
				<Modal.Footer>
					<Modal.Close render={<Button variant="ghost" disabled={saving}>Cancel</Button>} />
					<Button variant="primary" disabled={!dirty || saving} onClick={onSave}>
						{saving ? "Saving…" : "Save configuration"}
					</Button>
				</Modal.Footer>
			</Modal.Content>
		</Modal.Root>
	);
}

export function GithubAuthCard({
	github,
	onSaved,
}: {
	github: SetupGithub;
	onSaved: (updated: SetupGithub, restartRequired: boolean) => void;
}) {
	const state = githubAuthState(github);
	const active = github.userPrAuth && github.clientIdConfigured;
	// The secret is never echoed; the status exposes presence only.
	const secretConfigured = github.clientSecretConfigured;
	const [userPrAuth, setUserPrAuth] = useState(github.userPrAuth);
	const [clientId, setClientId] = useState("");
	const [clientSecret, setClientSecret] = useState("");
	const [clearId, setClearId] = useState(false);
	const [clearSecret, setClearSecret] = useState(false);
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [setupOpen, setSetupOpen] = useState(false);

	useEffect(() => {
		setUserPrAuth(github.userPrAuth);
	}, [github.userPrAuth]);

	const idCleared = github.clientIdConfigured && clearId && !clientId.trim();
	const secretCleared = secretConfigured && clearSecret && !clientSecret.trim();
	const dirty =
		userPrAuth !== github.userPrAuth ||
		clientId.trim() !== "" ||
		clientSecret.trim() !== "" ||
		idCleared ||
		secretCleared;

	async function handleSave() {
		if (!dirty || saving) return;
		setSaving(true);
		setError(null);
		try {
			const body = await setupRequest<{
				github: SetupGithub;
				restartRequired: boolean;
			}>("/api/setup/github", {
				method: "PUT",
				json: {
					...(userPrAuth !== github.userPrAuth ? { userPrAuth } : {}),
					...(clientId.trim()
						? { oauthClientId: clientId.trim() }
						: idCleared
							? { oauthClientId: "" }
							: {}),
					...(clientSecret.trim()
						? { oauthClientSecret: clientSecret.replace(/\s+/g, "") }
						: secretCleared
							? { oauthClientSecret: "" }
							: {}),
				},
			});
			setClientId("");
			setClientSecret("");
			setClearId(false);
			setClearSecret(false);
			toast("GitHub sign-in settings saved");
			onSaved(body.github, body.restartRequired === true);
			setSetupOpen(false);
		} catch (e: any) {
			setError(e.message);
		} finally {
			setSaving(false);
		}
	}

	async function handleToggle(next: boolean) {
		if (saving) return;
		setSaving(true);
		setError(null);
		try {
			const body = await setupRequest<{
				github: SetupGithub;
				restartRequired: boolean;
			}>("/api/setup/github", {
				method: "PUT",
				json: { userPrAuth: next },
			});
			setUserPrAuth(body.github.userPrAuth);
			toast(`GitHub sign-in ${next ? "enabled" : "disabled"}`);
			onSaved(body.github, body.restartRequired === true);
		} catch (cause) {
			toast(cause instanceof Error ? cause.message : "Could not update GitHub sign-in", {
				variant: "error",
			});
		} finally {
			setSaving(false);
		}
	}

	const fieldLabelClass = "flex min-w-0 flex-col gap-1.5 text-label font-medium text-dim";
	const clearButtonClass =
		"focus-ring self-start rounded-sm text-meta font-medium text-faint underline underline-offset-2 transition-colors hover:text-fg";

	return (
		<>
			<div className="grid px-4">
				<SettingCard>
					<div className="flex flex-wrap items-start gap-3 px-4 py-4">
					<IconTile name="github" size={40} />
					<div className="min-w-[14rem] flex-1">
						<div className="flex flex-wrap items-center gap-2">
							<div className="text-item-title font-semibold text-fg">GitHub sign-in</div>
							<StateChip tone={state.tone} label={state.label} />
						</div>
						<p className="m-0 mt-1 text-supporting leading-relaxed text-dim">
							Interactive sessions open PRs as their connected owner instead of the bot.
						</p>
						{active && (
							<div className="mt-2 text-meta text-dim">
								{github.redirectFlowAvailable
									? "Browser redirect and device-code sign-in are ready."
									: "Device-code sign-in is ready; add a client secret for browser redirect."}
							</div>
						)}
					</div>
					<div className="ml-auto flex min-h-10 shrink-0 items-center gap-2">
						{(github.clientIdConfigured || github.userPrAuth) && (
							<Switch
								checked={github.userPrAuth}
								onCheckedChange={(next) => void handleToggle(next)}
								disabled={saving || !github.clientIdConfigured}
								aria-label={`${github.userPrAuth ? "Disable" : "Enable"} GitHub sign-in`}
							/>
						)}
						<Button
							size="sm"
							className="max-sm:min-h-10"
							variant={github.clientIdConfigured ? "default" : "primary"}
							onClick={() => setSetupOpen(true)}
						>
							{github.clientIdConfigured ? "Configure" : "Set up"}
						</Button>
					</div>
					</div>
				</SettingCard>
			</div>
			<GithubAuthSetupDialog
				github={github}
				open={setupOpen}
				onOpenChange={setSetupOpen}
				error={error}
				dirty={dirty}
				saving={saving}
				onSave={() => void handleSave()}
				configuration={
					<>
						<div className="flex items-center gap-3">
							<div className="min-w-0 flex-1">
								<div className="text-label font-semibold text-fg">Configuration</div>
								<div className="mt-0.5 text-meta text-dim">The client secret is optional and is never shown back.</div>
							</div>
							<Switch
								checked={userPrAuth}
								onCheckedChange={setUserPrAuth}
								disabled={saving}
								aria-label="Enable GitHub sign-in"
							/>
						</div>
						<div className="mt-3 grid grid-cols-2 gap-3 max-sm:grid-cols-1">
							<label className={fieldLabelClass}>
								<span className="flex items-baseline justify-between gap-2">
									Client id
									{github.clientIdConfigured && (
										<button
											type="button"
											className={clearButtonClass}
											onClick={() => {
												setClearId((current) => !current);
												setClientId("");
											}}
										>
											{idCleared ? "Keep" : "Clear"}
										</button>
									)}
								</span>
								<input
									className={cn(settingsInputClass, "font-mono")}
									value={clientId}
									onChange={(event) => {
										setClientId(event.target.value);
										if (event.target.value.trim()) setClearId(false);
									}}
									placeholder={idCleared ? "Will be unset" : github.clientIdConfigured ? "Set, leave blank to keep" : "Iv23li…"}
									autoCapitalize="none"
									spellCheck={false}
								/>
							</label>
							<label className={fieldLabelClass}>
								<span className="flex items-baseline justify-between gap-2">
									Client secret
									{secretConfigured && (
										<button
											type="button"
											className={clearButtonClass}
											onClick={() => {
												setClearSecret((current) => !current);
												setClientSecret("");
											}}
										>
											{secretCleared ? "Keep" : "Clear"}
										</button>
									)}
								</span>
								<input
									type="password"
									className={cn(settingsInputClass, "font-mono")}
									value={clientSecret}
									onChange={(event) => {
										setClientSecret(event.target.value);
										if (event.target.value.trim()) setClearSecret(false);
									}}
									placeholder={secretCleared ? "Will be unset" : secretConfigured ? "••• set" : "Optional, enables browser redirect"}
									autoComplete="new-password"
									autoCapitalize="none"
									spellCheck={false}
								/>
							</label>
						</div>
					</>
				}
			/>
		</>
	);
}
