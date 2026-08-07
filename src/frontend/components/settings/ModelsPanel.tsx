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
				description="Where the models sessions run on come from — the Claude (Anthropic) and Codex (OpenAI) subscription accounts, plus any provider you bring your own API key for — and which model new runs start on."
			/>
			<AccountsPanel />
			<ModelProvidersPanel />
		</SettingsPanel>
	);
}
