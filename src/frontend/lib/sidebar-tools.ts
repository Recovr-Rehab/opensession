export const SIDEBAR_TOOL_IDS = [
	"prs",
	"people",
	"tasks",
	"catchup",
	"supporttinder",
	"reports",
	"analytics",
] as const;

export type SidebarToolId = (typeof SIDEBAR_TOOL_IDS)[number];

export const SIDEBAR_TOOL_LABELS: Record<SidebarToolId, string> = {
	prs: "Pull requests",
	people: "People",
	tasks: "Tasks",
	catchup: "Catch up",
	supporttinder: "Support Tinder",
	reports: "Reports",
	analytics: "Analytics",
};

/**
 * `prs` was called `home` until 2026-08-14. There was never a home: the page
 * has always been the pull request list, and the name promised a place the
 * app doesn't have — you go to a tool, not back to a lobby. Stored preferences
 * still carry the old id, so it is read as the new one rather than dropped,
 * which would silently un-hide the tool for anyone who had turned it off.
 */
const RENAMED_TOOL_IDS: Record<string, SidebarToolId> = { home: "prs" };

// The swipe decks are one card at a time, moved on with a thumb. That is the
// wrong shape for a desktop window, which already shows the same unread
// workspaces and waiting tickets as lists you can scan at once, so they are
// offered at phone widths only. Nothing else in the app hides by viewport, so
// the rule lives here rather than in each surface that lists tools.
const PHONE_ONLY_TOOLS: SidebarToolId[] = ["catchup", "supporttinder"];

/** Is this tool offered at the current width? Pull requests is the phone's
 *  root list rather than a tool row, so it drops out there; phone-only tools
 *  drop out everywhere else. */
export function toolFitsViewport(id: SidebarToolId, isPhone: boolean): boolean {
	return isPhone ? id !== "prs" : !PHONE_ONLY_TOOLS.includes(id);
}

const HIDDEN_TOOLS_KEY = "opensession-sidebar-hidden-tools";
const TOOLS_CHANGED_EVENT = "opensession-sidebar-tools-changed";
// A new account starts with the two tools that need nothing set up: Pull
// requests and People. Every other tool is either empty until something else
// exists (Tasks needs todos, Reports needs automations) or needs an
// integration (Support Tinder, Analytics), so shipping them on makes the
// sidebar look busy and broken at once. They're one click away in the Tools
// band's ••• menu and in Settings. Derived from the visible list so a tool
// added later defaults to hidden rather than silently showing up for everyone.
const DEFAULT_VISIBLE_TOOLS: SidebarToolId[] = ["prs", "people"];
const DEFAULT_HIDDEN_TOOLS: SidebarToolId[] = SIDEBAR_TOOL_IDS.filter(
	(id) => !DEFAULT_VISIBLE_TOOLS.includes(id),
);

export function readHiddenSidebarTools(): Set<SidebarToolId> {
	try {
		const value = localStorage.getItem(HIDDEN_TOOLS_KEY);
		if (value === null) return new Set(DEFAULT_HIDDEN_TOOLS);
		const stored = JSON.parse(value);
		if (!Array.isArray(stored)) return new Set();
		return new Set(
			stored
				.map((id) => RENAMED_TOOL_IDS[id] ?? id)
				.filter((id): id is SidebarToolId => SIDEBAR_TOOL_IDS.includes(id)),
		);
	} catch {
		return new Set(DEFAULT_HIDDEN_TOOLS);
	}
}

function writeHiddenSidebarTools(hidden: Set<SidebarToolId>) {
	localStorage.setItem(HIDDEN_TOOLS_KEY, JSON.stringify([...hidden]));
	window.dispatchEvent(new Event(TOOLS_CHANGED_EVENT));
}

export function setSidebarToolVisible(id: SidebarToolId, visible: boolean) {
	const hidden = readHiddenSidebarTools();
	if (visible) hidden.delete(id);
	else hidden.add(id);
	writeHiddenSidebarTools(hidden);
}

export function hideAllSidebarTools() {
	writeHiddenSidebarTools(new Set(SIDEBAR_TOOL_IDS));
}

export function onSidebarToolsChanged(listener: () => void) {
	window.addEventListener(TOOLS_CHANGED_EVENT, listener);
	return () => window.removeEventListener(TOOLS_CHANGED_EVENT, listener);
}
