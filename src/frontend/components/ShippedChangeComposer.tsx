import React, { useEffect, useState } from "react";
import { fetchShippedChangeChannels } from "../lib/api/shipped-changes";
import { Button } from "../ui/button";
import { Input, Select } from "../ui/input";
import { BrandMark } from "./BrandMark";
import { openLightbox } from "./MediaLightbox";
import { IconCamera } from "./icons";
import { PixelSpinner } from "./PixelSpinner";

export interface ShippedChangeComposerProps {
	sessionId: string;
	defaultMessage: string;
	screenshot?: string;
	requestingScreenshot?: boolean;
	status: "idle" | "sharing" | "shared";
	onShare: (message: string, channel: string) => void;
	onRequestScreenshot?: () => void;
}

export function ShippedChangeComposer({
	sessionId,
	defaultMessage,
	screenshot,
	requestingScreenshot = false,
	status,
	onShare,
	onRequestScreenshot,
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
		<div className="mx-auto mt-2 mb-6 w-full max-w-[var(--session-col)] rounded-xl border border-line/60 bg-transparent p-3">
			<div className="mb-2.5 flex items-center gap-1.5 text-[14px] leading-5 text-fg">
				<BrandMark name="slack" size={16} />
				<span className="font-semibold">Post what you shipped</span>
			</div>
			<Input
				className="border-line/60"
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
			{screenshot && (
				<figure className="mt-2.5 mb-0">
					<figcaption className="mb-1 inline-flex rounded-full bg-blue-soft px-2 py-0.5 text-[11px] leading-4 font-semibold text-blue">
						Screenshot
					</figcaption>
					<button
						type="button"
						className="block aspect-[16/10] w-full cursor-zoom-in overflow-hidden rounded-md border border-line/60 bg-transparent p-0 outline-none focus-visible:shadow-[0_0_0_3px_var(--accent-soft)]"
						onClick={(event) =>
							openLightbox(
								[
									{
										kind: "image",
										src: `/media?path=${encodeURIComponent(screenshot)}`,
										sessionTitle: "Screenshot attached to the Slack update",
									},
								],
								0,
								event.currentTarget,
							)
						}
					>
						<img
							className="h-full w-full object-cover object-top"
							src={`/media?path=${encodeURIComponent(screenshot)}`}
							alt="Screenshot attached to the Slack update"
						/>
					</button>
				</figure>
			)}
			{!screenshot && onRequestScreenshot && (
				<div aria-live="polite" className="mt-2.5 flex min-h-24 flex-col items-center justify-center gap-1.5 rounded-control bg-surface px-3 py-2.5 text-center">
					{requestingScreenshot ? (
						<>
							<PixelSpinner className="text-faint" />
							<div className="text-supporting text-dim">Capturing screenshot…</div>
						</>
					) : (
						<>
							<IconCamera size={20} className="text-faint" />
							<div className="text-supporting text-dim">Add visual proof to this post.</div>
							<Button size="sm" onClick={onRequestScreenshot}>
								Request screenshot
							</Button>
						</>
					)}
				</div>
			)}
			<div className="mt-2.5 flex items-center justify-end gap-2">
				<label className="flex items-center">
					<span className="sr-only">Send to</span>
					<Select
						size="sm"
						className="w-24 border-line/60 phone:w-20"
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
					icon={<BrandMark name="slack" size={12} />}
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
