import { useCallback, useEffect, useState } from "react";
import { fetchWaitlist, type WaitlistEntryDto } from "../../lib/api";
import { fullTime } from "../../lib/time";
import { Button } from "../../ui/button";
import {
	SettingCard,
	SettingCardSkeleton,
	SettingRow,
	SettingRowDescription,
	SettingRowText,
	SettingRowTitle,
	SettingsGroupLabel,
	SettingsHeader,
	SettingsPanel,
} from "../../ui/settings";
import { EmptyState, InlineAlert } from "../../ui/state";
import { toast } from "../../ui/toast";

export function WaitlistPanel() {
	const [entries, setEntries] = useState<WaitlistEntryDto[] | null>(null);
	const [slackChannel, setSlackChannel] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);

	const load = useCallback(() => {
		setError(null);
		fetchWaitlist()
			.then((result) => {
				setEntries(result.entries);
				setSlackChannel(result.slackChannel);
			})
			.catch((cause) => setError(cause.message));
	}, []);
	useEffect(load, [load]);

	const copyEmails = async () => {
		if (!entries?.length) return;
		try {
			await navigator.clipboard.writeText(
				entries.map((entry) => entry.email).join("\n"),
			);
			toast("Emails copied", { variant: "success" });
		} catch {
			toast("Could not copy the emails", { variant: "error" });
		}
	};

	const header = (
		<SettingsHeader
			title="Waitlist"
			description={
				slackChannel
					? `Website requests appear here and in #${slackChannel}.`
					: "Website requests appear here."
			}
			actions={
				entries?.length ? (
					<Button className="max-sm:hidden" size="sm" onClick={() => void copyEmails()}>
						Copy emails
					</Button>
				) : undefined
			}
		/>
	);

	if (!entries) {
		return (
			<SettingsPanel>
				{header}
				{error ? (
					<InlineAlert>{error}</InlineAlert>
				) : (
					<SettingCardSkeleton rows={3} label="Loading waitlist" />
				)}
			</SettingsPanel>
		);
	}

	return (
		<SettingsPanel>
			{header}
			{error && <InlineAlert onDismiss={() => setError(null)}>{error}</InlineAlert>}
			<SettingsGroupLabel
				actions={
					entries.length ? (
						<Button
							className="min-h-10 sm:hidden"
							size="md"
							onClick={() => void copyEmails()}
						>
							Copy emails
						</Button>
					) : undefined
				}
			>
				{entries.length} {entries.length === 1 ? "request" : "requests"}
			</SettingsGroupLabel>
			{entries.length === 0 ? (
				<EmptyState placement="card">
					No requests yet. New website signups will appear here.
				</EmptyState>
			) : (
				<SettingCard>
					{entries.map((entry) => (
						<SettingRow key={`${entry.email}-${entry.createdAt}`}>
							<SettingRowText>
								<SettingRowTitle>
									<a className="select-text hover:underline" href={`mailto:${entry.email}`}>
										{entry.email}
									</a>
								</SettingRowTitle>
								<SettingRowDescription>
									{fullTime(entry.createdAt)}
								</SettingRowDescription>
							</SettingRowText>
						</SettingRow>
					))}
				</SettingCard>
			)}
		</SettingsPanel>
	);
}
