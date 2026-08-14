import { resolveModel, toPiModel } from "./models";
import { getWorkspace } from "./workspaces";

export interface ResolvedWorkspaceModelPreset {
	model: string;
	effort?: string;
	note: string;
}

/** Resolve a picker preset into the model and stable instructions it represents. */
export function resolveWorkspaceModelPreset(
	requested: unknown,
	workspaceId: unknown,
): ResolvedWorkspaceModelPreset | undefined {
	if (typeof requested !== "string" || typeof workspaceId !== "string") return undefined;
	const pi = requested.startsWith("pi/");
	const id = (pi ? requested.slice(3) : requested).trim();
	const match = id.match(/^workspace-preset\/([^/]+)\/([A-Za-z0-9_-]{1,64})$/);
	if (!match || match[1] !== workspaceId) return undefined;
	const preset = getWorkspace(workspaceId)?.modelSettings?.presets?.find(
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
		model,
		effort: preset.lead.effort,
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
