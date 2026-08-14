import React, { useEffect, useState } from "react";
import type { Workspace } from "../lib/types";
import { fetchModels, updateWorkspaceApi, invalidateModelsCache, type ModelOption } from "../lib/api";
import { Modal } from "../ui/modal";
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
				<Modal.Header title="Model combinations" description={`Choose which built-in combinations appear in ${workspace.name}, then add your own.`} />
				<div className="flex flex-col gap-3">
					<div className="mt-2 flex items-center justify-between"><div><div className="text-label font-semibold text-fg">Presets</div><div className="text-supporting text-dim">Dial and Orchestrator are ordinary default presets. Remove or change them, then add your own.</div></div><button className="rounded-sm border border-line px-2.5 py-1.5 text-supporting text-fg hover:bg-hover" onClick={() => setSettings((current) => ({ ...current, presets: [...(current.presets || []), blankPreset()] }))}>Add preset</button></div>
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
			<SettingsGroupLabel>This workspace</SettingsGroupLabel>
			<SettingCard>
				<SettingRow>
					<SettingRowText>
						<SettingRowTitle>Model combinations</SettingRowTitle>
						<SettingRowDescription>
							{workspace
								? `Choose which model combinations sessions in ${workspace.name} can pick.`
								: "Open a workspace to set up its model combinations."}
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
