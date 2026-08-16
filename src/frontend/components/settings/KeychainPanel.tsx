import { useCallback, useEffect, useRef, useState, type FormEvent, type RefObject } from "react";
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
import { Field, Input } from "../../ui/input";
import { Modal } from "../../ui/modal";
import {
	SettingCard,
	SettingsGroupLabel,
	SettingsHeader,
	SettingsHint,
	SettingsPanel,
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
	const serviceRef = useRef<HTMLInputElement>(null);

	const reload = useCallback(() => {
		fetchKeychain()
			.then(setData)
			.catch((e) => setError(e.message));
	}, []);
	useEffect(reload, [reload]);

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
				<Button size="sm" variant="ghost" onClick={() => setAdding(true)}>
					Add credential
				</Button>
			</SettingsGroupLabel>

			<Modal.Root open={adding} onOpenChange={setAdding}>
				{/* The form is a child so Base UI's portal remounts it on every
				    open. That is what clears the typed secret when the dialog is
				    dismissed rather than saved: it used to be cleared only on a
				    successful submit, so cancelling left it sitting in a React
				    state a devtools user could read back. */}
				<Modal.Content initialFocus={serviceRef}>
					<AddCredentialForm
						serviceRef={serviceRef}
						onAdded={() => {
							setAdding(false);
							reload();
						}}
						onError={setError}
					/>
				</Modal.Content>
			</Modal.Root>

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

/**
 * Registering a credential. Every field used to be placeholder-only with an
 * `aria-label`, so the moment you typed, the one thing telling you what the
 * box was for disappeared — and seven of those stacked in a card pushed the
 * credentials list off the page. Real labels now, and the placeholders say
 * what leaving a field blank does instead of restating the label.
 *
 * Two zones: what the credential IS, then the ceiling on how it may be used.
 */
function AddCredentialForm({
	serviceRef,
	onAdded,
	onError,
}: {
	serviceRef: RefObject<HTMLInputElement | null>;
	onAdded: () => void;
	onError: (message: string) => void;
}) {
	const [service, setService] = useState("");
	const [host, setHost] = useState("");
	const [secret, setSecret] = useState("");
	const [description, setDescription] = useState("");
	const [header, setHeader] = useState("");
	const [methods, setMethods] = useState("");
	const [prefixes, setPrefixes] = useState("");
	const [busy, setBusy] = useState(false);
	const ready = Boolean(service.trim() && host.trim() && secret);

	const submit = (event: FormEvent) => {
		event.preventDefault();
		if (!ready) return;
		setBusy(true);
		addKeychainCredential({
			service: service.trim(),
			host: host.trim(),
			secret,
			...(description.trim() ? { description: description.trim() } : {}),
			...(header.trim() ? { injection: { header: header.trim() } } : {}),
			...(methods.trim() ? { allowedMethods: list(methods) } : {}),
			...(prefixes.trim() ? { allowedPathPrefixes: list(prefixes) } : {}),
		})
			.then(() => {
				// Clear the secret first and always — it must not survive a
				// failed reload in a React state a devtools user can read back.
				setSecret("");
				onAdded();
			})
			.catch((e) => onError(e.message))
			.finally(() => setBusy(false));
	};

	return (
		<>
			<Modal.Header
				title="Add credential"
				description="A session can borrow it with your approval. The secret is injected server-side, so the agent never sees it."
			/>
			<form className="flex flex-col gap-5" onSubmit={submit}>
				<div className="flex flex-col gap-3">
					<Field label="Service">
						<Input ref={serviceRef} value={service} onChange={(e) => setService(e.target.value)} placeholder="vercel" autoCapitalize="none" spellCheck={false} />
					</Field>
					<Field label="API host">
						<Input value={host} onChange={(e) => setHost(e.target.value)} placeholder="api.vercel.com" autoCapitalize="none" spellCheck={false} />
					</Field>
					<Field label="Secret">
						<Input type="password" value={secret} onChange={(e) => setSecret(e.target.value)} placeholder="Never shown again" autoComplete="off" />
					</Field>
					<Field label="Description" title="Optional.">
						<Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What it is for" />
					</Field>
				</div>
				<div className="flex flex-col gap-3">
					<Field label="Injection header">
						<Input value={header} onChange={(e) => setHeader(e.target.value)} placeholder="Authorization: Bearer" autoCapitalize="none" spellCheck={false} />
					</Field>
					<Field label="Allowed methods" title="Comma-separated.">
						<Input value={methods} onChange={(e) => setMethods(e.target.value)} placeholder="Any method" autoCapitalize="none" spellCheck={false} />
					</Field>
					<Field label="Allowed path prefixes" title="Comma-separated.">
						<Input value={prefixes} onChange={(e) => setPrefixes(e.target.value)} placeholder="Any path" autoCapitalize="none" spellCheck={false} />
					</Field>
					{/* The hint belongs to this zone, so it sits inside it rather
					    than floating between the fields and the actions. */}
					<p className="m-0 text-meta leading-relaxed text-faint">
						Narrow the methods and paths where you can. A grant can only reach what the
						credential allows, so this is the ceiling on anything you approve later.
					</p>
				</div>
				<Modal.Footer>
					<Modal.Close render={<Button variant="ghost" disabled={busy}>Cancel</Button>} />
					<Button variant="primary" type="submit" disabled={busy || !ready}>
						{busy ? "Saving…" : "Add credential"}
					</Button>
				</Modal.Footer>
			</form>
		</>
	);
}

function list(value: string): string[] {
	return value.split(",").map((item) => item.trim()).filter(Boolean);
}
