import { useEffect, useState } from "react";
import { Button } from "../ui/button";
import { SettingsSection } from "../ui/settings";
import { InlineAlert, LoadingState } from "../ui/state";
import {
	disconnectTraces,
	fetchTracesStatus,
	pollTracesConnect,
	startTracesConnect,
	type TracesConnectedAccount,
} from "../lib/api/traces";

export function TracesConfiguration({ enabled }: { enabled: boolean }) {
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [cliPresent, setCliPresent] = useState(false);
	const [namespaceSlug, setNamespaceSlug] = useState<string | null>(null);
	const [me, setMe] = useState<TracesConnectedAccount | null>(null);
	const [connecting, setConnecting] = useState(false);
	const [verificationUrl, setVerificationUrl] = useState<string | null>(null);

	async function refresh() {
		setLoading(true);
		setError(null);
		try {
			const body = await fetchTracesStatus();
			setCliPresent(body.cliPresent);
			setNamespaceSlug(body.namespaceSlug);
			setMe(body.me);
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : "Traces status failed");
		}
		setLoading(false);
	}

	useEffect(() => {
		void refresh();
	}, [enabled]);

	async function connect() {
		setConnecting(true);
		setError(null);
		try {
			const start = await startTracesConnect();
			setVerificationUrl(start.verificationUrl);
			window.open(start.verificationUrl, "_blank", "noopener,noreferrer");
			const deadline = Date.now() + start.expiresIn * 1000;
			while (Date.now() < deadline) {
				await new Promise((r) => setTimeout(r, Math.max(start.pollInterval, 2) * 1000));
				const poll = await pollTracesConnect(start.state);
				if (poll.status === "pending") continue;
				if (poll.status === "error") throw new Error(poll.error);
				setMe(poll.account);
				setVerificationUrl(null);
				setConnecting(false);
				return;
			}
			throw new Error("Traces login timed out");
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : "Traces connect failed");
			setConnecting(false);
		}
	}

	async function disconnect() {
		setError(null);
		try {
			await disconnectTraces();
			setMe(null);
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : "Disconnect failed");
		}
	}

	return (
		<SettingsSection className="flex flex-col gap-3 border-0 bg-panel p-4">
			<div>
				<div className="text-item-title font-medium text-fg">Your Traces identity</div>
				<p className="m-0 mt-0.5 text-supporting text-dim">
					Connect the GitHub account you use on traces.com. Interactive sessions you own
					are published as you, not as a shared bot. Automations are never uploaded.
				</p>
			</div>
			{loading ? <LoadingState>Checking Traces</LoadingState> : null}
			{error ? <InlineAlert>{error}</InlineAlert> : null}
			{!cliPresent ? (
				<InlineAlert>
					The traces CLI is not on this server&apos;s PATH. Install it for the Open Session
					service user so sessions can be uploaded.
				</InlineAlert>
			) : null}
			{namespaceSlug ? (
				<p className="m-0 text-supporting text-dim">Publishing into @{namespaceSlug}.</p>
			) : null}
			{me ? (
				<div className="flex items-center justify-between gap-3">
					<p className="m-0 text-sm text-fg">
						Connected as <strong>{me.displayName}</strong>
						{me.namespaceSlug ? ` · @${me.namespaceSlug}` : ""}
					</p>
					<Button size="sm" variant="ghost" onClick={() => void disconnect()}>
						Disconnect
					</Button>
				</div>
			) : (
				<div className="flex flex-col items-start gap-2">
					<Button size="sm" disabled={connecting} onClick={() => void connect()}>
						{connecting ? "Waiting for GitHub…" : "Connect Traces"}
					</Button>
					{verificationUrl ? (
						<p className="m-0 text-supporting text-dim">
							Authorize at{" "}
							<a href={verificationUrl} target="_blank" rel="noreferrer">
								{verificationUrl}
							</a>
						</p>
					) : null}
				</div>
			)}
		</SettingsSection>
	);
}
