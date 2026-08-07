import { SettingsHeader, SettingsPanel } from "../../ui/settings";
import { IdentityCard } from "../SetupIdentity";

// Workspace → Identity. The same card the Setup wizard's identity step shows,
// on a page of its own for the day someone renames the agent.

export function IdentityPanel() {
	return (
		<SettingsPanel>
			<SettingsHeader
				title="Identity"
				description="What this instance and its agent are called, everywhere they introduce themselves."
			/>
			<IdentityCard />
		</SettingsPanel>
	);
}
