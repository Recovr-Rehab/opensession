// Feed leads. The tools below it are places you go to act on one kind of
// thing; Feed is what the team has actually been doing, which is the page you
// want in front of you when you have not decided what to work on yet.
export const SIDEBAR_TOOL_IDS = [
	"feed",
	"prs",
	"tasks",
	"catchup",
	"supporttinder",
	"reports",
	"analytics",
] as const;

export type SidebarToolId = (typeof SIDEBAR_TOOL_IDS)[number];

export const SIDEBAR_TOOL_LABELS: Record<SidebarToolId, string> = {
	feed: "Feed",
	prs: "Pull requests",
	tasks: "Tasks",
	catchup: "Catch up",
	supporttinder: "Support Tinder",
	reports: "Reports",
	analytics: "Analytics",
};

/**
 * Both of these were renamed on 2026-08-14. `home` became `prs` because there
 * was never a home: the page has always been the pull request list, and the
 * name promised a place the app does not have. `people` became `feed` because
 * the team is how you scope that page, not what it is for.
 *
 * Stored preferences still carry the old ids, so they are read as the new ones
 * rather than dropped, which would silently un-hide a tool someone had turned
 * off.
 */
const RENAMED_TOOL_IDS: Record<string, SidebarToolId> = { home: "prs", people: "feed" };

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
// A new account starts with the two tools that need nothing set up: Feed and
// Pull requests. Every other tool is either empty until something else
// exists (Tasks needs todos, Reports needs automations) or needs an
// integration (Support Tinder, Analytics), so shipping them on makes the
// sidebar look busy and broken at once. They're one click away in the Tools
// band's ••• menu and in Settings. Derived from the visible list so a tool
// added later defaults to hidden rather than silently showing up for everyone.
const DEFAULT_VISIBLE_TOOLS: SidebarToolId[] = ["feed", "prs"];
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
