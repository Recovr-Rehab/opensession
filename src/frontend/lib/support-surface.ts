/**
 * Where the Plain queue lives: the band at the bottom of the sidebar, the
 * Support tool's own page, both, or neither.
 *
 * The two surfaces answer the same question differently. The band opens a
 * ticket's WORKSPACE, so the answer arrives with a session, a tab strip and a
 * transcript around it; the tool opens the TICKET, with the queue beside it and
 * no chat. Which one someone wants is a preference, not a pair of unrelated
 * visibility toggles, so this reads and writes it as one choice.
 *
 * It deliberately stores nothing of its own. Both halves already have a
 * per-user, cross-device preference — the hidden-tools list (sidebar-tools.ts)
 * and the hidden-sources list (sidebar-feeds.ts) — and a third key holding the
 * same fact would be one more thing to keep in step, and would fight the
 * per-tool and per-source ticks in the sidebar's own menu. So the choice is
 * derived from those two, and setting it writes both.
 */

import { setSidebarFeedVisible } from "./sidebar-feeds";
import { setSidebarToolVisible } from "./sidebar-tools";

/** The Plain feed's id, which is also the Support tool's id: one queue, and
 *  the two surfaces are keyed to it on either side. */
export const PLAIN_ID = "plain";

export type SupportSurface = "sidebar" | "page" | "both" | "off";

export const SUPPORT_SURFACE_OPTIONS: { value: SupportSurface; label: string }[] =
	[
		{ value: "sidebar", label: "In the sidebar" },
		{ value: "page", label: "Its own page" },
		{ value: "both", label: "Both" },
		{ value: "off", label: "Off" },
	];

/** Which surfaces are on, as one choice. */
export function supportSurfaceOf(
	toolShown: boolean,
	bandShown: boolean,
): SupportSurface {
	if (toolShown && bandShown) return "both";
	if (toolShown) return "page";
	if (bandShown) return "sidebar";
	return "off";
}

export function setSupportSurface(surface: SupportSurface) {
	setSidebarToolVisible(PLAIN_ID, surface === "page" || surface === "both");
	setSidebarFeedVisible(PLAIN_ID, surface === "sidebar" || surface === "both");
}
