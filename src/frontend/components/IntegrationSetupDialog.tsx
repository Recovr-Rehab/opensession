import { useEffect, useState, type ReactNode } from "react";
import { Button } from "../ui/button";
import { cn } from "../ui/cn";
import { Modal } from "../ui/modal";
import { SettingsSection, settingsInputClass } from "../ui/settings";
import { InlineAlert } from "../ui/state";
import { Switch } from "../ui/switch";
import { toast } from "../ui/toast";
import {
	Code,
	CopyableCode,
	LinkChips,
	setupRequest,
	type SetupIntegration,
} from "./setup-shared";

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
				{envVar.required && <span className="text-meta font-medium text-yellow">required</span>}
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
				onChange={(event) => onChange(event.target.value)}
				placeholder={cleared ? "will be unset" : envVar.present ? "••• set" : "not set"}
				aria-label={envVar.name}
				autoComplete="new-password"
				autoCapitalize="none"
				spellCheck={false}
			/>
		</div>
	);
}

function Step({ number, children }: { number: number; children: ReactNode }) {
	return (
		<li className="flex items-start gap-3 text-supporting leading-relaxed text-dim">
			<span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-surface text-[10px] font-semibold tabular-nums text-faint">
				{number}
			</span>
			<span className="min-w-0 flex-1">{children}</span>
		</li>
	);
}

function Value({ value }: { value: string }) {
	return (
		<span className="mt-1.5 block">
			<CopyableCode value={value} />
		</span>
	);
}

function GuideSection({ title, children }: { title: string; children: ReactNode }) {
	return (
		<section>
			<h3 className="m-0 text-label font-semibold text-fg">{title}</h3>
			<div className="mt-2">{children}</div>
		</section>
	);
}

type Guide = {
	description: string;
	steps: ReactNode[];
	permissions?: ReactNode[];
	note?: ReactNode;
};

function endpoint(publicBaseUrl: string, path: string): string {
	return `${publicBaseUrl.replace(/\/$/, "")}${path}`;
}

function guideFor(integration: SetupIntegration, publicBaseUrl: string): Guide {
	const url = (path: string) => endpoint(publicBaseUrl, path);

	switch (integration.id) {
		case "plain":
			return {
				description: "Connect a Plain machine user and send support webhooks to Open Session.",
				steps: [
					<>In Plain, create a machine user and generate its API key.</>,
					<>
						Create a webhook for <strong>thread created</strong>, <strong>thread status transitioned</strong>, and <strong>thread note created</strong>. Use this endpoint:
						<Value value={url("/plain/webhook")} />
					</>,
					<>Paste the API key and webhook signing secret into the fields on this card.</>,
					<>Enable Plain, save, and restart Open Session. Then send a test webhook from Plain.</>,
				],
				permissions: [
					<>Give the machine user access to read threads and create internal notes.</>,
					<>Keep customer replies human-controlled; the built-in triage flow writes an internal note, not a customer reply.</>,
				],
			};

		case "linear":
			return {
				description: "Create a Linear app that can receive agent assignments and work with issues.",
				steps: [
					<>Create an OAuth application in Linear and enable its app/agent actor capability.</>,
					<>
						Set the OAuth callback URL to exactly:
						<Value value={url("/oauth/callback")} />
					</>,
					<>
						Create a Linear webhook for agent-session and issue events. Use this endpoint:
						<Value value={url("/webhook")} />
					</>,
					<>Paste the client id, client secret, webhook secret, and API key into the fields on this card.</>,
					<>Enable Linear, save, restart Open Session, then install and authorize the app in your workspace.</>,
				],
				permissions: [
					<>OAuth scopes: <strong>app:assignable</strong>, <strong>read</strong>, and <strong>write</strong>.</>,
					<>The optional API key is used for direct issue reads and writes when no stored OAuth grant is available.</>,
				],
			};

		case "slack":
			return {
				description: "Create a Slack bot for DMs, mentions, session channels, and interactive controls.",
				steps: [
					<>Create a Slack app, add the bot scopes below, and install it to your workspace.</>,
					<>
						Under Event Subscriptions, subscribe to <strong>message.im</strong>, <strong>app_mention</strong>, and <strong>message</strong>. Set the request URL to:
						<Value value={url("/slack/events")} />
					</>,
					<>
						Enable Interactivity and set its request URL to:
						<Value value={url("/slack/actions")} />
					</>,
					<>Paste the bot token and signing secret below. Set an allowed Slack user id so admin tools are not open to every workspace member.</>,
					<>Enable Slack, save, restart Open Session, and invite the bot to every existing channel it should read.</>,
				],
				permissions: [
					<>Writing permissions: <strong>chat:write</strong>, <strong>chat:write.customize</strong>, <strong>reactions:write</strong>, <strong>assistant:write</strong>.</>,
					<>History: <strong>channels:history</strong>, <strong>groups:history</strong>, <strong>im:history</strong>, <strong>mpim:history</strong>.</>,
					<>Channels and people: <strong>channels:read</strong>, <strong>groups:read</strong>, <strong>im:read</strong>, <strong>channels:manage</strong>, <strong>groups:write</strong>, <strong>channels:join</strong>, <strong>im:write</strong>, <strong>users:read</strong>.</>,
					<>No file scopes are needed.</>,
				],
			};

		case "stripe":
			return {
				description: "Receive dispute events from Stripe and route them into a scoped automation.",
				steps: [
					<>
						Create a Stripe webhook endpoint at:
						<Value value={url("/stripe/webhook")} />
					</>,
					<>Subscribe it only to <strong>charge.dispute.created</strong>.</>,
					<>Reveal the endpoint signing secret and paste it into the field on this card.</>,
					<>Enable Stripe, save, restart Open Session, then send a test dispute event.</>,
				],
				permissions: [
					<>The webhook integration needs no Stripe API key; it only verifies and receives the selected event.</>,
					<>If you separately connect Stripe MCP, use a restricted key with read access to the billing data you need and only the narrow write permissions you explicitly intend.</>,
				],
				note: <>Money-moving Stripe tools remain unavailable to agent runs even when the MCP server has a write-capable key.</>,
			};

		case "grafana":
			return {
				description: "Let Open Session query Loki for failure signatures and start investigation automations.",
				steps: [
					<>Create a Grafana service account dedicated to Open Session.</>,
					<>Generate a service-account token and copy your Grafana base URL.</>,
					<>Paste both values below. If your Loki datasource is not named <strong>loki</strong>, also enter its datasource UID.</>,
					<>Enable the poller, save, restart Open Session, then configure a Grafana poll on the automation that should investigate matches.</>,
				],
				permissions: [
					<>Grant only enough Grafana access to query the selected Loki datasource.</>,
					<>No Grafana admin or dashboard-write permission is needed.</>,
				],
			};

		case "github":
			return {
				description: "Connect the machine user that handles PR comments, reviews, webhooks, and fallback PR authorship.",
				steps: [
					<>Create a dedicated GitHub machine user and give it access to the repositories Open Session works in.</>,
					<>Create a fine-grained personal access token for that user and paste it below.</>,
					<>On the Open Session host, sign the GitHub CLI into the same machine user with <strong>gh auth login</strong>. CLI authentication is separate from the token below.</>,
					<>
						Add a repository or organization webhook with content type <strong>application/json</strong> and this payload URL:
						<Value value={url("/github/webhook")} />
					</>,
					<>Create a webhook secret, paste it both into GitHub and below, then enter the bot login and any @handles that should wake the PR agent.</>,
					<>Enable GitHub, save, restart Open Session, and send a webhook test delivery.</>,
				],
				permissions: [
					<>Fine-grained token: <strong>Pull requests: read and write</strong> and <strong>Issues: read and write</strong> for only the target repositories.</>,
					<>The machine user and gh CLI need repository write access; add merge permission only if you use the UI&rsquo;s merge flows.</>,
					<>Webhook events: issue comments, pull requests, pull-request reviews and review comments, and workflow runs.</>,
				],
			};

		case "codestorage":
			return {
				description: "Connect a code.storage organization with a local signing key instead of a long-lived token.",
				steps: [
					<>Create or choose your organization in code.storage.</>,
					<>Generate a PKCS8 ES256 or RS256 keypair. Register the public key with the organization and keep the private key on this Open Session host.</>,
					<>Open <strong>Workspace → Connections</strong>, choose Code Storage, enter the organization id, and paste the private key. Open Session stores it with mode 0600 and verifies the connection.</>,
					<>Register or clone a code.storage repository from the Repositories setup page.</>,
				],
				permissions: [
					<>The registered organization key must allow Git read and write for the repositories Open Session will use.</>,
					<>There are no user seats, OAuth grants, or personal access tokens to configure.</>,
				],
			};

		default:
			return {
				description: `Connect ${integration.label} to Open Session.`,
				steps: [
					<>Create the provider credentials linked below.</>,
					<>Paste each value into its matching field on the integration card.</>,
					<>Enable the integration, save, and restart Open Session.</>,
				],
			};
	}
}

export function IntegrationSetupDialog({
	integration,
	publicBaseUrl,
	open,
	onOpenChange,
	onSaved,
}: {
	integration: SetupIntegration;
	publicBaseUrl: string;
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onSaved: (updated: SetupIntegration, restartRequired: boolean) => void;
}) {
	const guide = guideFor(integration, publicBaseUrl);
	const [enabled, setEnabled] = useState(integration.enabled);
	const [typed, setTyped] = useState<Record<string, string>>({});
	const [cleared, setCleared] = useState<Record<string, boolean>>({});
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		setEnabled(integration.enabled);
	}, [integration.enabled]);

	const typedKeys = integration.env
		.map((envVar) => envVar.name)
		.filter((name) => (typed[name] ?? "").trim() !== "");
	const clearedKeys = integration.env
		.filter(
			(envVar) =>
				envVar.present && cleared[envVar.name] && !(typed[envVar.name] ?? "").trim(),
		)
		.map((envVar) => envVar.name);
	const dirty =
		enabled !== integration.enabled || typedKeys.length > 0 || clearedKeys.length > 0;

	async function save() {
		if (!dirty || saving) return;
		setSaving(true);
		setError(null);
		try {
			const env: Record<string, string> = {};
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
			onOpenChange(false);
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : `Could not save ${integration.label}`);
		} finally {
			setSaving(false);
		}
	}

	return (
		<Modal.Root open={open} onOpenChange={onOpenChange}>
			<Modal.Content widthClassName="max-w-[38rem]">
				<Modal.Header title={`Set up ${integration.label}`} description={guide.description} />

				<GuideSection title="Setup">
					<ol className="m-0 flex list-none flex-col gap-2.5 p-0">
						{guide.steps.map((step, index) => (
							<Step key={index} number={index + 1}>{step}</Step>
						))}
					</ol>
				</GuideSection>

				{guide.permissions && (
					<GuideSection title="Permissions">
						<ul className="m-0 flex flex-col gap-1.5 pl-5 text-supporting leading-relaxed text-dim">
							{guide.permissions.map((permission, index) => <li key={index}>{permission}</li>)}
						</ul>
					</GuideSection>
				)}

				{guide.note && (
					<div className="rounded-lg bg-surface p-3 text-supporting leading-relaxed text-dim">
						{guide.note}
					</div>
				)}

				{integration.links.length > 0 && (
					<GuideSection title="Provider links">
						<LinkChips links={integration.links} className="mt-0" />
					</GuideSection>
				)}

				{integration.env.length > 0 && (
					<SettingsSection>
						<div className="flex items-center gap-3">
							<div className="min-w-0 flex-1">
								<div className="text-label font-semibold text-fg">Configuration</div>
								<div className="mt-0.5 text-meta text-dim">Credentials stay on this server and are never shown back.</div>
							</div>
							<Switch
								checked={enabled}
								onCheckedChange={setEnabled}
								disabled={saving}
								aria-label={`Enable ${integration.label}`}
							/>
						</div>
						<div className="mt-3 flex flex-col gap-2.5">
							{integration.env.map((envVar) => (
								<EnvVarField
									key={envVar.name}
									envVar={envVar}
									value={typed[envVar.name] ?? ""}
									cleared={Boolean(
										envVar.present &&
											cleared[envVar.name] &&
											!(typed[envVar.name] ?? "").trim(),
									)}
									onChange={(value) => {
										setTyped((current) => ({ ...current, [envVar.name]: value }));
										if (value.trim() && cleared[envVar.name]) {
											setCleared((current) => ({ ...current, [envVar.name]: false }));
										}
									}}
									onToggleClear={() => {
										setCleared((current) => ({
											...current,
											[envVar.name]: !current[envVar.name],
										}));
										setTyped((current) => ({ ...current, [envVar.name]: "" }));
									}}
								/>
							))}
						</div>
					</SettingsSection>
				)}

				{error && <InlineAlert>{error}</InlineAlert>}

				<Modal.Footer>
					<Modal.Close render={<Button variant="ghost" disabled={saving}>Cancel</Button>} />
					{integration.env.length > 0 ? (
						<Button variant="primary" disabled={!dirty || saving} onClick={() => void save()}>
							{saving ? "Saving…" : "Save configuration"}
						</Button>
					) : (
						<Modal.Close render={<Button variant="primary">Done</Button>} />
					)}
				</Modal.Footer>
			</Modal.Content>
		</Modal.Root>
	);
}
