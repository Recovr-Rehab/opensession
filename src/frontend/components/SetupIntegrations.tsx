import React, { useEffect, useState } from "react";
import { Button } from "../ui/button";
import { cn } from "../ui/cn";
import { SettingsHint, SettingsSection, settingsInputClass } from "../ui/settings";
import { InlineAlert } from "../ui/state";
import { Switch } from "../ui/switch";
import { toast } from "../ui/toast";
import {
	Code,
	CopyableCode,
	LinkChips,
	StateChip,
	githubAuthState,
	integrationState,
	setupRequest,
	type SetupGithub,
	type SetupIntegration,
} from "./setup-shared";

// The configuration forms behind the integration registry: paste the
// credentials, flip the enable switch, Save, restart. Rendered both as a Setup
// step and as the Workspace → Integrations settings page, so neither surface
// has its own idea of what an integration card looks like.

/** One env var of an integration: name + badges + description over a
 * password input. The input never echoes a stored value — "set" is the badge
 * and the placeholder; an empty input means "keep what's there", and the
 * Clear affordance is the only way to unset. */
function EnvVarField({
	envVar,
	value,
	cleared,
	onChange,
	onToggleClear,
}: {
	envVar: SetupIntegration["env"][number];
	value: string;
	cleared: boolean;
	onChange: (value: string) => void;
	onToggleClear: () => void;
}) {
	return (
		<div className="flex min-w-0 flex-col gap-1">
			<div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
				<Code>{envVar.name}</Code>
				{envVar.required && (
					<span className="text-meta font-medium text-yellow">required</span>
				)}
				{envVar.present && !cleared && <span className="text-meta text-green">set</span>}
				{cleared && <span className="text-meta font-medium text-red">cleared on save</span>}
				<span className="min-w-0 flex-1 text-meta text-faint">{envVar.description}</span>
				{envVar.present && (
					<button
						type="button"
						className="focus-ring shrink-0 rounded-control text-meta font-medium text-faint underline underline-offset-2 transition-colors hover:text-fg"
						onClick={onToggleClear}
					>
						{cleared ? "Keep" : "Clear"}
					</button>
				)}
			</div>
			<input
				type="password"
				className={cn(settingsInputClass, "font-mono")}
				value={value}
				onChange={(e) => onChange(e.target.value)}
				placeholder={
					cleared ? "will be unset" : envVar.present ? "••• set" : "not set"
				}
				aria-label={envVar.name}
				autoComplete="new-password"
				autoCapitalize="none"
				spellCheck={false}
			/>
		</div>
	);
}

function IntegrationCard({
	integration,
	onSaved,
}: {
	integration: SetupIntegration;
	onSaved: (updated: SetupIntegration, restartRequired: boolean) => void;
}) {
	const state = integrationState(integration);
	const configured = state.tone === "on";
	const [enabled, setEnabled] = useState(integration.enabled);
	const [typed, setTyped] = useState<Record<string, string>>({});
	const [cleared, setCleared] = useState<Record<string, boolean>>({});
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string | null>(null);

	// Track the server truth when a refetch lands (post-restart, other tab).
	useEffect(() => {
		setEnabled(integration.enabled);
	}, [integration.enabled]);

	const typedKeys = integration.env
		.map((e) => e.name)
		.filter((name) => (typed[name] ?? "").trim() !== "");
	const clearedKeys = integration.env
		.filter((e) => e.present && cleared[e.name] && !(typed[e.name] ?? "").trim())
		.map((e) => e.name);
	const dirty =
		enabled !== integration.enabled || typedKeys.length > 0 || clearedKeys.length > 0;

	async function handleSave() {
		if (!dirty || saving) return;
		setSaving(true);
		setError(null);
		try {
			const env: Record<string, string> = {};
			// Only the keys the user touched ride: typed values (whitespace
			// stripped — pasted keys often carry newlines) and explicit clears.
			for (const name of typedKeys) env[name] = (typed[name] ?? "").replace(/\s+/g, "");
			for (const name of clearedKeys) env[name] = "";
			const body = await setupRequest<{
				integration: SetupIntegration;
				restartRequired: boolean;
			}>(`/api/setup/integrations/${encodeURIComponent(integration.id)}`, {
				method: "PUT",
				json: {
					...(enabled !== integration.enabled ? { enabled } : {}),
					...(Object.keys(env).length > 0 ? { env } : {}),
				},
			});
			setTyped({});
			setCleared({});
			toast(`${integration.label} saved`);
			onSaved(body.integration, body.restartRequired !== false);
		} catch (e: any) {
			setError(e.message);
		} finally {
			setSaving(false);
		}
	}

	return (
		<SettingsSection className="mb-3">
			<div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
				<div className="min-w-0 flex-1 text-item-title font-medium text-fg">
					{integration.label}
				</div>
				<StateChip tone={state.tone} label={state.label} />
				<Switch
					checked={enabled}
					onCheckedChange={setEnabled}
					disabled={saving}
					aria-label={`Enable ${integration.label}`}
				/>
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
			<div className="mt-1 text-supporting leading-relaxed text-dim">
				{configured ? (
					<>
						Connected and running. Full guide: <Code>{integration.doc}</Code> in the
						checkout.
					</>
				) : (
					<>
						Get the {integration.label} credentials — <Code>{integration.doc}</Code>{" "}
						in the checkout is the full walkthrough — paste them below, flip the
						switch on, and Save.
					</>
				)}
			</div>
			{!configured && <LinkChips links={integration.links ?? []} />}
			<div className="mt-3 flex flex-col gap-2.5">
				{integration.env.map((e) => (
					<EnvVarField
						key={e.name}
						envVar={e}
						value={typed[e.name] ?? ""}
						cleared={Boolean(
							e.present && cleared[e.name] && !(typed[e.name] ?? "").trim(),
						)}
						onChange={(v) => {
							setTyped((prev) => ({ ...prev, [e.name]: v }));
							if (v.trim() && cleared[e.name])
								setCleared((prev) => ({ ...prev, [e.name]: false }));
						}}
						onToggleClear={() => {
							setCleared((prev) => ({ ...prev, [e.name]: !prev[e.name] }));
							setTyped((prev) => ({ ...prev, [e.name]: "" }));
						}}
					/>
				))}
			</div>
			{error && <InlineAlert className="mt-3">{error}</InlineAlert>}
			<div className="mt-3 flex items-center justify-end gap-3">
				{dirty && !saving && (
					<span className="text-meta text-faint">Applies after a restart</span>
				)}
				<Button variant="primary" size="sm" disabled={!dirty || saving} onClick={handleSave}>
					{saving ? "Saving…" : "Save"}
				</Button>
			</div>
		</SettingsSection>
	);
}

/** Every integration the registry knows about, as configuration cards. */
export function IntegrationsList({
	integrations,
	onSaved,
}: {
	integrations: SetupIntegration[];
	onSaved: (updated: SetupIntegration, restartRequired: boolean) => void;
}) {
	return (
		<>
			{integrations.map((i) => (
				<IntegrationCard key={i.id} integration={i} onSaved={onSaved} />
			))}
			<SettingsHint>
				Values save into the server&rsquo;s env (<Code>~/.opensession.env</Code>)
				and are never shown back — a <Code>set</Code> badge is all the UI keeps.
				Saved changes apply on the next restart; the banner below handles it.
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
		} catch (e: any) {
			setError(e.message);
		} finally {
			setSaving(false);
		}
	}

	const fieldLabelClass = "flex min-w-0 flex-col gap-1.5 text-label font-medium text-dim";
	const clearButtonClass =
		"focus-ring self-start rounded-sm text-meta font-medium text-faint underline underline-offset-2 transition-colors hover:text-fg";

	return (
		<SettingsSection>
			<div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
				<div className="min-w-0 flex-1 text-item-title font-medium text-fg">
					GitHub sign-in &amp; PRs as yourself
				</div>
				<StateChip tone={state.tone} label={state.label} />
				<Switch
					checked={userPrAuth}
					onCheckedChange={setUserPrAuth}
					disabled={saving}
					aria-label="Enable GitHub sign-in"
				/>
			</div>
			<div className="mt-1 text-supporting leading-relaxed text-dim">
				Opting in replaces the name picker with a real GitHub sign-in, and
				interactive sessions of a connected teammate open PRs as their own
				account instead of the bot.
			</div>
			{active && (
				<div className="mt-2 text-supporting leading-relaxed text-dim">
					{github.redirectFlowAvailable
						? "Browser redirect sign-in and device codes both work."
						: "Device-code sign-in only — add the client secret below to enable the browser redirect flow."}{" "}
					Teammates connect their accounts under Workspace → Connections. Full
					guide: <Code>docs/setup/github.md</Code>.
				</div>
			)}
			{!github.clientIdConfigured && (
				<div className="mt-3">
					<ol className="m-0 flex list-none flex-col gap-2.5 p-0">
						<RecipeStep n={1}>
							Create an org-owned GitHub App —{" "}
							<a
								href={github.appCreateUrl}
								target="_blank"
								rel="noreferrer"
								className="text-fg underline decoration-line underline-offset-2 transition-colors hover:decoration-fg"
							>
								open the New GitHub App form ↗
							</a>
							. Full guide: <Code>docs/setup/github.md</Code> in the checkout.
						</RecipeStep>
						<RecipeStep n={2}>On the app, check “Enable Device Flow”.</RecipeStep>
						<RecipeStep n={3}>
							Set the app&rsquo;s callback URL to exactly:
							<span className="mt-1.5 block">
								<CopyableCode value={github.callbackUrl} />
							</span>
						</RecipeStep>
						<RecipeStep n={4}>
							Install the app on your org → All repositories (and make it
							installable only on that account).
						</RecipeStep>
						<RecipeStep n={5}>
							Paste the app&rsquo;s client id below (and its client secret for the
							browser redirect flow), flip the switch on, and Save.
						</RecipeStep>
					</ol>
				</div>
			)}
			<div className="mt-3 grid grid-cols-2 gap-3 max-sm:grid-cols-1">
				<label className={fieldLabelClass}>
					<span className="flex items-baseline justify-between gap-2">
						Client id
						{github.clientIdConfigured && (
							<button
								type="button"
								className={clearButtonClass}
								onClick={() => {
									setClearId((c) => !c);
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
						onChange={(e) => {
							setClientId(e.target.value);
							if (e.target.value.trim()) setClearId(false);
						}}
						placeholder={
							idCleared
								? "will be unset"
								: github.clientIdConfigured
									? "set — leave blank to keep"
									: "Iv23li…"
						}
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
									setClearSecret((c) => !c);
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
						onChange={(e) => {
							setClientSecret(e.target.value);
							if (e.target.value.trim()) setClearSecret(false);
						}}
						placeholder={
							secretCleared
								? "will be unset"
								: secretConfigured
									? "••• set"
									: "optional — enables browser redirect"
						}
						autoComplete="new-password"
						autoCapitalize="none"
						spellCheck={false}
					/>
				</label>
			</div>
			{error && <InlineAlert className="mt-3">{error}</InlineAlert>}
			<div className="mt-3 flex items-center justify-end gap-3">
				{dirty && !saving && (
					<span className="text-meta text-faint">Applies after a restart</span>
				)}
				<Button variant="primary" size="sm" disabled={!dirty || saving} onClick={handleSave}>
					{saving ? "Saving…" : "Save"}
				</Button>
			</div>
		</SettingsSection>
	);
}
