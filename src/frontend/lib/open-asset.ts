import { createContext, useContext } from "react";
import {
	assetToolPath,
	parseMcpTool,
} from "@tellahq/opensession-protocol/tool-presentation";
import type { TranscriptEntry } from "./types";

/**
 * Opens one of the session's scratch assets — the transcript's own way into an
 * artifact, so a report or a visualization can be looked at from the turn that
 * produced it instead of hunted for in a tab you have to know exists.
 *
 * Context rather than a prop because the callers are a tool row and a turn
 * footer, both several memoized layers below the session view. Null where
 * there is no session view to open over (the Desk overlay, a sub-agent pane) —
 * and a caller then draws no affordance at all, because a chip that does
 * nothing is worse than no chip.
 */
const OpenAssetContext = createContext<((path: string) => void) | null>(null);
export const OpenAssetProvider = OpenAssetContext.Provider;

/**
 * How a transcript surface opens a scratch file. `available` is false where
 * there is no session overlay to host it, so the surface can leave the
 * affordance out entirely.
 */
export function useOpenAsset(): {
	available: boolean;
	open: (path: string) => void;
} {
	const openInOverlay = useContext(OpenAssetContext);
	return {
		available: Boolean(openInOverlay),
		open(path) {
			openInOverlay?.(path);
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
