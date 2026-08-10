/**
 * One scratch asset: how it renders, what you can do to it, and the overlay
 * that lifts it over the conversation.
 *
 * A file an agent wrote is reachable from three places — the chip on the turn
 * that wrote it, the Info panel's list, and the Assets tab — and all three
 * come through here, so the file can't look or behave like three different
 * things depending on where you clicked.
 *
 * The overlay is the default way in: an artifact is something you glance at
 * mid-conversation, and an overlay costs nothing to dismiss. The Assets tab
 * stays for when you mean to sit with it — "Open as tab" in the header is the
 * promotion, and the way into the folder around the file.
 */

import React, { useEffect, useState } from "react";
import { marked } from "marked";
import {
	deleteSessionAssetApi,
	sessionAssetDownloadUrl,
	sessionAssetPreviewUrl,
	sessionAssetRawUrl,
	type SessionAssetFile,
} from "../lib/api";
import {
	ASSET_TEXT_CAP,
	adjacentAssetPath,
	assetFileFor,
	assetPreviewKind,
	formatAssetSize,
} from "../lib/asset-preview";
import {
	parseNewSessionLink,
	type NewSessionPrefill,
} from "../lib/new-session-link";
import { absoluteLink, copyToClipboard } from "../lib/share-link";
import { useIsPhone } from "../hooks/useIsPhone";
import { Button } from "../ui/button";
import { cn } from "../ui/cn";
import { Menu } from "../ui/menu";
import { ResponsiveDialog } from "../ui/sheet";
import { toast } from "../ui/toast";
import { Tooltip } from "../ui/tooltip";
import { MarkdownBody } from "./MarkdownBody";
import { IconDotsHorizontal, IconX } from "./icons";

/**
 * The asset's name and everything you can do to it, in one row.
 *
 * The promotion into a tab earns a place on the surface. File operations
 * live behind the overflow, because a header of six
 * peer-looking text links makes the destructive one exactly as easy to hit as
 * the harmless ones. Omit `onOpenAsTab` where the tab IS the surface.
 */
export function AssetActions({
	sessionId,
	file,
	refresh,
	onOpenAsTab,
	onClose,
	showSize = false,
	className,
}: {
	sessionId: string;
	file: SessionAssetFile;
	/** Re-list the folder after a delete. */
	refresh?: () => void;
	/** Promote this file into the workspace's Assets tab. */
	onOpenAsTab?: () => void;
	/** Dismiss the surface — the overlay's ✕. Also called after a delete, since
	 *  there is nothing left to show. */
	onClose?: () => void;
	/** False for a chip path whose folder listing has not caught up yet. */
	showSize?: boolean;
	className?: string;
}) {
	const rawUrl = sessionAssetPreviewUrl(sessionId, file);
	const stableUrl = sessionAssetRawUrl(sessionId, file.path);
	const name = file.path.split("/").pop() || file.path;
	const folder = file.path.includes("/")
		? file.path.slice(0, file.path.lastIndexOf("/"))
		: null;

	async function onDelete() {
		if (!confirm(`Delete ${file.path}?`)) return;
		try {
			await deleteSessionAssetApi(sessionId, file.path);
			refresh?.();
			onClose?.();
		} catch {
			toast("Could not delete that file");
		}
	}

	return (
		<div
			className={cn(
				"flex shrink-0 items-center gap-2 border-b border-line px-3 py-2",
				className,
			)}
		>
			<div className="min-w-0 flex-1" title={file.path}>
				<div className="truncate text-label font-medium text-fg">{name}</div>
				{folder && (
					<div className="truncate text-[11px] text-faint">{folder}</div>
				)}
			</div>
			{showSize && (
				<span className="shrink-0 text-[11px] text-faint">
					{formatAssetSize(file.size)}
				</span>
			)}
			{onOpenAsTab && (
				<Tooltip label="Open in Assets">
					<Button
						variant="ghost"
						size="xs"
						className="shrink-0"
						onClick={onOpenAsTab}
					>
						Open as tab
					</Button>
				</Tooltip>
			)}
			<Menu.Root>
				<Menu.Trigger
					aria-label="Asset actions"
					className="flex size-7 shrink-0 items-center justify-center rounded-control border-0 bg-transparent text-dim hover:bg-hover hover:text-fg data-[popup-open]:bg-hover data-[popup-open]:text-fg"
				>
					<IconDotsHorizontal size={16} />
				</Menu.Trigger>
				<Menu.Popup align="end">
					<Menu.Item
						render={
							<a href={sessionAssetDownloadUrl(sessionId, file)} download />
						}
					>
						Download
					</Menu.Item>
					<Menu.Item
						render={<a href={rawUrl} target="_blank" rel="noreferrer" />}
					>
						Open in a browser tab
					</Menu.Item>
					<Menu.Item
						onClick={() =>
							copyToClipboard(absoluteLink(stableUrl), () =>
								toast("Link copied"),
							)
						}
					>
						Copy link
					</Menu.Item>
					<Menu.Separator />
					<Menu.Item onClick={onDelete} className="text-red">
						Delete
					</Menu.Item>
				</Menu.Popup>
			</Menu.Root>
			{onClose && (
				<Button
					variant="ghost"
					size="xs"
					aria-label="Close"
					className="size-7 shrink-0 justify-center px-0"
					onClick={onClose}
				>
					<IconX size={16} />
				</Button>
			)}
		</div>
	);
}

/**
 * The file itself. HTML goes in an iframe served from the path-based raw
 * route, so a multi-file artifact's relative references (./style.css,
 * ./data.json) resolve to its siblings.
 */
export function AssetPreview({
	sessionId,
	file,
	onOpenNewSession,
	className,
}: {
	sessionId: string;
	file: SessionAssetFile;
	/** A link inside an HTML asset that spells out a new session — the artifact
	 *  can hand work back to the app it was written in. */
	onOpenNewSession: (prefill: NewSessionPrefill) => void;
	className?: string;
}) {
	const kind = assetPreviewKind(file.path);
	const rawUrl = sessionAssetPreviewUrl(sessionId, file);

	// Text-ish previews fetch the body themselves.
	const [text, setText] = useState<string | null>(null);
	const [textFailed, setTextFailed] = useState(false);
	useEffect(() => {
		setText(null);
		setTextFailed(false);
		if (kind !== "text" && kind !== "markdown") return;
		let alive = true;
		fetch(rawUrl)
			.then((r) => (r.ok ? r.text() : Promise.reject(r.status)))
			.then((t) => {
				if (alive) setText(t.length > ASSET_TEXT_CAP ? t.slice(0, ASSET_TEXT_CAP) : t);
			})
			.catch(() => {
				if (alive) setTextFailed(true);
			});
		return () => {
			alive = false;
		};
	}, [rawUrl, kind]);

	return (
		<div className={cn("min-h-0 flex-1 overflow-auto", className)}>
			{kind === "html" ? (
				// allow-same-origin so the page can fetch() sibling assets
				// (./data.json); the sandbox still blocks top navigation. The
				// content is our own agents' output on a tailnet-only UI.
				<iframe
					key={rawUrl}
					title={file.path}
					src={rawUrl}
					sandbox="allow-scripts allow-same-origin allow-popups allow-forms allow-modals allow-downloads"
					onLoad={(event) => {
						const document = event.currentTarget.contentDocument;
						if (!document) return;
						document.addEventListener("click", (clickEvent) => {
							const link = (clickEvent.target as Element | null)?.closest?.("a");
							const prefill = link ? parseNewSessionLink(link.href) : null;
							if (!prefill) return;
							clickEvent.preventDefault();
							onOpenNewSession(prefill);
						});
					}}
					className="h-full w-full border-0 bg-white"
				/>
			) : kind === "pdf" ? (
				// No sandbox: Chrome's built-in PDF viewer won't render in a
				// sandboxed iframe.
				<iframe
					key={rawUrl}
					title={file.path}
					src={rawUrl}
					className="h-full w-full border-0"
				/>
			) : kind === "image" ? (
				<div className="flex h-full items-center justify-center overflow-auto p-3">
					<img
						src={rawUrl}
						alt={file.path}
						className="max-h-full max-w-full object-contain"
					/>
				</div>
			) : kind === "video" ? (
				<video src={rawUrl} controls className="h-full w-full" />
			) : kind === "audio" ? (
				<div className="p-4">
					<audio src={rawUrl} controls className="w-full" />
				</div>
			) : kind === "markdown" ? (
				textFailed ? (
					<div className="p-4 text-label text-faint">Could not load this file.</div>
				) : text === null ? (
					<div className="p-4 text-label text-faint">Loading…</div>
				) : (
					<MarkdownBody
						className="markdown px-4 py-3 text-[13px]"
						html={marked.parse(text, { async: false }) as string}
					/>
				)
			) : kind === "text" ? (
				textFailed ? (
					<div className="p-4 text-label text-faint">Could not load this file.</div>
				) : text === null ? (
					<div className="p-4 text-label text-faint">Loading…</div>
				) : (
					<pre className="whitespace-pre-wrap break-words px-4 py-3 font-mono text-label leading-[1.5] text-fg">
						{text}
						{file.size > ASSET_TEXT_CAP ? "\n… (truncated preview)" : ""}
					</pre>
				)
			) : (
				<div className="flex h-full items-center justify-center text-label text-faint">
					No inline preview for this file type — use Download.
				</div>
			)}
		</div>
	);
}

/**
 * One asset, over the conversation.
 *
 * `path` null means closed; the last file stays rendered while the panel
 * animates away, so a dismissal doesn't blink to an empty box on its way out.
 */
export function AssetOverlay({
	sessionId,
	path,
	files,
	refresh,
	onClose,
	onSelectPath,
	onOpenAsTab,
	onOpenNewSession,
}: {
	sessionId: string;
	path: string | null;
	files: SessionAssetFile[];
	refresh: () => void;
	onClose: () => void;
	/** Show another file in this overlay. */
	onSelectPath: (path: string) => void;
	/** Promote the open file into the Assets tab (and dismiss). */
	onOpenAsTab?: (path: string) => void;
	onOpenNewSession: (prefill: NewSessionPrefill) => void;
}) {
	const isPhone = useIsPhone();
	// Survives `path` going null so the exit animation has something to show.
	// While open, render directly from the controlled path so repeated arrow
	// presses never paint the previous asset for a frame.
	const [lastPath, setLastPath] = useState<string | null>(path);
	const [listedPath, setListedPath] = useState<string | null>(null);
	const [missingPath, setMissingPath] = useState<string | null>(null);
	useEffect(() => {
		if (path) {
			setLastPath(path);
			setMissingPath(null);
		}
	}, [path]);
	useEffect(() => {
		if (!path) return;
		if (files.some((candidate) => candidate.path === path)) {
			setListedPath(path);
			setMissingPath(null);
			return;
		}
		if (listedPath === path) {
			onClose();
			return;
		}
		const timeout = window.setTimeout(() => setMissingPath(path), 1_500);
		return () => window.clearTimeout(timeout);
	}, [path, files, listedPath, onClose]);
	useEffect(() => {
		if (!path || files.length < 2) return;
		const paths = files.map((file) => file.path);
		const onKey = (event: KeyboardEvent) => {
			if (
				event.defaultPrevented ||
				event.altKey ||
				event.ctrlKey ||
				event.metaKey ||
				event.shiftKey ||
				(event.key !== "ArrowLeft" && event.key !== "ArrowRight")
			)
				return;
			// Menus and controls use these keys themselves. Embedded HTML/PDF content
			// lives in its own document and keeps its own keyboard interactions too.
			if (document.querySelector(".app-menu-popup")) return;
			const target = event.target;
			if (
				target instanceof HTMLElement &&
				(target.isContentEditable ||
					Boolean(
						target.closest(
							"input, textarea, select, audio, video, [contenteditable='true']",
						),
					))
			)
				return;
			const next = adjacentAssetPath(
				paths,
				path,
				event.key === "ArrowLeft" ? -1 : 1,
			);
			if (!next) return;
			event.preventDefault();
			event.stopPropagation();
			onSelectPath(next);
		};
		window.addEventListener("keydown", onKey, true);
		return () => window.removeEventListener("keydown", onKey, true);
	}, [path, files, onSelectPath]);
	const shown = path ?? lastPath;
	if (!shown) return null;
	const file = assetFileFor(shown, files);
	const listed = files.some((candidate) => candidate.path === shown);

	return (
		<ResponsiveDialog
			open={Boolean(path)}
			onClose={onClose}
			phone={isPhone}
			label={`Asset: ${file.path}`}
			// The default modal is a 30rem confirm box; an artifact needs the
			// room a page or a chart was drawn for. `max-w-none` first, or the
			// default clamp wins.
			modalClassName="h-[min(860px,88vh)] w-[min(1180px,94vw)] max-w-none"
			sheetClassName="h-[94dvh]"
		>
			<AssetActions
				sessionId={sessionId}
				file={file}
				refresh={refresh}
				onOpenAsTab={onOpenAsTab ? () => onOpenAsTab(file.path) : undefined}
				onClose={onClose}
				showSize={listed}
			/>
			{missingPath === file.path ? (
				<div className="flex min-h-0 flex-1 items-center justify-center px-6 text-center text-label text-faint">
					This file is no longer available.
				</div>
			) : (
				<AssetPreview
					sessionId={sessionId}
					file={file}
					onOpenNewSession={(prefill) => {
						onClose();
						onOpenNewSession(prefill);
					}}
				/>
			)}
		</ResponsiveDialog>
	);
}
