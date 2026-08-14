import React, { useEffect, useState } from "react";
import type { Workspace } from "../lib/types";
import { fetchModels, updateWorkspaceApi, invalidateModelsCache, type ModelOption } from "../lib/api";
import { Modal } from "../ui/modal";
import { Switch } from "../ui/switch";
import {
	SettingCard,
	SettingRow,
	SettingRowControl,
	SettingRowDescription,
	SettingRowText,
	SettingRowTitle,
	SettingsGroupLabel,
} from "../ui/settings";

type Settings = NonNullable<Workspace["modelSettings"]>;

const blankPreset = () => ({
	id: crypto.randomUUID().slice(0, 8),
	label: "New combination",
	instructions: "",
	lead: { model: "", effort: "high" },
	supporting: [],
});

export function WorkspaceModelPresets({
	workspace,
	open,
	onOpenChange,
	onSaved,
}: {
	workspace: Workspace;
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onSaved: () => void;
}) {
	const [settings, setSettings] = useState<Settings>(workspace.modelSettings || {});
	const [models, setModels] = useState<ModelOption[]>([]);
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string | null>(null);
	useEffect(() => setSettings(workspace.modelSettings || {}), [workspace]);
	useEffect(() => {
		if (!open) return;
		fetchModels(false, workspace.id)
			.then((catalog) => setModels(catalog.models.filter((model) => !model.id.startsWith("workspace-preset/"))))
			.catch(() => setModels([]));
	}, [open, workspace.id]);
	const presets = settings.presets || [];
	const patchPreset = (index: number, patch: Partial<(typeof presets)[number]>) =>
		setSettings((current) => ({
			...current,
			presets: (current.presets || []).map((preset, i) => i === index ? { ...preset, ...patch } : preset),
		}));
	const save = async () => {
		setSaving(true);
		setError(null);
		try {
			const clean = {
				...settings,
				presets: presets
					.map((preset) => ({
						...preset,
						id: preset.id.replace(/[^a-z0-9_-]/gi, "-").slice(0, 64),
						label: preset.label.trim(),
						instructions: preset.instructions?.trim() || undefined,
						lead: { ...preset.lead, model: preset.lead.model.trim() },
						supporting: (preset.supporting || []).filter((member) => member.model.trim()),
					}))
					.filter((preset) => preset.id && preset.label && preset.lead.model),
			};
			await updateWorkspaceApi(workspace.id, { modelSettings: clean });
			invalidateModelsCache(workspace.id);
			onSaved();
			onOpenChange(false);
		} catch (e) {
			setError(e instanceof Error ? e.message : "Could not save model presets.");
		} finally {
			setSaving(false);
		}
	};
	return (
		<Modal.Root open={open} onOpenChange={onOpenChange}>
			<Modal.Content widthClassName="max-w-[42rem]">
				<Modal.Header title="Workspace model presets" description="Choose which built-ins appear here, then make combinations with a lead model, supporting models, and instructions." />
				<div className="flex flex-col gap-3">
					{(["dialEnabled", "orchestratorEnabled"] as const).map((key) => {
						const label = key === "dialEnabled" ? "The Dial" : "The Orchestrator";
						const detail = key === "dialEnabled"
							? "A lead model can ask a read-only oracle for a second opinion. Its tiers pair Fable 5, Sol, or Luna with a Fable or Sol oracle."
							: "A lead model plans, reviews, and integrates. It delegates focused implementation work to a standard worker or a faster worker, then verifies the result.";
						return <div key={key} className="flex items-center justify-between gap-4 rounded-md border border-line bg-panel px-3 py-2.5">
							<div><div className="text-label text-fg">{label}</div><div className="mt-0.5 max-w-[32rem] text-supporting text-dim">{detail}</div></div>
							<Switch checked={settings[key] !== false} onCheckedChange={(checked) => setSettings((current) => ({ ...current, [key]: checked }))} />
						</div>;
					})}
					<div className="mt-2 flex items-center justify-between"><div className="text-label font-semibold text-fg">Your combinations</div><button className="rounded-sm border border-line px-2.5 py-1.5 text-supporting text-fg hover:bg-hover" onClick={() => setSettings((current) => ({ ...current, presets: [...(current.presets || []), blankPreset()] }))}>Add combination</button></div>
					{presets.map((preset, index) => <div key={preset.id} className="flex flex-col gap-2 rounded-md border border-line p-3">
						<div className="flex gap-2"><input className="min-w-0 flex-1 rounded-sm border border-line bg-surface px-2 py-1.5 text-label text-fg" value={preset.label} onChange={(e) => patchPreset(index, { label: e.target.value })} placeholder="Combination name" /><button className="rounded-sm px-2 text-supporting text-dim hover:bg-hover hover:text-fg" onClick={() => setSettings((current) => ({ ...current, presets: (current.presets || []).filter((_, i) => i !== index) }))}>Remove</button></div>
						<label className="text-supporting text-dim">Lead model<select className="mt-1 w-full rounded-sm border border-line bg-surface px-2 py-1.5 text-label text-fg" value={preset.lead.model} onChange={(e) => patchPreset(index, { lead: { ...preset.lead, model: e.target.value } })}><option value="">Choose a lead model</option>{models.map((model) => <option key={model.id} value={model.id}>{model.label}</option>)}</select></label>
						<label className="text-supporting text-dim">Instructions<textarea className="mt-1 min-h-18 w-full resize-y rounded-sm border border-line bg-surface px-2 py-1.5 text-label text-fg" value={preset.instructions || ""} onChange={(e) => patchPreset(index, { instructions: e.target.value })} placeholder="When to use supporting models and how to integrate their work." /></label>
						<div className="flex flex-col gap-1.5"><span className="text-supporting text-dim">Supporting models</span>{(preset.supporting || []).map((member, memberIndex) => <div key={`${preset.id}-${memberIndex}`} className="flex gap-2"><select className="min-w-0 flex-1 rounded-sm border border-line bg-surface px-2 py-1.5 text-label text-fg" value={member.model} onChange={(e) => patchPreset(index, { supporting: (preset.supporting || []).map((current, i) => i === memberIndex ? { ...current, model: e.target.value } : current) })}><option value="">Choose a supporting model</option>{models.map((model) => <option key={model.id} value={model.id}>{model.label}</option>)}</select><button className="rounded-sm px-2 text-supporting text-dim hover:bg-hover hover:text-fg" onClick={() => patchPreset(index, { supporting: (preset.supporting || []).filter((_, i) => i !== memberIndex) })}>Remove</button></div>)}<button className="w-fit rounded-sm border border-line px-2.5 py-1.5 text-supporting text-fg hover:bg-hover" onClick={() => patchPreset(index, { supporting: [...(preset.supporting || []), { model: "" }] })}>Add supporting model</button></div>
					</div>)}
				</div>
				{error && <div className="text-supporting text-danger">{error}</div>}
				<Modal.Footer><Modal.Close render={<button className="rounded-sm px-3 py-2 text-label text-dim hover:bg-hover">Cancel</button>} /><button className="rounded-sm bg-fg px-3 py-2 text-label text-bg disabled:opacity-50" disabled={saving} onClick={() => void save()}>{saving ? "Saving…" : "Save"}</button></Modal.Footer>
			</Modal.Content>
		</Modal.Root>
	);
}

/** Workspace-specific entry inside Settings → Models. */
export function WorkspaceModelPresetSettings({ workspace }: { workspace?: Workspace }) {
	const [open, setOpen] = useState(false);
	return (
		<>
			<SettingsGroupLabel>Workspace presets</SettingsGroupLabel>
			<SettingCard>
				<SettingRow>
					<SettingRowText>
						<SettingRowTitle>Model combinations</SettingRowTitle>
						<SettingRowDescription>
							{workspace
								? `For ${workspace.name}. Choose the Dial and Orchestrator, then add model combinations for this workspace.`
								: "Open a workspace, then return here to configure its model combinations."}
						</SettingRowDescription>
					</SettingRowText>
					<SettingRowControl>
						<button className="rounded-sm border border-line px-3 py-2 text-label text-fg hover:bg-hover disabled:cursor-not-allowed disabled:opacity-50" disabled={!workspace} onClick={() => setOpen(true)}>Configure</button>
					</SettingRowControl>
				</SettingRow>
			</SettingCard>
			{workspace && <WorkspaceModelPresets workspace={workspace} open={open} onOpenChange={setOpen} onSaved={() => window.dispatchEvent(new Event("opensession:workspaces-changed"))} />}
		</>
	);
}
