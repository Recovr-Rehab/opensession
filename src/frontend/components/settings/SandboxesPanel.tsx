import { useEffect, useState } from "react";
import type {
	SandboxConnectionInfo,
	SandboxIngressInfo,
	SandboxOperationInfo,
} from "../../lib/api";
import type { SandboxConnectionsResponse } from "../../lib/api/sandboxes";
import type { SandboxEnvironmentInfo } from "../../lib/api/sandboxes";
import {
	connectSandbox,
	disconnectSandbox,
	fetchSandboxEnvironments,
	fetchSandboxConnections,
	rebuildSandboxEnvironment,
	testSandboxConnection,
	updateSandboxConnection,
} from "../../lib/api/sandboxes";
import { Button } from "../../ui/button";
import { cn } from "../../ui/cn";
import { Input } from "../../ui/input";
import { Modal } from "../../ui/modal";
import {
	SettingCard,
	SettingsGroupLabel,
	SettingsHeader,
	SettingsHint,
	SettingsPanel,
} from "../../ui/settings";
import { Switch } from "../../ui/switch";
import { toast } from "../../ui/toast";
import { IconBox, IconCheck } from "../icons";
import { WorkspaceSandboxDefaults } from "./SandboxDefaults";

const PROVIDERS: Array<{
	id: SandboxConnectionInfo["provider"];
	label: string;
	description: string;
	command: string;
}> = [
	{
		id: "microvm",
		label: "Local MicroVM",
		description: "Strong local isolation with Firecracker. No provider account or public ingress required.",
		command: "opensession sandbox enable microvm",
	},
	{
		id: "docker",
		label: "Docker",
		description: "Local container isolation using the Open Session runner image.",
		command: "opensession sandbox enable docker",
	},
	{
		id: "daytona",
		label: "Daytona",
		description: "Remote workspaces in your Daytona account, connected with your workspace API key.",
		command: "",
	},
	{
		id: "modal",
		label: "Modal",
		description: "Remote sandboxes in your Modal account, connected with a token pair.",
		command: "",
	},
];

const STATE_LABEL: Record<SandboxConnectionInfo["state"], string> = {
	not_configured: "Not configured",
	checking: "Checking",
	ready: "Ready",
	needs_attention: "Needs attention",
	disabled: "Disabled",
};

function statusClasses(state: SandboxConnectionInfo["state"]): string {
	if (state === "ready") return "bg-green-soft text-green";
	if (state === "needs_attention") return "bg-red-soft text-red";
	if (state === "checking") return "bg-accent-soft text-accent";
	return "bg-hover text-dim";
}

function latestOperation(
	provider: SandboxConnectionInfo["provider"],
	operations: SandboxOperationInfo[],
): SandboxOperationInfo | undefined {
	return operations.find((operation) => operation.provider === provider);
}

function ConnectDialog({
	connection,
	open,
	onOpenChange,
	onChanged,
	ingress,
}: {
	connection: SandboxConnectionInfo;
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onChanged: (response: SandboxConnectionsResponse) => void;
	ingress: SandboxIngressInfo;
}) {
	const provider = PROVIDERS.find((candidate) => candidate.id === connection.provider)!;
	const [apiKey, setApiKey] = useState("");
	const [tokenId, setTokenId] = useState("");
	const [tokenSecret, setTokenSecret] = useState("");
	const [publicBaseUrl, setPublicBaseUrl] = useState(
		ingress.configuredUrl || ingress.proposedUrl || "",
	);
	const [region, setRegion] = useState(String(connection.settings.region || ""));
	const [snapshot, setSnapshot] = useState(String(connection.settings.snapshot || ""));
	const [app, setApp] = useState(String(connection.settings.app || ""));
	const [environment, setEnvironment] = useState(String(connection.settings.environment || ""));
	const [cpu, setCpu] = useState(String(connection.settings.cpu || ""));
	const [memoryMb, setMemoryMb] = useState(String(connection.settings.memoryMb || ""));
	const [saving, setSaving] = useState(false);
	const [confirmingDisconnect, setConfirmingDisconnect] = useState(false);

	async function connect() {
		setSaving(true);
		try {
			const response = await connectSandbox(connection.provider, {
				...(apiKey ? { apiKey } : {}),
				...(tokenId ? { tokenId } : {}),
				...(tokenSecret ? { tokenSecret } : {}),
				...(remote && publicBaseUrl ? { publicBaseUrl } : {}),
				settings: {
					...(region ? { region } : {}),
					...(snapshot ? { snapshot } : {}),
					...(app ? { app } : {}),
					...(environment ? { environment } : {}),
					...(cpu ? { cpu: Number(cpu) } : {}),
					...(memoryMb ? { memoryMb: Number(memoryMb) } : {}),
				},
			});
			onChanged(response);
			onOpenChange(false);
			toast(`${provider.label} connection check started`, { variant: "success" });
		} catch (error) {
			toast(error instanceof Error ? error.message : `Failed to connect ${provider.label}`, {
				variant: "error",
			});
		} finally {
			setSaving(false);
		}
	}

	async function disconnect() {
		setSaving(true);
		try {
			const response = await disconnectSandbox(connection.provider);
			onChanged(response);
			onOpenChange(false);
			toast(`${provider.label} disconnected`, { variant: "success" });
		} catch (error) {
			toast(error instanceof Error ? error.message : `Failed to disconnect ${provider.label}`, {
				variant: "error",
			});
		} finally {
			setSaving(false);
		}
	}

	const exists = connection.state !== "not_configured";
	const remote = connection.provider === "daytona" || connection.provider === "modal";
	return (
		<Modal.Root
			open={open}
			onOpenChange={(next) => {
				setConfirmingDisconnect(false);
				onOpenChange(next);
			}}
		>
			<Modal.Content widthClassName="max-w-[31rem]">
				<Modal.Header
					title={`${exists ? "Configure" : "Connect"} ${provider.label}`}
					description={
						remote
							? "Credentials stay on this server. Open Session tests ingress, creates a disposable sandbox, restores a snapshot, and cleans up."
							: "Run the setup command on this machine, then let Open Session verify the runtime and snapshot path."
					}
				/>

				{connection.provider === "daytona" && (
					<label className="flex flex-col gap-1.5 text-label font-medium text-dim">
						Daytona API key
						<Input
							type="password"
							autoComplete="off"
							placeholder={connection.hasCredentials ? "Leave blank to keep current key" : "Enter API key"}
							value={apiKey}
							onChange={(event) => setApiKey(event.target.value)}
						/>
					</label>
				)}

				{connection.provider === "modal" && (
					<div className="grid gap-3 sm:grid-cols-2">
						<label className="flex flex-col gap-1.5 text-label font-medium text-dim">
							Modal token ID
							<Input
								type="password"
								autoComplete="off"
								placeholder={connection.hasCredentials ? "Keep current token" : "Token ID"}
								value={tokenId}
								onChange={(event) => setTokenId(event.target.value)}
							/>
						</label>
						<label className="flex flex-col gap-1.5 text-label font-medium text-dim">
							Modal token secret
							<Input
								type="password"
								autoComplete="off"
								placeholder={connection.hasCredentials ? "Keep current secret" : "Token secret"}
								value={tokenSecret}
								onChange={(event) => setTokenSecret(event.target.value)}
							/>
						</label>
					</div>
				)}

				{!remote && (
					<div className="rounded-lg bg-surface p-3">
						<div className="mb-1 text-label font-medium text-dim">Setup command</div>
						<code className="block select-all overflow-x-auto text-sm text-fg">
							{provider.command}
						</code>
					</div>
				)}

				{remote && (
					<>
						<label className="flex flex-col gap-1.5 text-label font-medium text-dim">
							Public callback URL
							<Input
								type="url"
								placeholder="https://ingress.example.com"
								value={publicBaseUrl}
								onChange={(event) => setPublicBaseUrl(event.target.value)}
							/>
						</label>
						{ingress.note && <p className="m-0 text-supporting text-dim">{ingress.note}</p>}
						{ingress.health !== "ready" && (
							<details className="rounded-lg bg-surface p-3 text-meta text-dim">
								<summary className="cursor-pointer font-medium text-fg">Generated Caddy routes</summary>
								{ingress.proposedUrl && (
									<code className="mt-2 block select-all overflow-x-auto rounded-md bg-panel p-2 text-xs text-fg">
										opensession sandbox ingress install {ingress.proposedUrl}
									</code>
								)}
								<pre className="mt-2 overflow-x-auto whitespace-pre-wrap text-xs text-dim">{ingress.generatedSnippet}</pre>
							</details>
						)}
						<details className="rounded-lg bg-surface p-3 text-supporting text-dim">
							<summary className="cursor-pointer font-medium text-fg">Provider settings</summary>
							<div className="mt-3 grid gap-3 sm:grid-cols-2">
								<label className="flex flex-col gap-1.5 text-label font-medium text-dim">
									Region
									<Input value={region} onChange={(event) => setRegion(event.target.value)} placeholder="Provider default" />
								</label>
								<label className="flex flex-col gap-1.5 text-label font-medium text-dim">
									CPU
									<Input type="number" min="1" value={cpu} onChange={(event) => setCpu(event.target.value)} placeholder="Provider default" />
								</label>
								<label className="flex flex-col gap-1.5 text-label font-medium text-dim">
									Memory (MB)
									<Input type="number" min="512" value={memoryMb} onChange={(event) => setMemoryMb(event.target.value)} placeholder="Provider default" />
								</label>
								{connection.provider === "daytona" ? (
									<label className="flex flex-col gap-1.5 text-label font-medium text-dim">
										Base snapshot
										<Input value={snapshot} onChange={(event) => setSnapshot(event.target.value)} placeholder="Daytona default" />
									</label>
								) : (
									<>
										<label className="flex flex-col gap-1.5 text-label font-medium text-dim">
											Modal app
											<Input value={app} onChange={(event) => setApp(event.target.value)} placeholder="opensession-sandboxes" />
										</label>
										<label className="flex flex-col gap-1.5 text-label font-medium text-dim">
											Environment
											<Input value={environment} onChange={(event) => setEnvironment(event.target.value)} placeholder="Modal default" />
										</label>
									</>
								)}
							</div>
						</details>
					</>
				)}

				<Modal.Footer className="mt-1">
					{exists &&
						(confirmingDisconnect ? (
							<>
								<Button variant="ghost" onClick={() => setConfirmingDisconnect(false)} disabled={saving}>
									Keep connection
								</Button>
								<Button variant="destructive" onClick={() => void disconnect()} disabled={saving}>
									Disconnect now
								</Button>
							</>
						) : (
							<Button variant="danger" onClick={() => setConfirmingDisconnect(true)} disabled={saving}>
								Disconnect
							</Button>
						))}
					<span className="flex-1" />
					<Modal.Close render={<Button variant="ghost" disabled={saving}>Cancel</Button>} />
					<Button variant="primary" onClick={() => void connect()} disabled={saving}>
						{saving ? "Starting…" : remote ? "Connect and test" : "Test setup"}
					</Button>
				</Modal.Footer>
			</Modal.Content>
		</Modal.Root>
	);
}

function ConnectionCard({
	connection,
	operations,
	onChanged,
	ingress,
	canManage,
}: {
	connection: SandboxConnectionInfo;
	operations: SandboxOperationInfo[];
	onChanged: (response: SandboxConnectionsResponse) => void;
	ingress: SandboxIngressInfo;
	canManage: boolean;
}) {
	const provider = PROVIDERS.find((candidate) => candidate.id === connection.provider)!;
	const operation = latestOperation(connection.provider, operations);
	const [dialogOpen, setDialogOpen] = useState(false);
	const [busy, setBusy] = useState(false);

	async function testAgain() {
		setBusy(true);
		try {
			onChanged(await testSandboxConnection(connection.provider));
		} catch (error) {
			toast(error instanceof Error ? error.message : `Failed to test ${provider.label}`, {
				variant: "error",
			});
		} finally {
			setBusy(false);
		}
	}

	async function toggle(enabled: boolean) {
		setBusy(true);
		try {
			onChanged(await updateSandboxConnection(connection.provider, { enabled }));
		} catch (error) {
			toast(error instanceof Error ? error.message : `Failed to update ${provider.label}`, {
				variant: "error",
			});
		} finally {
			setBusy(false);
		}
	}

	const checking = connection.state === "checking" || operation?.status === "running";
	const summary = checking
		? operation?.stage || "Checking connection"
		: connection.qualification?.failureSummary;

	return (
		<>
			<SettingCard>
				<div className="flex flex-wrap items-start gap-3 px-4 py-4">
					<div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-surface text-dim">
						<IconBox size={21} />
					</div>
					<div className="min-w-[14rem] flex-1">
						<div className="flex flex-wrap items-center gap-2">
							<div className="text-item-title font-semibold text-fg">{provider.label}</div>
							<span className={cn("rounded-full px-2 py-0.5 text-meta font-medium", statusClasses(checking ? "checking" : connection.state))}>
								{checking ? "Checking" : STATE_LABEL[connection.state]}
							</span>
						</div>
						<p className="m-0 mt-1 text-supporting leading-relaxed text-dim">{provider.description}</p>
						{summary && (
							<p className={cn("m-0 mt-2 text-supporting", connection.state === "needs_attention" ? "text-red" : "text-dim")}>
								{summary}
							</p>
						)}
						{connection.qualification && (
							<details className="mt-2 text-meta text-faint">
								<summary className="w-fit cursor-pointer select-none hover:text-fg">Diagnostics</summary>
								<div className="mt-1 grid gap-0.5 pl-2">
									<span>Connection {connection.id}</span>
									<span>Adapter {connection.qualification.adapterSignature}</span>
									{connection.qualification.checkedAt && <span>Checked {new Date(connection.qualification.checkedAt).toLocaleString()}</span>}
									{connection.qualification.failureCode && <span>Code {connection.qualification.failureCode}</span>}
								</div>
							</details>
						)}
					</div>
					<div className="ml-auto flex min-h-10 shrink-0 items-center gap-2">
						{connection.state !== "not_configured" && (
							<Switch
								aria-label={`${connection.enabled ? "Disable" : "Enable"} ${provider.label}`}
								checked={connection.enabled}
								disabled={!canManage || busy || checking}
								onCheckedChange={(checked) => void toggle(checked)}
							/>
						)}
						{connection.state === "ready" && !checking && (
							<Button size="sm" icon={<IconCheck size={17} />} onClick={() => void testAgain()} disabled={!canManage || busy}>
								Test again
							</Button>
						)}
						<Button size="sm" variant={connection.state === "not_configured" ? "primary" : "default"} onClick={() => setDialogOpen(true)} disabled={!canManage || checking}>
							{connection.state === "not_configured" ? (connection.provider === "docker" || connection.provider === "microvm" ? "Enable" : "Connect") : "Configure"}
						</Button>
					</div>
				</div>
			</SettingCard>
			<ConnectDialog
				connection={connection}
				open={dialogOpen}
				onOpenChange={setDialogOpen}
				onChanged={onChanged}
				ingress={ingress}
			/>
		</>
	);
}

export function SandboxesPanel() {
	const [connections, setConnections] = useState<SandboxConnectionInfo[]>([]);
	const [operations, setOperations] = useState<SandboxOperationInfo[]>([]);
	const [ingress, setIngress] = useState<SandboxIngressInfo>({
		source: "none",
		health: "not_configured",
		caddyAdminReachable: false,
		generatedSnippet: "",
	});
	const [environments, setEnvironments] = useState<SandboxEnvironmentInfo[]>([]);
	const [canManage, setCanManage] = useState(false);
	const [loading, setLoading] = useState(true);

	function apply(response: SandboxConnectionsResponse) {
		setConnections(response.connections);
		setOperations(response.operations);
		setIngress(response.ingress);
		setCanManage(response.canManage);
	}

	useEffect(() => {
		let active = true;
		const load = () => {
			void fetchSandboxEnvironments()
				.then((response) => active && setEnvironments(response.environments))
				.catch(() => {});
			return fetchSandboxConnections().then(
				(response) => {
					if (!active) return;
					apply(response);
					setLoading(false);
				},
				() => active && setLoading(false),
			);
		};
		void load();
		const interval = setInterval(() => {
			if (operations.some((operation) => operation.status === "running")) void load();
		}, 2_000);
		return () => {
			active = false;
			clearInterval(interval);
		};
	}, [operations.some((operation) => operation.status === "running")]);

	async function rebuild(environment: SandboxEnvironmentInfo) {
		try {
			const response = await rebuildSandboxEnvironment(
				environment.repo,
				environment.provider,
			);
			setOperations((current) => [response.operation, ...current]);
			setEnvironments((current) =>
				current.map((candidate) =>
					candidate.repo === environment.repo && candidate.provider === environment.provider
						? { ...candidate, state: "preparing", updatedAt: new Date().toISOString() }
						: candidate,
				),
			);
		} catch (error) {
			toast(error instanceof Error ? error.message : "Failed to rebuild sandbox environment", {
				variant: "error",
			});
		}
	}

	return (
		<SettingsPanel>
			<SettingsHeader
				title="Sandboxes"
				description="Connect compute you already pay for. Open Session prepares and tests it so starting an isolated session stays a one-choice workflow."
			/>
			<WorkspaceSandboxDefaults canManage={canManage} />
			<SettingsGroupLabel>Connections</SettingsGroupLabel>
			{!canManage && (
				<SettingsHint>
					You can use Ready connections, but only a workspace administrator can configure them.
				</SettingsHint>
			)}
			<div className="grid gap-3 px-4">
				{loading && <div className="py-8 text-center text-supporting text-faint">Loading sandbox connections…</div>}
				{connections.map((connection) => (
					<ConnectionCard
						key={connection.provider}
						connection={connection}
						operations={operations}
						onChanged={apply}
						ingress={ingress}
						canManage={canManage}
					/>
				))}
			</div>
			<SettingsHint>
				None remains available and is the default. Personal preferences and per-session choices can override the workspace default without changing these connections.
			</SettingsHint>
			{environments.some((environment) =>
				connections.some(
					(connection) =>
						connection.provider === environment.provider && connection.state === "ready",
				),
			) && (
				<>
					<SettingsGroupLabel>Project environments</SettingsGroupLabel>
					<div className="grid gap-3 px-4">
						{environments
							.filter((environment) =>
								connections.some(
									(connection) =>
										connection.provider === environment.provider && connection.state === "ready",
								),
							)
							.map((environment) => {
								const provider = PROVIDERS.find((candidate) => candidate.id === environment.provider)!;
								const running = operations.some(
									(operation) =>
										operation.repo === environment.repo &&
										operation.provider === environment.provider &&
										operation.status === "running",
								);
								return (
									<SettingCard key={`${environment.repo}:${environment.provider}`}>
										<div className="flex flex-wrap items-center gap-3 px-4 py-3.5">
											<div className="min-w-0 flex-1">
												<div className="text-item-title font-medium text-fg">{environment.repo}</div>
												<div className="mt-0.5 text-supporting text-dim">
													{provider.label} · {running ? "Preparing" : environment.state === "ready" ? environment.mode === "per_session" ? "Prepared per session" : "Template ready" : environment.state === "failed" ? environment.failureSummary || "Setup failed" : environment.state === "stale" ? "Template is stale" : "Not prepared"}
												</div>
											</div>
											<Button size="sm" onClick={() => void rebuild(environment)} disabled={!canManage || running}>
												{running ? "Preparing…" : "Rebuild"}
											</Button>
										</div>
									</SettingCard>
								);
							})}
					</div>
				</>
			)}
		</SettingsPanel>
	);
}
