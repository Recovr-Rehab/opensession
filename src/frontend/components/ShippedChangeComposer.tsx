import React, { useEffect, useRef, useState } from "react";
import { fetchShippedChangeChannels } from "../lib/api/shipped-changes";
import { imageFilesFromPaste, uploadFile } from "../lib/images";
import { Button } from "../ui/button";
import { Select } from "../ui/input";
import { toast } from "../ui/toast";
import { BrandMark } from "./BrandMark";
import { openLightbox } from "./MediaLightbox";
import { IconCamera, IconPlus, IconX } from "./icons";
import { PixelSpinner } from "./PixelSpinner";

const MAX_SLACK_IMAGE_BYTES = 20 * 1024 * 1024;

export interface ShippedChangeComposerProps {
	sessionId: string;
	defaultMessage: string;
	screenshot?: string;
	requestingScreenshot?: boolean;
	reconnectRequired?: boolean;
	status: "idle" | "sharing";
	onShare: (message: string, channel: string, screenshots: string[]) => void;
	onRequestScreenshot?: () => void;
	onReconnectSlack?: () => void;
}

export function ShippedChangeComposer({
	sessionId,
	defaultMessage,
	screenshot,
	requestingScreenshot = false,
	reconnectRequired = false,
	status,
	onShare,
	onRequestScreenshot,
	onReconnectSlack,
}: ShippedChangeComposerProps) {
	const [message, setMessage] = useState(defaultMessage);
	const [channels, setChannels] = useState<Array<{ id: string; name: string }>>([]);
	const [channel, setChannel] = useState("");
	const [screenshots, setScreenshots] = useState<string[]>(() => screenshot ? [screenshot] : []);
	const [uploading, setUploading] = useState(false);
	const [canUploadImages, setCanUploadImages] = useState(true);
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
				setCanUploadImages(result.canUploadImages !== false);
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
		const candidates = files.filter((file) => file.type.startsWith("image/"));
		const oversized = candidates.find((file) => file.size > MAX_SLACK_IMAGE_BYTES);
		if (oversized) {
			toast(`${oversized.name} is larger than Slack's 20 MB image limit`, {
				variant: "error",
			});
		}
		const images = candidates
			.filter((file) => file.size <= MAX_SLACK_IMAGE_BYTES)
			.slice(0, 10 - screenshots.length);
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
		<div className="mx-auto mt-2 mb-6 w-full max-w-[var(--session-col)]">
			<div className="mb-2 flex items-center gap-1.5 px-1 text-label leading-5 text-dim">
				<BrandMark name="slack" size={12} />
				<span className="font-semibold">Send to Slack</span>
			</div>
			<div
				className="rounded-[var(--composer-radius)] border border-[color:var(--composer-border)] bg-[var(--composer-surface)] px-3.5 pt-3.5 pb-2.5 shadow-[var(--composer-shadow)] transition-[border-color,box-shadow] focus-within:border-accent desktop:border-transparent desktop:[--smooth-ring-color:var(--composer-border)] desktop:smooth-shadow-ring-soft phone:px-3 phone:pt-3 phone:pb-2"
				onDragOver={(event) => event.preventDefault()}
				onDrop={(event) => {
					event.preventDefault();
					if (status === "idle") void addImages(Array.from(event.dataTransfer.files));
				}}
			>
				<textarea
					className="block min-h-14 max-h-32 w-full resize-none border-0 bg-transparent p-0 text-body leading-[1.55] text-fg outline-none [field-sizing:content] placeholder:text-faint phone:text-[16px]"
					aria-label="Slack message"
					value={message}
					maxLength={500}
					disabled={status !== "idle"}
					onChange={(event) => setMessage(event.target.value)}
					onPaste={(event) => {
						const files = imageFilesFromPaste(event);
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
									<img className="h-16 w-24 rounded-md border border-line-strong object-cover object-top" src={mediaUrl(path)} alt="" />
								</button>
								<button type="button" aria-label="Remove screenshot" disabled={status !== "idle"} className="absolute -top-1.5 -right-1.5 grid size-[18px] place-items-center rounded-full bg-fg text-panel disabled:opacity-50" onClick={() => setScreenshots((current) => current.filter((_, i) => i !== index))}>
									<IconX size={12} />
								</button>
							</div>
						))}
					</div>
				)}
				<div className="mt-2.5 flex items-center gap-1.5 phone:mt-2">
					<input ref={fileInputRef} className="sr-only" type="file" accept="image/*" multiple onChange={(event) => { void addImages(Array.from(event.target.files || [])); event.currentTarget.value = ""; }} />
					<button type="button" aria-label="Add images" title="Add images" className="focus-ring inline-flex size-8 shrink-0 items-center justify-center rounded-control text-dim transition-[background-color,color,scale] hover:bg-hover hover:text-fg active:scale-[0.96] disabled:opacity-40 phone:size-10" disabled={status !== "idle" || uploading || screenshots.length >= 10} onClick={() => fileInputRef.current?.click()}>
						{uploading ? <PixelSpinner /> : <IconPlus size={20} />}
					</button>
					{onRequestScreenshot && (
						<button type="button" aria-label={requestingScreenshot ? "Capturing screenshot" : "Capture screenshot"} title={requestingScreenshot ? "Capturing screenshot" : "Capture screenshot"} className="focus-ring inline-flex size-8 shrink-0 items-center justify-center rounded-control text-dim transition-[background-color,color,scale] hover:bg-hover hover:text-fg active:scale-[0.96] disabled:opacity-40 phone:size-10" disabled={status !== "idle" || requestingScreenshot} onClick={onRequestScreenshot}>
							{requestingScreenshot ? <PixelSpinner /> : <IconCamera size={18} />}
						</button>
					)}
					<div className="flex-1" />
					<label className="flex items-center">
						<span className="sr-only">Send to</span>
						<Select size="sm" className="w-24 border-transparent bg-transparent text-dim shadow-none hover:bg-hover phone:w-20" aria-label="Slack channel" value={channel} disabled={status !== "idle" || channels.length === 0} onChange={(event) => setChannel(event.target.value)}>
							{channels.length === 0 && <option value="">No channels available</option>}
							{channels.map((candidate) => (
								<option key={candidate.id} value={candidate.id}>#{candidate.name}</option>
							))}
						</Select>
					</label>
					<Button size="sm" icon={<BrandMark name="slack" size={10} />} disabled={status !== "idle" || (!(reconnectRequired || (!canUploadImages && screenshots.length > 0)) && (!message.trim() || !channel || uploading))} onClick={() => reconnectRequired || (!canUploadImages && screenshots.length > 0) ? onReconnectSlack?.() : onShare(message.trim(), channel, screenshots)}>
						{reconnectRequired || (!canUploadImages && screenshots.length > 0) ? "Reconnect" : status === "sharing" ? "Sending…" : "Send"}
					</Button>
				</div>
			</div>
		</div>
	);
}
