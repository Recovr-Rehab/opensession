import { BASE_PATH } from "../lib/base";
import React, { useCallback, useEffect, useState } from "react";
import { Button } from "../ui/button";
import { EmptyState, InlineAlert, LoadingState } from "../ui/state";
import {
	SettingCard,
	SettingRow,
	SettingRowControl,
	SettingRowDescription,
	SettingRowText,
	SettingRowTitle,
	SettingsGroupLabel,
	SettingsHeader,
	SettingsHint,
	SettingsPanel,
	StatusChip,
	rowMenuTriggerClasses,
} from "../ui/settings";
import { Menu } from "../ui/menu";
import { IconDotsHorizontal, IconPlug, IconTrash } from "./icons";
import { displayName } from "../brand-logos";
import { IconTile } from "./BrandTile";
import { useCurrentUser } from "./UserPicker";
import { GithubAccounts } from "./Connections";
import { KeychainSection } from "./settings/KeychainPanel";

interface OauthStatus {
	shared?: { connectedBy?: string };
	users: string[];
	/** Server publishes OAuth metadata (connectable even if it runs on a
	 *  workspace API key today, e.g. posthog). */
	capable?: boolean;
}

/**
 * Settings → Personal → My accounts: every per-user sign-in in one place —
 * OAuth-capable MCP servers (connect as yourself; your sessions then use
 * YOUR account, falling back to the workspace grant — src/server/mcp-oauth.ts),
 * the per-user GitHub auth section (PRs as yourself), and your keychain (the
 * credentials a session can borrow from you). Workspace-wide MCP grants stay
 * on the Connections page's server cards (admin surface).
 */
export function MyAccountsPanel() {
	const currentUser = useCurrentUser();
	const [servers, setServers] = useState<
		{ name: string; transport: string; status: string }[] | null
	>(null);
	const [oauthByName, setOauthByName] = useState<Record<string, OauthStatus>>(
		{},
	);
	const [error, setError] = useState<string | null>(null);

	const load = useCallback(async () => {
		try {
			const res = await fetch(`${BASE_PATH}/api/connections`);
			if (!res.ok) return;
			const body = await res.json();
			// All servers — stdio ones can be OAuth-capable too via presets
			// (Slack user tokens); the status endpoint's `capable` decides.
			const mcp = body.mcpServers || [];
			setServers(mcp);
			const entries = await Promise.all(
				mcp.map(async (s: { name: string }) => {
					try {
						const r = await fetch(
							`${BASE_PATH}/api/connections/mcp/${encodeURIComponent(s.name)}/oauth`,
						);
						return r.ok ? ([s.name, await r.json()] as const) : null;
					} catch {
						return null;
					}
				}),
			);
			setOauthByName(Object.fromEntries(entries.filter(Boolean) as any));
		} catch {}
	}, []);

	useEffect(() => {
		void load();
	}, [load]);

	async function connect(name: string) {
		try {
			const res = await fetch(
				`${BASE_PATH}/api/connections/mcp/${encodeURIComponent(name)}/oauth/start`,
				{
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ scope: "me" }),
				},
			);
			const body = await res.json();
			if (!res.ok) throw new Error(body.error || `Failed: ${res.status}`);
			window.open(body.url, "_blank", "noopener");
			// Re-poll for a while so the row flips once they approve the consent.
			let polls = 0;
			const t = setInterval(() => {
				if (++polls > 24) return clearInterval(t);
				void load();
			}, 5000);
		} catch (e: any) {
			setError(e.message);
		}
	}

	async function disconnect(name: string) {
		try {
			const res = await fetch(
				`${BASE_PATH}/api/connections/mcp/${encodeURIComponent(name)}/oauth?scope=me`,
				{ method: "DELETE" },
			);
			if (!res.ok)
				throw new Error((await res.json()).error || `Failed: ${res.status}`);
			void load();
		} catch (e: any) {
			setError(e.message);
		}
	}

	const isMe = (teamName: string) => {
		const a = teamName.toLowerCase();
		const b = (currentUser || "").toLowerCase();
		return !!b && (a === b || a.startsWith(b) || b.startsWith(a));
	};
	// OAuth-capable = the server publishes OAuth metadata (even when it runs
	// on a workspace key today), needs sign-in, or already has grants.
	const oauthServers = (servers || []).filter(
		(s) =>
			s.status === "needs-auth" ||
			oauthByName[s.name]?.capable ||
			oauthByName[s.name]?.shared ||
			oauthByName[s.name]?.users.length,
	);

	return (
		<SettingsPanel>
			<SettingsHeader
				title="My accounts"
				description="Sessions act as you where you're connected, and fall back to the workspace account everywhere else."
			/>
			{error && (
				<InlineAlert onDismiss={() => setError(null)}>{error}</InlineAlert>
			)}
			<SettingsGroupLabel>Tools</SettingsGroupLabel>
			{servers === null ? (
				<LoadingState>Checking connections…</LoadingState>
			) : oauthServers.length === 0 ? (
				<EmptyState placement="card">
					No tools with personal sign-in are configured yet. Add one on the
					Connections page and it shows up here.
				</EmptyState>
			) : (
				<SettingCard>
					{oauthServers.map((s) => {
						const st = oauthByName[s.name];
						const mine = st?.users.some(isMe);
						const slack = s.name.toLowerCase() === "slack";
						return (
							<SettingRow key={s.name} className="gap-3">
								<IconTile name={s.name} size={30} />
								<SettingRowText>
									<SettingRowTitle>{displayName(s.name)}</SettingRowTitle>
									<SettingRowDescription>
										{slack && mine
											? "Post messages and screenshots as you after a PR merges"
											: slack
												? "Connect to post messages and screenshots as you after a PR merges"
												: mine
													? // Not "Connected as you": the chip beside it already
														// says connected, so the description says what that
														// buys instead of repeating the state.
														"Sessions use your account"
											: st?.shared
												? "Using the workspace account"
												: st?.capable
													? "Using the workspace key"
													: "Not connected"}
									</SettingRowDescription>
								</SettingRowText>
								<SettingRowControl className="flex items-center gap-2">
									{mine ? (
										// A connected row states that it is connected and keeps its
										// actions in the ⋯ menu. Left as buttons, "Disconnect" sat
										// exactly where an unconnected row shows "Connect", in the
										// same neutral style, so the two states read alike.
										<>
											<StatusChip label="Connected" dot="var(--green)" />
											<Menu.Root>
												<Menu.Trigger
													className={rowMenuTriggerClasses}
													aria-label={`Manage ${displayName(s.name)}`}
												>
													<IconDotsHorizontal size={18} />
												</Menu.Trigger>
												<Menu.Popup align="end" sideOffset={4}>
													<Menu.Item onClick={() => connect(s.name)}>
														<IconPlug size={16} className="text-faint" />
														Reconnect
													</Menu.Item>
													<Menu.Item
														onClick={() => disconnect(s.name)}
														className="text-red data-[highlighted]:bg-red-soft"
													>
														<IconTrash size={16} />
														Disconnect
													</Menu.Item>
												</Menu.Popup>
											</Menu.Root>
										</>
									) : (
										// Not `primary`: one red button per row would make a list of
										// unconnected servers shout, and the GitHub rows below use the
										// same neutral Connect.
										<Button size="sm" onClick={() => connect(s.name)}>
											Connect
										</Button>
									)}
								</SettingRowControl>
							</SettingRow>
						);
					})}
				</SettingCard>
			)}
			{oauthServers.length > 0 && (
				<SettingsHint>
					Connect a tool to use your own account in sessions. Unconnected tools
					use the workspace account.
				</SettingsHint>
			)}
			<GithubAccounts personal />
			<KeychainSection />
		</SettingsPanel>
	);
}
