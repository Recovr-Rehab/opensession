import { useSetupStatus } from "../../hooks/useSetupStatus";
import {
	SettingsGroupLabel,
	SettingsHeader,
	SettingsHint,
	SettingsPanel,
} from "../../ui/settings";
import { LoadingState } from "../../ui/state";
import { GithubAuthCard, IntegrationsList } from "../SetupIntegrations";
import { SetupRestart } from "../SetupRestart";

// Workspace → Integrations: the credentials the agent reaches other tools
// with, plus GitHub sign-in. Same cards the Setup wizard shows, including its
// restart banner — a credential saved here needs the same reboot to take
// effect as one saved there.

export function IntegrationsPanel() {
	const setup = useSetupStatus();
	const { status, failed } = setup;
	return (
		<SettingsPanel className="relative">
			<SettingsHeader
				title="Integrations"
				description="Connect agent tools and event sources. Each setup includes the provider steps, required permissions, and credentials."
			/>
			{!status ? (
				<LoadingState>
					{failed ? "Couldn't load the integrations." : "Loading…"}
				</LoadingState>
			) : (
				<>
					<IntegrationsList
						integrations={status.integrations}
						publicBaseUrl={status.publicBaseUrl}
						onSaved={setup.applyIntegration}
					/>

					<SettingsGroupLabel>GitHub sign-in</SettingsGroupLabel>
					<GithubAuthCard github={status.github} onSaved={setup.applyGithub} />
					<SettingsHint>
						After setup, teammates connect their own accounts under Workspace → Connections.
					</SettingsHint>
				</>
			)}
			<SetupRestart setup={setup} />
		</SettingsPanel>
	);
}
