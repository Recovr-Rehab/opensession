import { useEffect, useState } from "react";
import { useSetupStatus } from "../../hooks/useSetupStatus";
import { SettingCard, SettingsHeader, SettingsPanel } from "../../ui/settings";
import { Select, SettingRow } from "./shared";
import { LoadingState } from "../../ui/state";
import { ReposSection } from "../SetupRepos";
import {
	configuredNewSessionRepo,
	fetchRepos,
	setNewSessionRepoApi,
	type RepoInfo,
} from "../../lib/api";
import { AUTO_REPO } from "../../lib/session-repo";

/**
 * Where a new session starts for everyone who hasn't set their own preference
 * (Settings → Preferences overrides this). Auto reads the prompt and picks.
 *
 * Deliberately not the same thing as which repo is "the default" internally:
 * that one is a fallback that must always name a real checkout, so it can't
 * say Auto.
 */
function DefaultRepoRow() {
	const [repos, setRepos] = useState<RepoInfo[]>([]);
	const [value, setValue] = useState("");
	useEffect(() => {
		// fetchRepos carries the setting alongside the list, so one load fills
		// both the options and the current choice.
		fetchRepos()
			.then((items) => {
				setRepos(items);
				setValue(configuredNewSessionRepo());
			})
			.catch(() => {});
	}, []);
	return (
		<SettingCard>
			<SettingRow
				title="Default repository"
				desc="Where a new session starts, for anyone who hasn't set their own. On Auto it reads the prompt and picks."
				control={
					<Select
						label="Default repository"
						value={value}
						options={[
							{ value: AUTO_REPO, label: "Auto" },
							...repos.map((r) => ({ value: r.id, label: r.label || r.id })),
						]}
						onChange={(next) => {
							setValue(next);
							void setNewSessionRepoApi(next).catch(() => {});
						}}
					/>
				}
			/>
		</SettingCard>
	);
}

// Workspace → Repositories: the registered repos, and the add flow, on a page
// of their own. Same section the Setup wizard's repos step renders — a repo
// added here and a repo added there are the same act. No restart banner:
// registering a repo takes effect immediately.

export function ReposPanel() {
	const { status, failed, refetch } = useSetupStatus();
	return (
		<SettingsPanel>
			<SettingsHeader
				title="Repositories"
				description="Each session works in an isolated worktree of the repositories you register here."
			/>
			{!status ? (
				<LoadingState>
					{failed ? "Couldn't load the repositories." : "Loading…"}
				</LoadingState>
			) : (
				<>
					<DefaultRepoRow />
					<ReposSection repos={status.repos} onChanged={refetch} />
				</>
			)}
		</SettingsPanel>
	);
}
