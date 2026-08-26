import { useState } from "react";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Segmented, SegmentedOption } from "../ui/segmented";
import { SettingsHint } from "../ui/settings";
import { InlineAlert } from "../ui/state";
import { IconTile } from "./BrandTile";
import {
	githubAppCreateOwner,
	githubAppInstallUrlForSlug,
	githubAppSettingsUrlForSlug,
	githubAppSetupOwner,
	githubManifestAction,
	type GithubAppOwnerType,
} from "../lib/github-app-setup";
import {
	SetupSteps,
	StateChip,
	setupRequest,
	type ChipTone,
	type SetupGithub,
} from "./setup-shared";

function githubManifestSteps(owner: GithubAppOwnerType) {
	const account = owner === "organization" ? "organization" : "personal account";
	return [
		<>
			Review the prefilled name and permissions, then create a GitHub App for your{" "}
			{account}.
		</>,
		<>
			Open the created App, enable <strong>Device Flow</strong>, then save the
			 changes.
		</>,
		<>Install the App on the repositories Open Session should reach.</>,
	];
}

export function GithubManifestSetup({
	github,
	returnTo,
	connectionStatus,
}: {
	github: SetupGithub;
	returnTo: "welcome" | "settings";
	connectionStatus?: { tone: ChipTone; label: string };
}) {
	const initialOwner = githubAppCreateOwner(github.appCreateUrl);
	const [owner, setOwner] = useState<GithubAppOwnerType>(
		githubAppSetupOwner(github),
	);
	const [ownerDrafts, setOwnerDrafts] = useState<Record<GithubAppOwnerType, string>>({
		personal: initialOwner.type === "personal" ? github.installationOwner ?? "" : "",
		organization:
			github.appOrg ??
			(initialOwner.type === "organization"
				? github.installationOwner ?? initialOwner.login
				: ""),
	});
	const [starting, setStarting] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const installationOwner = ownerDrafts[owner];
	const ownerReady = owner === "personal" || Boolean(installationOwner.trim());
	const settingsUrl = githubAppSettingsUrlForSlug(
		github.appSlug,
		github.appOrg,
	);
	const installUrl = githubAppInstallUrlForSlug(github.appSlug ?? "");
	const result =
		typeof window === "undefined"
			? null
			: new URLSearchParams(window.location.search).get("github_manifest");

	async function createApp() {
		if (starting || !ownerReady) return;
		setStarting(true);
		setError(null);
		try {
			const body = await setupRequest<{ action: string; manifest: string }>(
				"/api/setup/github/manifest",
				{
					method: "POST",
					json: {
						owner,
						returnTo,
						...(owner === "organization"
							? { organization: installationOwner.trim() }
							: {}),
					},
				},
			);
			const action = githubManifestAction(body.action);
			if (!action) {
				setError("GitHub returned an invalid App registration address");
				setStarting(false);
				return;
			}
			const form = document.createElement("form");
			form.method = "post";
			form.action = action;
			form.hidden = true;
			const manifest = document.createElement("input");
			manifest.type = "hidden";
			manifest.name = "manifest";
			manifest.value = body.manifest;
			form.append(manifest);
			document.body.append(form);
			if (returnTo === "welcome") {
				window.sessionStorage.setItem("opensession:first-mile-step", "github");
			}
			form.submit();
		} catch (cause) {
			setError(
				cause instanceof Error ? cause.message : "Could not start GitHub App setup",
			);
			setStarting(false);
		}
	}

	return (
		<>
			{connectionStatus ? (
				<div className="flex items-start justify-between gap-4">
					<div className="min-w-0">
						<IconTile name="github" size={40} />
						<div className="mt-4 text-dialog-title font-semibold text-fg">
							How to connect
						</div>
					</div>
					<div className="pt-1">
						<StateChip tone={connectionStatus.tone} label={connectionStatus.label} />
					</div>
				</div>
			) : (
				<div className="text-dialog-title font-semibold text-fg">How to connect</div>
			)}
			<div className="flex flex-col gap-2">
				<Segmented
					label="GitHub App owner"
					value={owner}
					onValueChange={(value) => setOwner(value as GithubAppOwnerType)}
					className="w-full"
				>
					<SegmentedOption
						value="personal"
						className="flex-1 justify-center phone:min-h-11"
					>
						Personal account
					</SegmentedOption>
					<SegmentedOption
						value="organization"
						className="flex-1 justify-center phone:min-h-11"
					>
						Organization
					</SegmentedOption>
				</Segmented>
				{owner === "organization" && (
					<label className="flex flex-col gap-1">
						<span className="text-label font-medium text-dim">Organization login</span>
						<Input
							value={installationOwner}
							onChange={(event) =>
								setOwnerDrafts((current) => ({
									...current,
									organization: event.target.value,
								}))
							}
							placeholder="my-organization"
							className="font-mono phone:min-h-11 phone:text-input-phone"
							disabled={starting}
							autoCapitalize="none"
							autoComplete="off"
							spellCheck={false}
						/>
						<span data-onboarding-caption="" className="text-meta text-faint">
							The organization that will own and install the App.
						</span>
					</label>
				)}
			</div>
			<SetupSteps steps={githubManifestSteps(owner)} />
			{result === "created" && (
				<SettingsHint className="m-0">
					GitHub App created. Enable Device Flow before you install it.
				</SettingsHint>
			)}
			{result === "error" && (
				<InlineAlert>GitHub App setup could not be completed. Try again.</InlineAlert>
			)}
			{error && <InlineAlert>{error}</InlineAlert>}
			<div className="mt-auto flex flex-col gap-2">
				<Button
					variant="primary"
					size="lg"
					className="min-h-11 w-full justify-center"
					disabled={github.clientIdConfigured || !ownerReady || starting}
					onClick={() => void createApp()}
				>
					{github.clientIdConfigured
						? "1. GitHub App created"
						: starting
							? "Opening GitHub…"
							: "1. Create GitHub App"}
				</Button>
				{settingsUrl ? (
					<Button
						size="lg"
						className="min-h-11 w-full justify-center"
						render={<a href={settingsUrl} target="_blank" rel="noreferrer" />}
					>
						2. Enable Device Flow
					</Button>
				) : (
					<Button size="lg" className="min-h-11 w-full justify-center" disabled>
						2. Enable Device Flow
					</Button>
				)}
				{installUrl ? (
					<Button
						size="lg"
						className="min-h-11 w-full justify-center"
						render={<a href={installUrl} target="_blank" rel="noreferrer" />}
					>
						3. Install GitHub App
					</Button>
				) : (
					<Button size="lg" className="min-h-11 w-full justify-center" disabled>
						3. Install GitHub App
					</Button>
				)}
			</div>
		</>
	);
}
