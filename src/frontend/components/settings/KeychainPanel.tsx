import { useCallback, useEffect, useState } from "react";
import {
	addKeychainCredential,
	deleteKeychainCredential,
	fetchKeychain,
	revokeKeychainGrant,
	type KeychainAskDto,
	type KeychainCredentialDto,
	type KeychainGrantDto,
} from "../../lib/api";
import { Button } from "../../ui/button";
import {
	SettingCard,
	SettingsGroupLabel,
	SettingsHeader,
	SettingsHint,
	SettingsPanel,
	settingsInputClass,
} from "../../ui/settings";
import { EmptyState, InlineAlert, LoadingState } from "../../ui/state";
import { SettingRow } from "./shared";

// ── Keychain: per-person credentials sessions can BORROW with your approval
// (src/server/keychain.ts). Registration lives here rather than in a tool
// because a secret pasted into a session prompt is a secret in the transcript. ──
export function KeychainPanel() {
	const [data, setData] = useState<{
		credentials: KeychainCredentialDto[];
		grants: KeychainGrantDto[];
		asks: KeychainAskDto[];
	} | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [adding, setAdding] = useState(false);
	const [service, setService] = useState("");
	const [host, setHost] = useState("");
	const [secret, setSecret] = useState("");
	const [description, setDescription] = useState("");
	const [header, setHeader] = useState("");
	const [methods, setMethods] = useState("");
	const [prefixes, setPrefixes] = useState("");
	const [busy, setBusy] = useState(false);

	const reload = useCallback(() => {
		fetchKeychain()
			.then(setData)
			.catch((e) => setError(e.message));
	}, []);
	useEffect(reload, [reload]);

	const submit = () => {
		setBusy(true);
		addKeychainCredential({
			service: service.trim(),
			host: host.trim(),
			secret,
			...(description.trim() ? { description: description.trim() } : {}),
			...(header.trim() ? { injection: { header: header.trim() } } : {}),
			...(methods.trim()
				? { allowedMethods: methods.split(",").map((m) => m.trim()).filter(Boolean) }
				: {}),
			...(prefixes.trim()
				? { allowedPathPrefixes: prefixes.split(",").map((p) => p.trim()).filter(Boolean) }
				: {}),
		})
			.then(() => {
				// Clear the secret first and always — it must not survive a
				// failed reload in a React state a devtools user can read back.
				setSecret("");
				setService("");
				setHost("");
				setDescription("");
				setHeader("");
				setMethods("");
				setPrefixes("");
				setAdding(false);
				reload();
			})
			.catch((e) => setError(e.message))
			.finally(() => setBusy(false));
	};

	const panelHeader = (
		<SettingsHeader
			title="Keychain"
			description="Credentials a session can borrow with the owner's approval. The secret is injected server-side, so the agent never sees it, and every grant is scoped to one session and expires."
		/>
	);

	if (!data)
		return (
			<SettingsPanel>
				{panelHeader}
				{error ? <InlineAlert>{error}</InlineAlert> : <LoadingState>Loading keychain…</LoadingState>}
			</SettingsPanel>
		);

	const byId = new Map(data.credentials.map((c) => [c.id, c]));
	const activeGrants = data.grants.filter((g) => g.status === "active");
	const pendingAsks = data.asks.filter((a) => a.status === "pending");

	return (
		<SettingsPanel>
			{panelHeader}
			{error && <InlineAlert onDismiss={() => setError(null)}>{error}</InlineAlert>}

			<SettingsGroupLabel className="flex items-center justify-between gap-2">
				Credentials
				<Button size="sm" variant="ghost" onClick={() => setAdding((v) => !v)}>
					{adding ? "Cancel" : "Add credential"}
				</Button>
			</SettingsGroupLabel>

			{adding && (
				<SettingCard>
					<div className="flex flex-col gap-2 p-4">
						<input
							className={settingsInputClass}
							value={service}
							onChange={(e) => setService(e.target.value)}
							placeholder="service slug, e.g. vercel"
							aria-label="Service slug"
						/>
						<input
							className={settingsInputClass}
							value={host}
							onChange={(e) => setHost(e.target.value)}
							placeholder="api host, e.g. api.vercel.com"
							aria-label="API host"
						/>
						<input
							className={settingsInputClass}
							type="password"
							value={secret}
							onChange={(e) => setSecret(e.target.value)}
							placeholder="secret (never shown again, never sent to a model)"
							aria-label="Secret"
						/>
						<input
							className={settingsInputClass}
							value={description}
							onChange={(e) => setDescription(e.target.value)}
							placeholder="what it's for (optional)"
							aria-label="Description"
						/>
						<input
							className={settingsInputClass}
							value={header}
							onChange={(e) => setHeader(e.target.value)}
							placeholder="header (optional, default: Authorization: Bearer)"
							aria-label="Injection header"
						/>
						<input
							className={settingsInputClass}
							value={methods}
							onChange={(e) => setMethods(e.target.value)}
							placeholder="allowed methods, comma-separated (optional, e.g. GET)"
							aria-label="Allowed methods"
						/>
						<input
							className={settingsInputClass}
							value={prefixes}
							onChange={(e) => setPrefixes(e.target.value)}
							placeholder="allowed path prefixes, comma-separated (optional, e.g. /v1/deployments)"
							aria-label="Allowed path prefixes"
						/>
						<SettingsHint>
							Narrow the methods and paths where you can. A grant can only reach what the
							credential allows, so this is the ceiling on anything you approve later.
						</SettingsHint>
						<Button
							size="sm"
							disabled={busy || !service.trim() || !host.trim() || !secret}
							onClick={submit}
						>
							{busy ? "Saving…" : "Save credential"}
						</Button>
					</div>
				</SettingCard>
			)}

			{data.credentials.length === 0 ? (
				<EmptyState placement="card">
					No credentials yet. Add one so sessions can request scoped access without putting a
					token in a prompt.
				</EmptyState>
			) : (
				<SettingCard>
					{data.credentials.map((c) => (
						<SettingRow
							key={c.id}
							title={`${c.service} · ${c.host}`}
							desc={[
								`owner ${c.owner}`,
								c.description,
								c.allowedMethods?.length ? `methods ${c.allowedMethods.join("/")}` : null,
								c.allowedPathPrefixes?.length
									? `paths ${c.allowedPathPrefixes.join(", ")}`
									: null,
							]
								.filter(Boolean)
								.join(" · ")}
							control={
								<Button
									size="sm"
									variant="ghost"
									onClick={() =>
										deleteKeychainCredential(c.id)
											.then(reload)
											.catch((e) => setError(e.message))
									}
								>
									Delete
								</Button>
							}
						/>
					))}
				</SettingCard>
			)}

			{pendingAsks.length > 0 && (
				<>
					<SettingsGroupLabel>Awaiting your answer</SettingsGroupLabel>
					<SettingCard>
						{pendingAsks.map((a) => (
							<SettingRow
								key={a.id}
								title={`${byId.get(a.credentialId)?.service ?? a.credentialId} · ${a.requestedBy}`}
								desc={`${a.requestedMode} · ${a.purpose}`}
								control={null}
							/>
						))}
					</SettingCard>
					<SettingsHint>
						Answer these where they were asked: the Slack DM, or the card in the session.
					</SettingsHint>
				</>
			)}

			<SettingsGroupLabel>Active grants</SettingsGroupLabel>
			{activeGrants.length === 0 ? (
				<EmptyState placement="card">No session currently holds a keychain grant.</EmptyState>
			) : (
				<SettingCard>
					{activeGrants.map((g) => (
						<SettingRow
							key={g.id}
							title={`${byId.get(g.credentialId)?.service ?? g.credentialId} → ${g.requestedBy}`}
							desc={`${g.mode} · expires ${new Date(g.expiresAt).toLocaleString()} · ${g.purpose}`}
							control={
								<Button
									size="sm"
									variant="ghost"
									onClick={() =>
										revokeKeychainGrant(g.id)
											.then(reload)
											.catch((e) => setError(e.message))
									}
								>
									Revoke
								</Button>
							}
						/>
					))}
				</SettingCard>
			)}
		</SettingsPanel>
	);
}
