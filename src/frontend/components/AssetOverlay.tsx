/**
 * One scratch asset, opened on top of the conversation it was announced in.
 *
 * A modal rather than a view-tab: an artifact is something you glance at and
 * dismiss — a chart, a report, a demo page — and sending a reader to a tab
 * costs them their place in the transcript and leaves a tab to clean up
 * afterwards. Escape or the backdrop puts the conversation back exactly as it
 * was. The Assets tab is still the place to browse the whole folder; this is
 * the way into ONE file from the row that named it.
 *
 * The preview itself is `AssetPreview` (AssetsPanel), so a file looks and
 * behaves the same from either side, HTML's relative references included.
 */

import React from "react";
import {
	sessionAssetDownloadUrl,
	sessionAssetPreviewUrl,
	type SessionAssetFile,
} from "../lib/api";
import type { NewSessionPrefill } from "../lib/new-session-link";
import { Modal, useEnterOnMount } from "../ui/modal";
import { AssetPreview } from "./AssetsPanel";

function fmtSize(n: number): string {
	if (n < 1024) return `${n} B`;
	if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
	return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function AssetOverlay({
	sessionId,
	files,
	path,
	onClose,
	onOpenNewSession,
}: {
	sessionId: string;
	/** The session's assets listing, for the file's size and mtime. */
	files: SessionAssetFile[];
	path: string;
	onClose: () => void;
	onOpenNewSession: (prefill: NewSessionPrefill) => void;
}) {
	const open = useEnterOnMount();
	// Close, not the first link: Base UI focuses the first tabbable otherwise,
	// and a ring around "Open in new tab" reads as if the overlay were pointing
	// somewhere else.
	const closeRef = React.useRef<HTMLButtonElement>(null);
	// A file the listing hasn't caught up with yet still opens: the row that
	// named it knows the path, which is all the preview needs — waiting on a
	// directory listing would be a spinner for nothing.
	const file: SessionAssetFile = files.find((f) => f.path === path) ?? {
		path,
		size: 0,
		mtime: "",
	};
	const name = path.slice(path.lastIndexOf("/") + 1);

	return (
		<Modal.Root
			open={open}
			onOpenChange={(next) => {
				if (!next) onClose();
			}}
		>
			<Modal.Content
				// Nearly the whole window: an artifact is usually a page or a chart,
				// and the point of opening it is to read it, not to peer at it.
				widthClassName="w-[min(1180px,94vw)] max-w-none"
				// `overflow-y-hidden` as well as `overflow-hidden`: the centered
				// shell sets overflow-y itself, and the two are different
				// properties, so without this the dialog grows a second scrollbar
				// beside the previewed page's own.
				className="h-[88dvh] max-h-[88dvh] gap-0 overflow-hidden overflow-y-hidden p-0"
				initialFocus={closeRef}
				aria-label={`Asset ${path}`}
			>
				<div className="flex shrink-0 items-center gap-2 border-b border-line px-3 py-2">
					<Modal.Title
						className="m-0 min-w-0 flex-1 truncate text-label font-medium text-fg"
						title={path}
					>
						{name}
					</Modal.Title>
					{file.size > 0 && (
						<span className="shrink-0 text-[11px] text-faint">
							{fmtSize(file.size)}
						</span>
					)}
					<a
						className="shrink-0 rounded-sm px-1.5 py-0.5 text-[11px] text-dim hover:bg-hover hover:text-fg"
						href={sessionAssetPreviewUrl(sessionId, file)}
						target="_blank"
						rel="noreferrer"
					>
						Open in new tab
					</a>
					<a
						className="shrink-0 rounded-sm px-1.5 py-0.5 text-[11px] text-dim hover:bg-hover hover:text-fg"
						href={sessionAssetDownloadUrl(sessionId, file)}
					>
						Download
					</a>
					<Modal.Close
						ref={closeRef}
						aria-label="Close"
						className="shrink-0 rounded-sm border-0 bg-transparent px-1.5 py-0.5 text-[11px] font-medium text-dim outline-none transition-colors hover:bg-hover hover:text-fg focus-visible:bg-hover focus-visible:text-fg"
					>
						Close
					</Modal.Close>
				</div>
				{/* The preview fills what's left and scrolls inside it — a tall page
				    or a long log is the normal case, not the exception. */}
				<div className="flex min-h-0 flex-1 flex-col">
					<AssetPreview
						sessionId={sessionId}
						file={file}
						onOpenNewSession={(prefill) => {
							onClose();
							onOpenNewSession(prefill);
						}}
					/>
				</div>
			</Modal.Content>
		</Modal.Root>
	);
}
