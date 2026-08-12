import React, { useEffect, useState } from "react";
import { fetchShippedChangeChannels } from "../lib/api/shipped-changes";
import { Button } from "../ui/button";
import { Input, Select } from "../ui/input";
import { BrandMark } from "./BrandMark";

export interface ShippedChangeComposerProps {
	sessionId: string;
	defaultMessage: string;
	status: "idle" | "sharing" | "shared";
	onShare: (message: string, channel: string) => void;
}

export function ShippedChangeComposer({
	sessionId,
	defaultMessage,
	status,
	onShare,
}: ShippedChangeComposerProps) {
	const [message, setMessage] = useState(defaultMessage);
	const [channels, setChannels] = useState<Array<{ id: string; name: string }>>([]);
	const [channel, setChannel] = useState("");

	useEffect(() => setMessage(defaultMessage), [defaultMessage, sessionId]);
	useEffect(() => {
		let current = true;
		fetchShippedChangeChannels(sessionId)
			.then((result) => {
				if (!current) return;
				setChannels(result.channels);
				setChannel(
					result.channels.some((candidate) => candidate.id === result.defaultChannel)
						? result.defaultChannel!
						: result.channels[0]?.id || "",
				);
			})
			.catch(() => {
				if (current) setChannels([]);
			});
		return () => {
			current = false;
		};
	}, [sessionId]);

	return (
		<div className="mx-auto mb-6 -mt-2 w-full max-w-[var(--session-col)] rounded-lg border border-line bg-panel p-3 smooth-shadow-sm">
			<div className="mb-2 flex items-center gap-2 text-label font-medium text-fg">
				<BrandMark name="slack" size={16} />
				Share what shipped
			</div>
			<Input
				aria-label="Slack message"
				value={message}
				maxLength={500}
				disabled={status !== "idle"}
				onChange={(event) => setMessage(event.target.value)}
				onKeyDown={(event) => {
					if (event.key === "Enter" && message.trim() && channel && status === "idle") {
						event.preventDefault();
						onShare(message.trim(), channel);
					}
				}}
			/>
			<div className="mt-2 flex items-center gap-2 phone:flex-col phone:items-stretch">
				<label className="flex min-w-0 flex-1 items-center gap-2 text-meta text-dim">
					<span className="shrink-0">Send to</span>
					<Select
						size="sm"
						aria-label="Slack channel"
						value={channel}
						disabled={status !== "idle" || channels.length === 0}
						onChange={(event) => setChannel(event.target.value)}
					>
						{channels.length === 0 && <option value="">No channels available</option>}
						{channels.map((candidate) => (
							<option key={candidate.id} value={candidate.id}>
								#{candidate.name}
							</option>
						))}
					</Select>
				</label>
				<Button
					size="sm"
					icon={<BrandMark name="slack" size={14} />}
					className="[&>span:first-child]:opacity-100"
					disabled={status !== "idle" || !message.trim() || !channel}
					onClick={() => onShare(message.trim(), channel)}
				>
					{status === "sharing"
						? "Sending…"
						: status === "shared"
							? "Sent to Slack"
							: "Send to Slack"}
				</Button>
			</div>
		</div>
	);
}
