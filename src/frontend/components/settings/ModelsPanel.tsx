import { SettingsHeader, SettingsPanel } from "../../ui/settings";
import { AccountsPanel, ModelEngineDefaultsSection } from "../Models";
import { ModelProvidersPanel } from "../ModelProviders";
import { WorkspaceModelPresetSettings } from "../WorkspaceModelPresets";
import type { Workspace } from "../../lib/types";

/** Models: everywhere a model a session can run on comes from — the Anthropic
 * and OpenAI subscription pools, and any provider you brought a key for. These
 * were two sections whose descriptions each ended by pointing at the other. */
export function ModelsPanel({ workspace }: { workspace?: Workspace }) {
	return (
		<SettingsPanel>
			<SettingsHeader
				title="Models"
				description="Choose the models and execution environments available to new sessions."
			/>
			<AccountsPanel />
			<WorkspaceModelPresetSettings workspace={workspace} />
			<ModelProvidersPanel />
			{/* Last: one row per model, Auto on all of them until someone pins
			    one, so it sits below everything people came here to read. */}
			<ModelEngineDefaultsSection />
		</SettingsPanel>
	);
}
