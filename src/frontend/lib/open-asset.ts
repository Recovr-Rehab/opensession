import { createContext, useContext } from "react";
import {
	assetToolPath,
	parseMcpTool,
} from "@tellahq/opensession-protocol/tool-presentation";
import { openLightbox } from "../components/MediaLightbox";
import { sessionAssetRawUrl } from "./api";
import type { TranscriptEntry } from "./types";

/**
 * Opens one of the session's scratch assets — the transcript's own way into an
 * artifact, so a report or a visualization can be looked at from the turn that
 * produced it instead of hunted for in a tab you have to know exists.
 *
 * Context rather than a prop because the callers are a tool row and a turn
 * footer, both several memoized layers below the session view. Null where
 * there is no tab to open into (the Desk overlay, a sub-agent pane) — and a
 * caller then draws no affordance at all, because a chip that does nothing is
 * worse than no chip.
 */
const OpenAssetContext = createContext<((path: string) => void) | null>(null);
export const OpenAssetProvider = OpenAssetContext.Provider;

/**
 * Assets that read better lifted over the conversation than opened beside it:
 * a picture or a clip is a glance, and the lightbox is already where every
 * other image in a transcript opens. Everything else — a report, a page, a
 * log — is something you read, and goes to the Assets tab, where an HTML
 * artifact's relative references resolve and the folder is there to browse.
 * SVG is deliberately not here: an animated or scripted one needs the frame.
 */
export function assetMediaKind(path: string): "image" | "video" | null {
	const ext = path.slice(path.lastIndexOf(".") + 1).toLowerCase();
	if (["png", "jpg", "jpeg", "gif", "webp", "ico"].includes(ext)) return "image";
	if (["mp4", "webm", "mov"].includes(ext)) return "video";
	return null;
}

/**
 * How a transcript surface opens a scratch file. `available` is false where
 * nothing can be opened — no Assets tab to land in, or no session to resolve
 * the path against — so the surface can leave the affordance out entirely.
 */
export function useOpenAsset(sessionId?: string): {
	available: boolean;
	open: (path: string, origin?: HTMLElement | null) => void;
} {
	const openInTab = useContext(OpenAssetContext);
	return {
		available: Boolean(openInTab),
		open(path, origin) {
			const kind = assetMediaKind(path);
			if (kind && sessionId) {
				openLightbox(
					[{ kind, src: sessionAssetRawUrl(sessionId, path) }],
					0,
					origin,
				);
				return;
			}
			openInTab?.(path);
		},
	};
}

/**
 * The scratch files a turn wrote, in first-write order. Only writes: a read or
 * a delete names a path too, but the footer chips what the turn *produced* —
 * and a delete leaves nothing to open.
 */
export function collectWrittenAssets(items: TranscriptEntry[]): string[] {
	const seen = new Set<string>();
	for (const item of items) {
		if (item.type !== "tool_use" || !item.toolName) continue;
		if (parseMcpTool(item.toolName)?.tool !== "write_asset") continue;
		const path = assetToolPath(item.toolName, item.toolInput);
		if (path) seen.add(path);
	}
	return [...seen];
}
