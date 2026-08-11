import { useEffect, useState } from "react";
import {
	fetchSandboxStatus,
	saveSandboxDefault,
	type SandboxStatusInfo,
} from "../../lib/api";
import {
	SettingCard,
	SettingsGroupLabel,
	SettingsHint,
} from "../../ui/settings";
import { toast } from "../../ui/toast";
import { getCurrentUser } from "../UserPicker";
import { Select, SettingRow } from "./shared";

type Scope = "workspace" | "personal";

function providerLabel(id: string): string {
	if (id === "none") return "None";
	if (id === "docker") return "Docker";
	if (id === "daytona") return "Daytona";
	if (id === "e2b") return "E2B";
	if (id === "box") return "Box";
	if (id === "modal") return "Modal";
	if (id === "microvm") return "Local Firecracker MicroVM";
	if (id === "lambda-microvm") return "AWS Lambda MicroVM";
	return id;
}

function SandboxDefaultRow({ scope }: { scope: Scope }) {
	const user = getCurrentUser();
	const [status, setStatus] = useState<SandboxStatusInfo | null>(null);
	const [saving, setSaving] = useState(false);
	useEffect(() => {
		fetchSandboxStatus(user).then(setStatus).catch(() => {});
	}, [user]);

	if (!status?.defaults) {
		return (
			<SettingRow
				title="Default sandbox"
				desc="Loading available sandbox providers…"
				control={<span className="text-supporting text-faint">Loading…</span>}
			/>
		);
	}

	const providers = status.providers.filter((provider) => provider.configured && provider.certified);
	const workspace = status.defaults.workspace || "none";
	const value = scope === "workspace" ? workspace : status.defaults.personal || "workspace";
	const options = [
		...(scope === "personal"
			? [{ value: "workspace", label: `Workspace default — ${providerLabel(workspace)}` }]
			: []),
		{ value: "none", label: "None" },
		...providers.map((provider) => ({
			value: provider.id,
			label: providerLabel(provider.id),
		})),
	];

	async function save(next: string) {
		setSaving(true);
		try {
			const response = await saveSandboxDefault({ scope, value: next, user });
			setStatus((current) =>
				current ? { ...current, defaults: response.defaults } : current,
			);
		} catch (error) {
			toast(error instanceof Error ? error.message : "Failed to save sandbox default", {
				variant: "error",
			});
			fetchSandboxStatus(user).then(setStatus).catch(() => {});
		} finally {
			setSaving(false);
		}
	}

	return (
		<SettingRow
			title="Default sandbox"
			desc={
				scope === "personal"
					? "Your environment for new sessions. A per-session choice still overrides it."
					: "The environment new sessions use unless a person or session chooses another."
			}
			control={
				<div className={saving ? "pointer-events-none opacity-60" : undefined}>
					<Select
						label={`${scope === "personal" ? "Personal" : "Workspace"} default sandbox`}
						value={value}
						options={options}
						onChange={(next) => void save(next)}
					/>
				</div>
			}
		/>
	);
}

export function PersonalSandboxDefaultRow() {
	return <SandboxDefaultRow scope="personal" />;
}

export function WorkspaceSandboxDefaults() {
	return (
		<>
			<SettingsGroupLabel className="mt-0">Session environment</SettingsGroupLabel>
			<SettingCard>
				<SandboxDefaultRow scope="workspace" />
			</SettingCard>
			<SettingsHint>
				None keeps sessions on this host. Only configured providers that passed the live
				behavior and warm-restore matrices are offered.
			</SettingsHint>
		</>
	);
}
