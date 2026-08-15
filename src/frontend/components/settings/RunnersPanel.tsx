import { useEffect, useState } from "react";
import { bootstrapRunner, createRunnerPairing, fetchRunnerBootstrapTargets, fetchRunners, revokeRunner, updateRunner, type RunnerBootstrapTarget, type RunnerInfo } from "../../lib/api/runners";
import { Button } from "../../ui/button";
import { Input } from "../../ui/input";
import { OptionSelect } from "../../ui/select";
import { Switch } from "../../ui/switch";
import { toast } from "../../ui/toast";
import { SettingCard, SettingsGroupLabel, SettingsHeader, SettingsHint, SettingsPanel, SettingRow } from "../../ui/settings";

const stateStyle: Record<RunnerInfo["state"], string> = {
	online: "text-green",
	busy: "text-yellow",
	offline: "text-faint",
	maintenance: "text-dim",
};

function resourceSummary(runner: RunnerInfo): string {
	const values = [
		runner.resources?.cpuCores ? `${runner.resources.cpuCores} cores` : undefined,
		runner.resources?.memoryGb ? `${runner.resources.memoryGb} GB` : undefined,
		runner.resources?.gpu?.model ? `${runner.resources.gpu.model}${runner.resources.gpu.vramGb ? ` · ${runner.resources.gpu.vramGb} GB VRAM` : ""}` : undefined,
	].filter(Boolean);
	return values.join(" · ") || "No resource inventory yet";
}

function pairingCommand(code: string): string {
	return `opensession runner connect --server ${location.origin} --code ${code}`;
}

export function RunnersPanel() {
	const [runners, setRunners] = useState<RunnerInfo[]>([]);
	const [admin, setAdmin] = useState(false);
	const [loading, setLoading] = useState(true);
	const [pairing, setPairing] = useState<{ code: string; expiresAt: number } | null>(null);
	const [connectChoice, setConnectChoice] = useState<"choices" | "ssh" | "kubernetes" | null>(null);
	const [bootstrapTargets, setBootstrapTargets] = useState<{ ssh: RunnerBootstrapTarget[]; kubernetes: RunnerBootstrapTarget[] }>({ ssh: [], kubernetes: [] });
	const [bootstrapTargetId, setBootstrapTargetId] = useState("");
	const [busyId, setBusyId] = useState<string | null>(null);

	const load = async () => {
		try {
			const data = await fetchRunners();
			setRunners(data.runners);
			setAdmin(data.admin);
		} catch (error) {
			toast(error instanceof Error ? error.message : "Failed to load Runners", { variant: "error" });
		} finally { setLoading(false); }
	};

	useEffect(() => { void load(); }, []);

	const pair = async () => {
		try { setPairing(await createRunnerPairing()); setConnectChoice(null); }
		catch (error) { toast(error instanceof Error ? error.message : "Could not create pairing", { variant: "error" }); }
	};
	const chooseBootstrap = async (kind: "ssh" | "kubernetes") => {
		try {
			const targets = await fetchRunnerBootstrapTargets();
			setBootstrapTargets(targets);
			setBootstrapTargetId(targets[kind][0]?.id || "");
			setConnectChoice(kind);
		} catch (error) { toast(error instanceof Error ? error.message : "Could not load Runner connection options", { variant: "error" }); }
	};
	const startBootstrap = async () => {
		if (!connectChoice || connectChoice === "choices" || !bootstrapTargetId) return;
		try {
			const result = await bootstrapRunner(connectChoice, bootstrapTargetId);
			setConnectChoice(null);
			toast(`${result.target} is connecting. It appears here when its Runner channel is online.`, { variant: "success" });
			void load();
		} catch (error) { toast(error instanceof Error ? error.message : "Could not start Runner migration", { variant: "error" }); }
	};
	const copy = async () => {
		if (!pairing) return;
		try { await navigator.clipboard.writeText(pairingCommand(pairing.code)); toast("Pairing command copied", { variant: "success" }); }
		catch { toast("Copy the command from this page", { variant: "error" }); }
	};
	const change = async (runner: RunnerInfo, patch: Parameters<typeof updateRunner>[1]) => {
		setBusyId(runner.id);
		try {
			const next = await updateRunner(runner.id, patch);
			setRunners((items) => items.map((item) => item.id === next.id ? next : item));
		} catch (error) { toast(error instanceof Error ? error.message : "Could not update Runner", { variant: "error" }); }
		finally { setBusyId(null); }
	};
	const revoke = async (runner: RunnerInfo) => {
		if (!confirm(`Revoke ${runner.label || runner.name}? It disconnects immediately.`)) return;
		setBusyId(runner.id);
		try { await revokeRunner(runner.id); setRunners((items) => items.filter((item) => item.id !== runner.id)); }
		catch (error) { toast(error instanceof Error ? error.message : "Could not revoke Runner", { variant: "error" }); }
		finally { setBusyId(null); }
	};

	return <SettingsPanel>
		<SettingsHeader
			title="Runners"
			description="Computers your workspace explicitly trusts for work that needs their hardware or platform. They are not isolated Sandboxes."
			actions={admin ? <Button variant="primary" size="sm" onClick={() => setConnectChoice("choices")}>Add Runner</Button> : undefined}
		/>
		{connectChoice === "choices" && <div className="mx-4 mb-4 rounded-lg bg-raised p-4">
			<div className="text-item-title font-semibold text-fg">Connect a Runner</div>
			<p className="mb-3 mt-1 text-supporting leading-relaxed text-dim">Choose the machine path first. Runners are trusted computers, not isolated Sandboxes.</p>
			<div className="grid gap-2 sm:grid-cols-3">
				<Button size="sm" onClick={() => void pair()}>Connect on this machine</Button>
				<Button size="sm" variant="soft" onClick={() => void chooseBootstrap("ssh")}>Migrate SSH machine</Button>
				<Button size="sm" variant="soft" onClick={() => void chooseBootstrap("kubernetes")}>Connect Kubernetes GPU</Button>
			</div>
			<Button className="mt-3" size="sm" variant="ghost" onClick={() => setConnectChoice(null)}>Cancel</Button>
		</div>}
		{(connectChoice === "ssh" || connectChoice === "kubernetes") && <div className="mx-4 mb-4 rounded-lg bg-raised p-4">
			<div className="text-item-title font-semibold text-fg">{connectChoice === "ssh" ? "Migrate an SSH machine" : "Connect a Kubernetes GPU Runner"}</div>
			<p className="mb-3 mt-1 text-supporting leading-relaxed text-dim">Select a preconfigured operator target. The migration installs and starts only the Runner service, then the machine connects outbound.</p>
			{bootstrapTargets[connectChoice].length ? <>
				<OptionSelect
					label="Operator target"
					value={bootstrapTargetId}
					options={bootstrapTargets[connectChoice].map((target) => ({
						value: target.id,
						label: `${target.label} · ${target.host ? `${target.user}@${target.host}:${target.port}` : `${target.context} / ${target.namespace} / ${target.workload}`}`,
					}))}
					onChange={setBootstrapTargetId}
				/>
				<div className="mt-3 flex gap-2"><Button size="sm" onClick={() => void startBootstrap()}>Connect</Button><Button size="sm" variant="ghost" onClick={() => setConnectChoice("choices")}>Back</Button></div>
			</> : <><p className="mb-0 text-supporting text-dim">No configured {connectChoice === "ssh" ? "SSH" : "Kubernetes"} targets are available.</p><Button className="mt-3" size="sm" variant="ghost" onClick={() => setConnectChoice("choices")}>Back</Button></>}
		</div>}

		{pairing && <div className="mx-4 mb-4 rounded-lg bg-raised p-4">
			<div className="text-item-title font-semibold text-fg">Connect on this machine</div>
			<p className="mb-3 mt-1 text-supporting leading-relaxed text-dim">Run this once on the computer. It detects capabilities and opens a reconnecting Runner channel.</p>
			<div className="flex flex-wrap items-center gap-2">
				<Input readOnly value={pairingCommand(pairing.code)} className="min-w-0 flex-1 font-mono text-xs" />
				<Button size="sm" onClick={() => void copy()}>Copy</Button>
				<Button size="sm" variant="ghost" onClick={() => setPairing(null)}>Done</Button>
			</div>
			<p className="mb-0 mt-2 text-meta text-faint">This one-time code expires at {new Date(pairing.expiresAt).toLocaleTimeString()}.</p>
		</div>}

		<SettingsGroupLabel actions={<Button size="sm" variant="ghost" onClick={() => void load()}>Refresh</Button>}>Workspace inventory</SettingsGroupLabel>
		<SettingCard>
			{loading && <div className="px-5 py-5 text-supporting text-dim">Loading Runners…</div>}
			{!loading && !runners.length && <div className="px-5 py-5">
				<div className="text-item-title font-medium text-fg">No Runners connected</div>
				<p className="mb-0 mt-1 text-supporting leading-relaxed text-dim">Choose a computer, connect it with a pairing command, then choose its permissions.</p>
			</div>}
			{runners.map((runner) => <RunnerRow key={runner.id} runner={runner} admin={admin} busy={busyId === runner.id} onChange={change} onRevoke={revoke} />)}
		</SettingCard>
		<SettingsHint>SSH and Kubernetes bootstrap remain operator-managed migration paths. They never give agents direct SSH or kubectl access.</SettingsHint>
	</SettingsPanel>;
}

function RunnerRow({ runner, admin, busy, onChange, onRevoke }: { runner: RunnerInfo; admin: boolean; busy: boolean; onChange: (runner: RunnerInfo, patch: Parameters<typeof updateRunner>[1]) => void; onRevoke: (runner: RunnerInfo) => void }) {
	const [editing, setEditing] = useState(false);
	const [label, setLabel] = useState(runner.label || "");
	const [tags, setTags] = useState(runner.capabilities.tags.join(", "));
	const [users, setUsers] = useState(runner.allowedUsers.join(", "));
	const [repos, setRepos] = useState(runner.allowedRepos.join(", "));
	const [inferenceModels, setInferenceModels] = useState(runner.localInferencePolicy?.allowedModels.join(", ") || "");
	const [inferenceEnabled, setInferenceEnabled] = useState(Boolean(runner.localInferencePolicy?.enabled));
	return <>
		<SettingRow className="items-start">
			<div className="min-w-0">
				<div className="flex flex-wrap items-baseline gap-x-2 gap-y-1"><span className="text-item-title font-medium text-fg">{runner.label || runner.name}</span><span className={`text-meta capitalize ${stateStyle[runner.state]}`}>{runner.state}</span></div>
				<div className="mt-0.5 text-supporting text-dim">{runner.platform} · {runner.arch} · {resourceSummary(runner)}</div>
				{runner.capabilities.toolchains.length > 0 && <div className="mt-1 text-meta text-faint">{runner.capabilities.toolchains.join(" · ")}</div>}
				{runner.resources?.localInference?.length ? <div className="mt-1 text-meta text-faint">Local inference reported: {runner.resources.localInference.map((runtime) => `${runtime.runtime}${runtime.models.length ? ` (${runtime.models.join(", ")})` : ""}`).join(" · ")}</div> : null}
				{runner.migration?.kind === "kubernetes" && <div className="mt-1 text-meta text-faint">Kubernetes · {runner.migration.context} / {runner.migration.namespace} / {runner.migration.workload}</div>}
				{runner.workload && <div className="mt-1 text-meta text-dim">Working: {runner.workload.operation || runner.workload.sessionId || "session work"}</div>}
			</div>
			<div className="flex shrink-0 items-center gap-2">
				{admin && <Button size="sm" variant="ghost" onClick={() => setEditing((value) => !value)}>{editing ? "Close" : "Details"}</Button>}
			</div>
		</SettingRow>
		{editing && <div className="border-t border-line px-5 py-3">
			<div className="grid gap-2 sm:grid-cols-2">
				<label className="text-label text-dim">Label<Input value={label} onChange={(event) => setLabel(event.target.value)} /></label>
				<label className="text-label text-dim">Tags<Input value={tags} onChange={(event) => setTags(event.target.value)} /></label>
				<label className="text-label text-dim">Allowed people<Input value={users} onChange={(event) => setUsers(event.target.value)} placeholder="All workspace members" /></label>
				<label className="text-label text-dim">Allowed repositories<Input value={repos} onChange={(event) => setRepos(event.target.value)} placeholder="All repositories" /></label>
				{runner.resources?.localInference?.length ? <label className="text-label text-dim sm:col-span-2">Allowed local models<Input value={inferenceModels} onChange={(event) => setInferenceModels(event.target.value)} placeholder="Comma-separated model names" /></label> : null}
			</div>
			<div className="mt-3 flex flex-wrap items-center gap-4 text-label text-dim">
				<label className="flex items-center gap-2">Maintenance <Switch checked={Boolean(runner.maintenance)} onCheckedChange={(maintenance) => onChange(runner, { maintenance })} disabled={busy} /></label>
				<label className="flex items-center gap-2">Commands <Switch checked={runner.permissions.commands} onCheckedChange={(commands) => onChange(runner, { permissions: { commands } })} disabled={busy} /></label>
				{runner.resources?.localInference?.length ? <label className="flex items-center gap-2">Local inference <Switch checked={inferenceEnabled} onCheckedChange={setInferenceEnabled} disabled={busy} /></label> : null}
			</div>
			<div className="mt-3 flex flex-wrap gap-2"><Button size="sm" onClick={() => onChange(runner, {
				label: label.trim() || undefined,
				capabilities: { tags: list(tags) },
				allowedUsers: list(users), allowedRepos: list(repos),
				...(runner.resources?.localInference?.length ? { localInferencePolicy: { enabled: inferenceEnabled, allowedUsers: list(users), allowedModels: list(inferenceModels), allowedTasks: ["chat", "embedding", "image", "video"] } } : {}),
			})} disabled={busy}>Save</Button><Button size="sm" variant="danger" onClick={() => onRevoke(runner)} disabled={busy}>Revoke</Button></div>
		</div>}
	</>;
}

function list(value: string): string[] {
	return value.split(",").map((item) => item.trim()).filter(Boolean);
}
