import {
	DIAL_ORACLE_AGENTS,
	DIAL_PRESETS,
	resolveModel,
	toOpencodeModel,
	toPiModel,
} from "./models";
import { getWorkspace } from "./workspaces";

export interface ResolvedWorkspaceModelPreset {
	/** The picker id retained on the session, so the UI and history keep the preset name. */
	id: string;
	label: string;
	model: string;
	effort?: string;
	note: string;
	/** A built-in preset with the same complete configuration can use its real oracle/worker wiring. */
	enginePresetId?: string;
}

/** Return the Dial preset with the exact same lead and oracle configuration. */
function matchingDialPreset(preset: {
	lead: { model: string; effort?: string };
	supporting?: Array<{ model: string; effort?: string }>;
}): string | undefined {
	return DIAL_PRESETS.find((candidate) => {
		const oracle = DIAL_ORACLE_AGENTS[candidate.oracleAgent];
		return (
			toOpencodeModel(preset.lead.model) === toOpencodeModel(candidate.model) &&
			preset.lead.effort === candidate.effort &&
			preset.supporting?.length === 1 &&
			toOpencodeModel(preset.supporting[0].model) === toOpencodeModel(oracle.model) &&
			preset.supporting[0].effort === oracle.variant
		);
	})?.id;
}

/** Resolve a picker preset into the model and stable instructions it represents. */
export function resolveWorkspaceModelPreset(
	requested: unknown,
	workspaceId?: unknown,
): ResolvedWorkspaceModelPreset | undefined {
	if (typeof requested !== "string") return undefined;
	const pi = requested.startsWith("pi/");
	const id = (pi ? requested.slice(3) : requested).trim();
	const match = id.match(/^workspace-preset\/([^/]+)\/([A-Za-z0-9_-]{1,64})$/);
	if (!match || (typeof workspaceId === "string" && match[1] !== workspaceId)) return undefined;
	const preset = getWorkspace(match[1])?.modelSettings?.presets?.find(
		(item) => item.id === match[2],
	);
	if (!preset?.lead?.model?.trim()) return undefined;
	const lead = preset.lead.model.trim();
	const routed =
		pi && !lead.startsWith("pi/")
			? lead.startsWith("opencode/")
				? `pi/${lead.slice("opencode/".length)}`
				: `pi/${lead}`
			: lead;
	const model = resolveModel(routed)?.id;
	if (!model) return undefined;
	// The default Opus + Fable combination is also a real Dial preset. Keep
	// the editable workspace id on the session, but activate its actual oracle
	// agent when the full configuration still matches.
	const enginePresetId = !pi ? matchingDialPreset(preset) : undefined;
	const supporting = (preset.supporting || [])
		.filter((member) => member.model?.trim())
		.map((member) => {
			const configuredModel = member.model.trim();
			const supportingModel = pi
				? toPiModel(configuredModel) || configuredModel
				: configuredModel;
			return `- ${member.role?.trim() || "Supporting worker"}: ${supportingModel}${member.effort ? ` at ${member.effort} effort` : ""}`;
		})
		.join("\n");
	return {
		id: `${pi ? "pi/" : ""}${id}`,
		label: preset.label.trim(),
		model,
		effort: preset.lead.effort,
		...(enginePresetId ? { enginePresetId } : {}),
		note: [
			`## Workspace model preset · ${preset.label.trim()}`,
			preset.instructions?.trim() ||
				"Lead this task and use the supporting models when a focused second perspective or implementation worker helps.",
			supporting
				? `Supporting models for this preset:\n${supporting}\nUse opensession-sessions to create focused worker sessions with these models. Give each worker a self-contained brief, then integrate and verify its result yourself.`
				: "",
		]
			.filter(Boolean)
			.join("\n\n"),
	};
}
