import React, { useEffect, useState } from "react";
import type { Workspace } from "../lib/types";
import { updateWorkspaceApi, invalidateModelsCache } from "../lib/api";
import { Modal } from "../ui/modal";
import { Switch } from "../ui/switch";

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
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string | null>(null);
	useEffect(() => setSettings(workspace.modelSettings || {}), [workspace]);
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
						return <div key={key} className="flex items-center justify-between gap-4 rounded-md border border-line bg-panel px-3 py-2.5">
							<div><div className="text-label text-fg">{label}</div><div className="text-supporting text-dim">Shown in this workspace by default.</div></div>
							<Switch checked={settings[key] !== false} onCheckedChange={(checked) => setSettings((current) => ({ ...current, [key]: checked }))} />
						</div>;
					})}
					<div className="mt-2 flex items-center justify-between"><div className="text-label font-semibold text-fg">Your combinations</div><button className="rounded-sm border border-line px-2.5 py-1.5 text-supporting text-fg hover:bg-hover" onClick={() => setSettings((current) => ({ ...current, presets: [...(current.presets || []), blankPreset()] }))}>Add combination</button></div>
					{presets.map((preset, index) => <div key={preset.id} className="flex flex-col gap-2 rounded-md border border-line p-3">
						<div className="flex gap-2"><input className="min-w-0 flex-1 rounded-sm border border-line bg-surface px-2 py-1.5 text-label text-fg" value={preset.label} onChange={(e) => patchPreset(index, { label: e.target.value })} placeholder="Combination name" /><button className="rounded-sm px-2 text-supporting text-dim hover:bg-hover hover:text-fg" onClick={() => setSettings((current) => ({ ...current, presets: (current.presets || []).filter((_, i) => i !== index) }))}>Remove</button></div>
						<label className="text-supporting text-dim">Lead model<input className="mt-1 w-full rounded-sm border border-line bg-surface px-2 py-1.5 text-label text-fg" value={preset.lead.model} onChange={(e) => patchPreset(index, { lead: { ...preset.lead, model: e.target.value } })} placeholder="opencode/anthropic/claude-fable-5" /></label>
						<label className="text-supporting text-dim">Instructions<textarea className="mt-1 min-h-18 w-full resize-y rounded-sm border border-line bg-surface px-2 py-1.5 text-label text-fg" value={preset.instructions || ""} onChange={(e) => patchPreset(index, { instructions: e.target.value })} placeholder="When to use supporting models and how to integrate their work." /></label>
						<label className="text-supporting text-dim">Supporting models, one per line<input className="mt-1 w-full rounded-sm border border-line bg-surface px-2 py-1.5 text-label text-fg" value={(preset.supporting || []).map((member) => member.model).join("\n")} onChange={(e) => patchPreset(index, { supporting: e.target.value.split("\n").map((model) => ({ model: model.trim() })).filter((member) => member.model) })} placeholder="opencode/openai/gpt-5.6-terra" /></label>
					</div>)}
				</div>
				{error && <div className="text-supporting text-danger">{error}</div>}
				<Modal.Footer><Modal.Close render={<button className="rounded-sm px-3 py-2 text-label text-dim hover:bg-hover">Cancel</button>} /><button className="rounded-sm bg-fg px-3 py-2 text-label text-bg disabled:opacity-50" disabled={saving} onClick={() => void save()}>{saving ? "Saving…" : "Save"}</button></Modal.Footer>
			</Modal.Content>
		</Modal.Root>
	);
}
