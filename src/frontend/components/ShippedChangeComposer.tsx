import React, { useEffect, useRef, useState } from "react";
import { fetchShippedChangeChannels } from "../lib/api/shipped-changes";
import { uploadFile } from "../lib/images";
import { Button } from "../ui/button";
import { Select } from "../ui/input";
import { toast } from "../ui/toast";
import { BrandMark } from "./BrandMark";
import { openLightbox } from "./MediaLightbox";
import { IconCamera, IconPlus } from "./icons";
import { PixelSpinner } from "./PixelSpinner";

export interface ShippedChangeComposerProps {
	sessionId: string;
	defaultMessage: string;
	screenshot?: string;
	requestingScreenshot?: boolean;
	status: "idle" | "sharing" | "shared";
	onShare: (message: string, channel: string, screenshots: string[]) => void;
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
	const [screenshots, setScreenshots] = useState<string[]>(() => screenshot ? [screenshot] : []);
	const [uploading, setUploading] = useState(false);
	const fileInputRef = useRef<HTMLInputElement>(null);
	const sessionRef = useRef(sessionId);

	useEffect(() => {
		setMessage(defaultMessage);
		if (sessionRef.current !== sessionId) {
			sessionRef.current = sessionId;
			setScreenshots(screenshot ? [screenshot] : []);
		}
	}, [defaultMessage, screenshot, sessionId]);
	useEffect(() => {
		setScreenshots((current) => screenshot && !current.includes(screenshot)
			? [screenshot, ...current]
			: current);
	}, [screenshot]);
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
	const addImages = async (files: File[]) => {
		const images = files.filter((file) => file.type.startsWith("image/")).slice(0, 10 - screenshots.length);
		if (!images.length) return;
		setUploading(true);
		try {
			const uploaded = await Promise.all(images.map((file) => uploadFile(file)));
			setScreenshots((current) => [...new Set([
				...current,
				...uploaded.map((file) => file.path),
			])].slice(0, 10));
		} catch (error) {
			toast(error instanceof Error ? error.message : "Couldn't add that image", {
				variant: "error",
			});
		} finally {
			setUploading(false);
		}
	};
	const mediaUrl = (path: string) => path.startsWith("/media?")
		? path
		: `/media?path=${encodeURIComponent(path)}`;

	return (
		<div className="mx-auto mt-2 mb-6 w-full max-w-[var(--session-col)] rounded-xl border border-line/60 bg-transparent p-3">
			<div className="mb-2.5 flex items-center gap-1.5 text-[14px] leading-5 text-fg">
				<BrandMark name="slack" size={16} />
				<span className="font-semibold">Post what you shipped</span>
			</div>
			<div
				className="rounded-control border border-line/60 bg-surface p-2.5 focus-within:border-accent"
				onDragOver={(event) => event.preventDefault()}
				onDrop={(event) => {
					event.preventDefault();
					if (status === "idle") void addImages(Array.from(event.dataTransfer.files));
				}}
			>
				<textarea
					className="block min-h-12 max-h-32 w-full resize-none border-0 bg-transparent p-0 text-sm leading-5 text-fg outline-none [field-sizing:content] placeholder:text-faint"
					aria-label="Slack message"
					value={message}
					maxLength={500}
					disabled={status !== "idle"}
					onChange={(event) => setMessage(event.target.value)}
					onPaste={(event) => {
						const files = Array.from(event.clipboardData.files);
						if (files.length) {
							event.preventDefault();
							void addImages(files);
						}
					}}
				/>
				{screenshots.length > 0 && (
					<div className="mt-2 flex gap-2 overflow-x-auto pb-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
						{screenshots.map((path, index) => (
							<div key={path} className="relative shrink-0">
								<button type="button" aria-label="Open screenshot preview" className="focus-ring block overflow-hidden rounded-md" onClick={(event) => openLightbox(screenshots.map((item) => ({ kind: "image", src: mediaUrl(item) })), index, event.currentTarget)}>
									<img className="h-24 w-36 rounded-md border border-line-strong object-cover object-top" src={mediaUrl(path)} alt="" />
								</button>
								<button type="button" aria-label="Remove screenshot" disabled={status !== "idle"} className="absolute top-1 right-1 grid size-5 place-items-center rounded-full bg-fg text-xs leading-none text-panel disabled:opacity-50" onClick={() => setScreenshots((current) => current.filter((_, i) => i !== index))}>×</button>
							</div>
						))}
					</div>
				)}
				<div className="mt-2 flex items-center">
					<input ref={fileInputRef} className="sr-only" type="file" accept="image/*" multiple onChange={(event) => { void addImages(Array.from(event.target.files || [])); event.currentTarget.value = ""; }} />
					<Button variant="ghost" size="sm" icon={uploading ? <PixelSpinner /> : <IconPlus size={16} />} disabled={status !== "idle" || uploading || screenshots.length >= 10} onClick={() => fileInputRef.current?.click()}>
						{uploading ? "Adding…" : "Add image"}
					</Button>
				</div>
			</div>
			{screenshots.length === 0 && onRequestScreenshot && (
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
					disabled={status !== "idle" || !message.trim() || !channel || uploading}
					onClick={() => onShare(message.trim(), channel, screenshots)}
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
