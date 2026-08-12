import { SettingsHeader, SettingsPanel } from "../../ui/settings";
import { AccountsPanel } from "../Models";
import { ModelProvidersPanel } from "../ModelProviders";

/** Models: everywhere a model a session can run on comes from — the Anthropic
 * and OpenAI subscription pools, and any provider you brought a key for. These
 * were two sections whose descriptions each ended by pointing at the other. */
export function ModelsPanel() {
	return (
		<SettingsPanel>
			<SettingsHeader
				title="Models"
				description="Choose the models and execution environments available to new sessions."
			/>
			<AccountsPanel />
			<ModelProvidersPanel />
		</SettingsPanel>
	);
}
