import React, { useEffect, useState } from "react";
import { useIsPhone } from "../hooks/useIsPhone";
import { cn } from "../ui/cn";
import { useAuthStatus } from "./UserPicker";
import {
	SETTINGS_BACK,
	SETTINGS_CONTENT,
	SETTINGS_CONTENT_SHEET,
	SETTINGS_CONTENT_TOOL,
	SETTINGS_PAGE,
	SETTINGS_PANEL_FRAME,
	SETTINGS_PANEL_FRAME_GALLERY,
	SETTINGS_PANEL_FRAME_SHEET,
	SETTINGS_SHEET_LIST,
	SETTINGS_SHEET_SEARCH_BAR,
	SETTINGS_NAV,
	SETTINGS_NAV_CAPTION,
	SETTINGS_NAV_GROUP,
	SETTINGS_NAV_ICON,
	SETTINGS_NAV_LIST,
	SETTINGS_NAV_ROW,
	settingsSeamStyle,
} from "../lib/settings-classes";
import { matchSections, type SectionHit } from "../lib/settings-search";
import { Input } from "../ui/input";
import { BottomSheet } from "../ui/sheet";
import { Connections } from "./Connections";
import {
	IconChevronLeft,
	IconChevronRight,
	IconSearch,
	IconX,
} from "./icons";
import { MyAccountsPanel } from "./MyAccounts";
import { AppearancePanel } from "./settings/AppearancePanel";
import { AuditPanel } from "./settings/AuditPanel";
import { DeploysPanel } from "./settings/DeploysPanel";
import { IdentityPanel } from "./settings/IdentityPanel";
import { IntegrationsPanel } from "./settings/IntegrationsPanel";
import { LibraryPanel } from "./settings/LibraryPanel";
import { KeychainPanel } from "./settings/KeychainPanel";
import { MembersPanel } from "./settings/MembersPanel";
import { MemoryPanel } from "./settings/MemoryPanel";
import { ModelsPanel } from "./settings/ModelsPanel";
import { UsagePanel } from "./settings/UsagePanel";
import { NotificationsPanel } from "./settings/NotificationsPanel";
import { PapercutsPanel } from "./settings/PapercutsPanel";
import { PreferencesPanel } from "./settings/PreferencesPanel";
import { ShortcutsPanel } from "./settings/ShortcutsPanel";
import { PrewarmingPanel } from "./settings/PrewarmingPanel";
import { ReposPanel } from "./settings/ReposPanel";
import { SandboxesPanel } from "./settings/SandboxesPanel";
import { RunnersPanel } from "./settings/RunnersPanel";
import { SettingsAccountCard, SettingsAccountFooter } from "./SettingsAccount";
import { SetupPanel } from "./Setup";
import type { Workspace } from "../lib/types";

// The full-window Settings surface: a left sub-nav + a scrolling body, reached
// from the "Settings" item in the account menu. Designed to grow — each area is
// just another entry in SECTIONS and a matching panel below. The "Tools" group
// holds the app's tool surfaces (Automations, Goals, …) — those render at their
// own routes (<base>/automations, …) with this surface as chrome, so the
// section is controlled by the router, not local state.
//
// Groups run from what one person owns to what the whole instance does:
// "Personal" is yours alone — the per-user half first (who sessions act as,
// your standing prompt, how you write) and the per-device half last
// (notifications, theme); "Workspace" is shared config every session runs
// under; "Automation" is the standing work the instance does on its own —
// those are the tool surfaces, grouped by what they are rather than sold as
// the headline; "Infrastructure" is the machinery prepared ahead of a run; and
// "Activity" is the read-only record agents leave behind.

/** Tool surfaces hosted inside Settings — App renders their panel as children. */
export type ToolSectionKey = "automations" | "goals" | "security";

/** Listed in nav order (SECTIONS below). */
export type SettingsSectionKey =
	| "myAccounts"
	| "keychain"
	| "preferences"
	| "notifications"
	| "appearance"
	| "shortcuts"
	| "setup"
	| "identity"
	| "repos"
	| "members"
	| "models"
	| "usage"
	| "sandboxes"
	| "runners"
	| "library"
	| "integrations"
	| "connections"
	| "memory"
	| "prewarming"
	| "deploys"
	| "papercuts"
	| "audit"
	| ToolSectionKey;

const TOOL_SECTIONS = new Set<SettingsSectionKey>([
	"automations",
	"goals",
	"security",
]);

/** Sections that are browsed rather than read down, and take the wider
 *  column for it (see SETTINGS_PANEL_FRAME_GALLERY). */
const GALLERY_SECTIONS = new Set<SettingsSectionKey>(["library"]);

const SECTIONS: {
	key: SettingsSectionKey;
	label: string;
	group: string;
	icon: React.ReactNode;
	adminOnly?: boolean;
}[] = [
	{
		key: "myAccounts",
		label: "My accounts",
		group: "Personal",
		icon: (
			<svg
				width="20"
				height="20"
				viewBox="0 0 16 16"
				fill="none"
				stroke="currentColor"
				strokeWidth="1.4"
			>
				<circle cx="8" cy="5.2" r="2.7" />
				<path d="M2.8 13.5a5.2 5.2 0 0 1 10.4 0" strokeLinecap="round" />
			</svg>
		),
	},
	{
		key: "keychain",
		label: "Keychain",
		group: "Personal",
		icon: (
			<svg
				width="20"
				height="20"
				viewBox="0 0 16 16"
				fill="none"
				stroke="currentColor"
				strokeWidth="1.4"
			>
				<circle cx="5.4" cy="8" r="2.6" />
				<path d="M8 8h6M12 8v2.2M10 8v1.6" strokeLinecap="round" />
			</svg>
		),
	},
	{
		key: "preferences",
		label: "Preferences",
		group: "Personal",
		icon: (
			<svg
				width="20"
				height="20"
				viewBox="0 0 16 16"
				fill="none"
				stroke="currentColor"
				strokeWidth="1.4"
			>
				<path d="M2.5 4.5h11M2.5 11.5h11" strokeLinecap="round" />
				<circle cx="6" cy="4.5" r="1.7" fill="var(--bg-panel)" />
				<circle cx="10.5" cy="11.5" r="1.7" fill="var(--bg-panel)" />
			</svg>
		),
	},
	{
		key: "notifications",
		label: "Notifications",
		group: "Personal",
		icon: (
			<svg
				width="20"
				height="20"
				viewBox="0 0 16 16"
				fill="none"
				stroke="currentColor"
				strokeWidth="1.4"
			>
				<path
					d="M8 2.2a3.4 3.4 0 0 0-3.4 3.4c0 2.9-1.1 3.9-1.1 3.9h9A5.4 5.4 0 0 1 11.4 5.6 3.4 3.4 0 0 0 8 2.2z"
					strokeLinejoin="round"
				/>
				<path d="M6.7 12a1.4 1.4 0 0 0 2.6 0" strokeLinecap="round" />
			</svg>
		),
	},
	{
		key: "appearance",
		label: "Appearance",
		group: "Personal",
		icon: (
			<svg
				width="20"
				height="20"
				viewBox="0 0 16 16"
				fill="none"
				stroke="currentColor"
				strokeWidth="1.4"
			>
				<circle cx="8" cy="8" r="5.5" />
				<path d="M8 2.5a5.5 5.5 0 0 1 0 11z" fill="currentColor" stroke="none" />
			</svg>
		),
	},
	{
		key: "shortcuts",
		label: "Shortcuts",
		group: "Personal",
		icon: (
			<svg
				width="20"
				height="20"
				viewBox="0 0 16 16"
				fill="none"
				stroke="currentColor"
				strokeWidth="1.4"
			>
				<rect x="1.4" y="3.6" width="13.2" height="8.8" rx="2" />
				<path
					d="M4.3 6.4h.01M6.7 6.4h.01M9.1 6.4h.01M11.5 6.4h.01M4.3 9.6h7.2"
					strokeLinecap="round"
				/>
			</svg>
		),
	},
	{
		key: "setup",
		label: "Setup",
		group: "Workspace",
		adminOnly: true,
		icon: (
			<svg
				width="20"
				height="20"
				viewBox="0 0 16 16"
				fill="none"
				stroke="currentColor"
				strokeWidth="1.4"
			>
				<path d="M2.7 4.1l1 1 1.8-2" strokeLinecap="round" strokeLinejoin="round" />
				<path d="M7.8 4.4h5.5" strokeLinecap="round" />
				<path d="M2.7 8.1l1 1 1.8-2" strokeLinecap="round" strokeLinejoin="round" />
				<path d="M7.8 8.4h5.5" strokeLinecap="round" />
				<path d="M2.7 12.1l1 1 1.8-2" strokeLinecap="round" strokeLinejoin="round" />
				<path d="M7.8 12.4h5.5" strokeLinecap="round" />
			</svg>
		),
	},
	{
		key: "identity",
		label: "Identity",
		group: "Workspace",
		icon: (
			<svg
				width="20"
				height="20"
				viewBox="0 0 16 16"
				fill="none"
				stroke="currentColor"
				strokeWidth="1.4"
			>
				<rect x="2.2" y="3.4" width="11.6" height="9.2" rx="1.5" />
				<circle cx="6" cy="7" r="1.4" />
				<path d="M3.9 10.9a2.3 2.3 0 0 1 4.2 0" strokeLinecap="round" />
				<path d="M10.2 6.6h2.1M10.2 9h2.1" strokeLinecap="round" />
			</svg>
		),
	},
	{
		key: "repos",
		label: "Repositories",
		group: "Workspace",
		adminOnly: true,
		icon: (
			<svg
				width="20"
				height="20"
				viewBox="0 0 16 16"
				fill="none"
				stroke="currentColor"
				strokeWidth="1.4"
			>
				<path
					d="M4.2 2.5h8v11h-8a1.5 1.5 0 0 1 0-3h8"
					strokeLinecap="round"
					strokeLinejoin="round"
				/>
			</svg>
		),
	},
	{
		key: "members",
		label: "Members",
		group: "Workspace",
		adminOnly: true,
		icon: (
			<svg
				width="20"
				height="20"
				viewBox="0 0 16 16"
				fill="none"
				stroke="currentColor"
				strokeWidth="1.4"
			>
				<circle cx="6.1" cy="5.6" r="2.3" />
				<path d="M2.1 12.7a4 4 0 0 1 8 0" strokeLinecap="round" />
				<path d="M10.6 3.9a2.3 2.3 0 0 1 0 3.4" strokeLinecap="round" />
				<path d="M11.6 12.7a4 4 0 0 0-1.1-2.8" strokeLinecap="round" />
			</svg>
		),
	},
	{
		key: "models",
		label: "Models",
		group: "Workspace",
		icon: (
			<svg
				width="20"
				height="20"
				viewBox="0 0 16 16"
				fill="none"
				stroke="currentColor"
				strokeWidth="1.4"
			>
				<rect x="2.25" y="2.25" width="5" height="5" rx="1" />
				<rect x="8.75" y="8.75" width="5" height="5" rx="1" />
				<circle cx="11.25" cy="4.75" r="2.5" />
				<path d="M4.75 9.5v1.75a1 1 0 0 0 1 1h1.75" strokeLinecap="round" />
			</svg>
		),
	},
	{
		key: "usage",
		label: "Usage",
		group: "Workspace",
		icon: (
			<svg
				width="20"
				height="20"
				viewBox="0 0 16 16"
				fill="none"
				stroke="currentColor"
				strokeWidth="1.4"
			>
				<path d="M2.6 11.6a5.7 5.7 0 1 1 10.8 0" strokeLinecap="round" />
				<path d="M8 11.6l2.7-3.9" strokeLinecap="round" />
			</svg>
		),
	},
	{
		key: "sandboxes",
		label: "Sandboxes",
		group: "Workspace",
		icon: (
			<svg width="20" height="20" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4">
				<path d="M8 1.8l5.2 2.9v6.1L8 13.8l-5.2-3V4.7L8 1.8z" strokeLinejoin="round" />
				<path d="M2.9 4.9L8 7.7l5.1-2.8M8 7.8v5.8" />
			</svg>
		),
	},
	{
		key: "runners",
		label: "Runners",
		group: "Workspace",
		icon: (
			<svg width="20" height="20" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4">
				<rect x="2.3" y="3" width="11.4" height="10" rx="1.6" />
				<path d="M5 6.1h.01M8 6.1h3M5 9.8h6" strokeLinecap="round" />
			</svg>
		),
	},
	{
		key: "library",
		label: "Library",
		group: "Workspace",
		icon: (
			<svg
				width="20"
				height="20"
				viewBox="0 0 16 16"
				fill="none"
				stroke="currentColor"
				strokeWidth="1.4"
			>
				<path d="M2.6 3.1h2.6v9.8H2.6zM6.4 3.1H9v9.8H6.4z" strokeLinejoin="round" />
				<path d="M10.5 3.6l2.5.7-2.2 8.4-2.4-.7" strokeLinejoin="round" />
			</svg>
		),
	},
	{
		key: "integrations",
		label: "Integrations",
		group: "Workspace",
		adminOnly: true,
		icon: (
			<svg
				width="20"
				height="20"
				viewBox="0 0 16 16"
				fill="none"
				stroke="currentColor"
				strokeWidth="1.4"
			>
				<path d="M6 2.2v3.2M10 2.2v3.2" strokeLinecap="round" />
				<path
					d="M3.8 5.4h8.4v2.1a4.2 4.2 0 0 1-8.4 0z"
					strokeLinejoin="round"
				/>
				<path d="M8 11.7v2.1" strokeLinecap="round" />
			</svg>
		),
	},
	{
		key: "connections",
		label: "Connections",
		group: "Workspace",
		icon: (
			<svg
				width="20"
				height="20"
				viewBox="0 0 16 16"
				fill="none"
				stroke="currentColor"
				strokeWidth="1.4"
			>
				<circle cx="4.5" cy="8" r="2" />
				<circle cx="11.5" cy="4" r="2" />
				<circle cx="11.5" cy="12" r="2" />
				<path d="M6.3 7.1l3.4-2.2M6.3 8.9l3.4 2.2" strokeLinecap="round" />
			</svg>
		),
	},
	{
		key: "memory",
		label: "Memory",
		group: "Workspace",
		icon: (
			<svg
				width="20"
				height="20"
				viewBox="0 0 16 16"
				fill="none"
				stroke="currentColor"
				strokeWidth="1.4"
			>
				<path d="M8 2.5l5.5 2.75L8 8 2.5 5.25 8 2.5z" strokeLinejoin="round" />
				<path d="M2.5 8.25L8 11l5.5-2.75" strokeLinecap="round" strokeLinejoin="round" />
				<path d="M2.5 11.25L8 14l5.5-2.75" strokeLinecap="round" strokeLinejoin="round" />
			</svg>
		),
	},
	{
		key: "automations",
		label: "Automations",
		group: "Automation",
		icon: (
			<svg
				width="20"
				height="20"
				viewBox="0 0 16 16"
				fill="none"
				stroke="currentColor"
				strokeWidth="1.4"
			>
				<circle cx="8" cy="8" r="5.5" />
				<path d="M8 5v3l2 1.5" strokeLinecap="round" strokeLinejoin="round" />
			</svg>
		),
	},
	{
		key: "goals",
		label: "Goals",
		group: "Automation",
		icon: (
			<svg
				width="20"
				height="20"
				viewBox="0 0 16 16"
				fill="none"
				stroke="currentColor"
				strokeWidth="1.4"
			>
				<circle cx="8" cy="8" r="6" />
				<circle cx="8" cy="8" r="3" />
				<circle cx="8" cy="8" r="0.6" fill="currentColor" stroke="none" />
			</svg>
		),
	},
	{
		key: "security",
		label: "Security",
		group: "Automation",
		icon: (
			<svg
				width="20"
				height="20"
				viewBox="0 0 16 16"
				fill="none"
				stroke="currentColor"
				strokeWidth="1.4"
			>
				<path
					d="M8 1.8l4.6 1.7v3.8c0 3-1.9 5.2-4.6 6.5-2.7-1.3-4.6-3.5-4.6-6.5V3.5L8 1.8z"
					strokeLinejoin="round"
				/>
				<path d="M6.1 8l1.3 1.3 2.5-2.6" strokeLinecap="round" strokeLinejoin="round" />
			</svg>
		),
	},
	{
		key: "prewarming",
		label: "Acceleration",
		group: "Infrastructure",
		icon: (
			<svg
				width="20"
				height="20"
				viewBox="0 0 16 16"
				fill="none"
				stroke="currentColor"
				strokeWidth="1.4"
			>
				<path
					d="M8 1.8c.4 2.2 3.7 3.4 3.7 6.7a3.7 3.7 0 0 1-7.4 0c0-1.4.6-2.4 1.4-3.4.2 1 .7 1.6 1.4 2 0-1.9.2-3.9.9-5.3z"
					strokeLinejoin="round"
				/>
			</svg>
		),
	},
	{
		key: "deploys",
		label: "Deploys",
		group: "Infrastructure",
		icon: (
			<svg
				width="20"
				height="20"
				viewBox="0 0 16 16"
				fill="none"
				stroke="currentColor"
				strokeWidth="1.4"
			>
				<rect x="2" y="2.4" width="12" height="4" rx="1" />
				<rect x="2" y="9.6" width="12" height="4" rx="1" />
				<path d="M4.6 4.4h.01M4.6 11.6h.01" strokeLinecap="round" />
			</svg>
		),
	},
	{
		key: "papercuts",
		label: "Papercuts",
		group: "Activity",
		icon: (
			<svg
				width="20"
				height="20"
				viewBox="0 0 16 16"
				fill="none"
				stroke="currentColor"
				strokeWidth="1.4"
			>
				<rect
					x="1.6"
					y="5.4"
					width="12.8"
					height="5.2"
					rx="2.6"
					transform="rotate(-45 8 8)"
					strokeLinejoin="round"
				/>
				<path d="M6.9 8h.01M9.1 8h.01M8 6.9v.01M8 9.1v.01" strokeLinecap="round" />
			</svg>
		),
	},
	{
		key: "audit",
		label: "Audit log",
		group: "Activity",
		icon: (
			<svg
				width="20"
				height="20"
				viewBox="0 0 16 16"
				fill="none"
				stroke="currentColor"
				strokeWidth="1.4"
			>
				<path d="M4 2.5h8a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1z" strokeLinejoin="round" />
				<path d="M5.5 5.5h5M5.5 8h5M5.5 10.5h3" strokeLinecap="round" />
			</svg>
		),
	},
];

type Section = (typeof SECTIONS)[number];
type SectionGroup = { group: string; items: Section[] };
type FilteredGroup = { group: string; hits: SectionHit<Section>[] };

/** Groups with their non-matching rows dropped, and empty groups gone with
 *  them. An empty query filters nothing, so both surfaces render one list. */
function filterGroups(groups: SectionGroup[], query: string): FilteredGroup[] {
	const out: FilteredGroup[] = [];
	for (const g of groups) {
		const hits = matchSections(g.items, query);
		if (hits.length) out.push({ group: g.group, hits });
	}
	return out;
}

/**
 * The nav's filter field. Settings is 22 sections across five groups, and the
 * group a setting sits in is a judgement call the person searching hasn't made
 * — so the query also matches per-section keywords ("vim", "cron", "dark
 * mode"), and a row that matched on one says which under its label.
 *
 * Enter opens the first result and Escape clears, so a search can be run and
 * undone without leaving the keyboard.
 */
function NavSearch({
	value,
	onChange,
	onSubmit,
	className,
	sheet,
}: {
	value: string;
	onChange: (v: string) => void;
	onSubmit: () => void;
	className?: string;
	/** Phone sheet: the field sits in a page of grouped cards rather than in
	 *  the desktop sidebar's chrome, so it takes the cards' own fill instead of
	 *  an outlined well, and a touch-sized box with a 16px value — anything
	 *  smaller and iOS zooms the page when the field takes focus (the command
	 *  palette hardcodes 16px for the same reason). */
	sheet?: boolean;
}) {
	// The positioned box wraps the field only, so a caller's className can pad
	// or stick the strip around it without moving the icons off the field.
	return (
		<div className={className}>
			<div className="relative">
				<IconSearch
					size={sheet ? 20 : 18}
					className={cn(
						"pointer-events-none absolute top-1/2 -translate-y-1/2 text-faint",
						sheet ? "left-3.5" : "left-2",
					)}
				/>
				<Input
					value={value}
					// type=search for the phone keyboard's Search key; the native
					// cancel button goes, since the field renders its own (bigger,
					// and present at both widths).
					type="search"
					enterKeyHint="search"
					placeholder="Search settings"
					aria-label="Search settings"
					spellCheck={false}
					autoCapitalize="off"
					autoCorrect="off"
					size={sheet ? "lg" : "md"}
					className={cn(
						"[&::-webkit-search-cancel-button]:hidden",
						// `rounded-full`, not the app's squircle corner: a capsule is what
						// iOS puts a search field in, and base.css grants the squircle to
						// every `rounded-*` EXCEPT this one, so it is also the spelling
						// that gets true round ends rather than a superellipse.
						sheet
							? cn("h-10 rounded-full border-transparent bg-raised pl-11 text-input-phone", value && "pr-11")
							: cn("pl-8", value && "pr-8"),
					)}
					onChange={(e) => onChange(e.target.value)}
					onKeyDown={(e) => {
						if (e.key === "Enter") onSubmit();
						else if (e.key === "Escape" && value) {
							// Escape belongs to the field while it has something to clear —
							// unhandled, it would dismiss the whole phone sheet instead.
							e.stopPropagation();
							e.preventDefault();
							onChange("");
						}
					}}
				/>
				{value && (
					<button
						type="button"
						aria-label="Clear search"
						className={cn(
							"absolute top-1/2 flex -translate-y-1/2 cursor-pointer items-center justify-center border-none bg-transparent text-faint hover:bg-hover hover:text-fg",
							// Round inside a capsule; the desktop field keeps the app's corner.
							sheet ? "right-1.5 size-8 rounded-full" : "right-1 size-6 rounded-md",
						)}
						onClick={() => onChange("")}
					>
						<IconX size={sheet ? 18 : 16} />
					</button>
				)}
			</div>
		</div>
	);
}

/** The active section's panel — shared by the desktop split and the phone
 * sheet's detail page. Tool panels come in via children (App owns them). */
function SectionPanel({
	section,
	onBack,
	workspace,
	children,
}: {
	section: SettingsSectionKey;
	/** Leaving settings — the Setup wizard's last step offers it as "Done". */
	onBack?: () => void;
	workspace?: Workspace;
	children?: React.ReactNode;
}) {
	return (
		<>
			{TOOL_SECTIONS.has(section) && children}
			{section === "notifications" && <NotificationsPanel />}
			{section === "preferences" && <PreferencesPanel />}
			{section === "appearance" && <AppearancePanel />}
			{section === "shortcuts" && <ShortcutsPanel />}
			{section === "setup" && <SetupPanel onDone={onBack} />}
			{section === "identity" && <IdentityPanel />}
			{section === "repos" && <ReposPanel />}
			{section === "members" && <MembersPanel />}
			{section === "library" && <LibraryPanel />}
			{section === "integrations" && <IntegrationsPanel />}
			{section === "audit" && <AuditPanel />}
			{section === "models" && <ModelsPanel workspace={workspace} />}
			{section === "usage" && <UsagePanel />}
			{section === "sandboxes" && <SandboxesPanel />}
			{section === "runners" && <RunnersPanel />}
			{section === "connections" && <Connections />}
			{section === "myAccounts" && <MyAccountsPanel />}
			{section === "memory" && <MemoryPanel />}
			{section === "prewarming" && <PrewarmingPanel />}
			{section === "papercuts" && <PapercutsPanel />}
			{section === "keychain" && <KeychainPanel />}
			{section === "deploys" && <DeploysPanel />}
		</>
	);
}

export function Settings({
	onBack,
	section,
	onSelect,
	onShowRoot,
	workspace,
	railWidth,
	children,
}: {
	onBack: () => void;
	/** Active section, derived from the route (tools have their own URLs).
	 * Undefined = no explicit section: desktop defaults to Notifications, the
	 * phone sheet shows its root list of sections. */
	section?: SettingsSectionKey;
	/** Navigate to a section — App maps tool keys to their own routes. */
	onSelect: (key: SettingsSectionKey) => void;
	/** Phone sheet's back-to-root (navigate to sectionless /settings). */
	onShowRoot?: () => void;
	workspace?: Workspace;
	/** Width of the app rail this page replaces, in px, and 0 when it is
	 * collapsed. The desktop entrance starts the content column at that seam
	 * so the rail narrows into this nav instead of jumping (settingsSeamStyle).
	 * App owns the number: the rail is resizable. */
	railWidth: number;
	/** The active tool's panel (App owns the tool components and their props). */
	children?: React.ReactNode;
}) {
	const isPhone = useIsPhone();
	const auth = useAuthStatus();
	const visibleSection = auth?.admin === false && SECTIONS.some(
		(item) => item.key === section && item.adminOnly,
	) ? undefined : section;

	// No page-level Esc handler: Esc belongs to whatever is focused (cancelling
	// an inline edit, closing a menu), not to the settings page itself — losing
	// the whole page to a stray Esc is worse than having no keyboard exit.

	const [query, setQuery] = useState("");

	// Group the nav entries under their group label (order preserved).
	const groups: SectionGroup[] = [];
	for (const s of SECTIONS) {
		if (s.adminOnly && auth?.admin === false) continue;
		let g = groups.find((x) => x.group === s.group);
		if (!g) groups.push((g = { group: s.group, items: [] }));
		g.items.push(s);
	}

	if (isPhone)
		return (
			<MobileSettings
				groups={groups}
				section={visibleSection}
				onSelect={onSelect}
				onShowRoot={onShowRoot}
				onBack={onBack}
				workspace={workspace}
			>
				{children}
			</MobileSettings>
		);

	// Default landing = the first non-tool row in the nav. Tool sections can't be
	// the default: their panel arrives as `children`, which App only passes on a
	// tool route, so a bare /settings would render an empty pane.
	const active = visibleSection ?? "myAccounts";
	const shown = filterGroups(groups, query);
	const firstHit = shown[0]?.hits[0]?.item;

	return (
		<div className={SETTINGS_PAGE} style={settingsSeamStyle(railWidth)}>
			{/* Back and search stay put; only the section list scrolls, so neither
			    they nor the account footer are lost once the list outgrows the nav. */}
			<aside className={SETTINGS_NAV}>
				<button className={SETTINGS_BACK} onClick={onBack}>
					<span className={SETTINGS_NAV_ICON}>
						<svg width="20" height="20" viewBox="0 0 16 16" fill="none">
							<path
								d="M10 3.5L5.5 8l4.5 4.5"
								stroke="currentColor"
								strokeWidth="1.5"
								strokeLinecap="round"
								strokeLinejoin="round"
							/>
						</svg>
					</span>
					Back to app
				</button>
				<NavSearch
					value={query}
					onChange={setQuery}
					onSubmit={() => firstHit && onSelect(firstHit.key)}
					className="mb-1"
				/>
				<div className={SETTINGS_NAV_LIST}>
					{shown.map((g) => (
						<div className={SETTINGS_NAV_GROUP} key={g.group}>
							<div className={SETTINGS_NAV_CAPTION}>{g.group}</div>
							{g.hits.map(({ item: s, hint }) => (
								<button
									key={s.key}
									className={SETTINGS_NAV_ROW}
									data-active={active === s.key || undefined}
									onClick={() => onSelect(s.key)}
								>
									<span className={SETTINGS_NAV_ICON}>{s.icon}</span>
									<span className="min-w-0 flex-1">
										{s.label}
										{hint && (
											<span className="block truncate text-meta font-normal text-faint">
												{hint}
											</span>
										)}
									</span>
								</button>
							))}
						</div>
					))}
					{shown.length === 0 && (
						<div className="px-2.5 py-3 text-meta text-faint">
							Nothing matches “{query}”.
						</div>
					)}
				</div>
				<SettingsAccountFooter />
			</aside>

			{/* Tool sections fill the whole content area edge-to-edge (they carry
			    their own layout/scrolling); settings panels keep the centered,
			    padded reading column. */}
			<div
				data-settings-scroll
				className={cn(
					SETTINGS_CONTENT,
					TOOL_SECTIONS.has(active) && SETTINGS_CONTENT_TOOL,
				)}
			>
				{TOOL_SECTIONS.has(active) ? (
					<SectionPanel section={active} workspace={workspace}>{children}</SectionPanel>
				) : (
					<div
						className={
							GALLERY_SECTIONS.has(active)
								? SETTINGS_PANEL_FRAME_GALLERY
								: SETTINGS_PANEL_FRAME
						}
					>
						<SectionPanel section={active} onBack={onBack} workspace={workspace}>
							{children}
						</SectionPanel>
					</div>
				)}
			</div>
		</div>
	);
}

/**
 * Phone Settings: a bottom sheet sliding up over the root page, with iOS-style
 * paging inside — the root page lists the sections as grouped tappable rows,
 * and picking one slides its panel in from the right (Back slides it out).
 * Which page shows is route-driven: a section in the URL = detail page.
 */
function MobileSettings({
	groups,
	section,
	onSelect,
	onShowRoot,
	onBack,
	workspace,
	children,
}: {
	groups: SectionGroup[];
	section?: SettingsSectionKey;
	onSelect: (key: SettingsSectionKey) => void;
	onShowRoot?: () => void;
	onBack: () => void;
	workspace?: Workspace;
	children?: React.ReactNode;
}) {
	const [query, setQuery] = useState("");
	const shown = filterGroups(groups, query);
	const firstHit = shown[0]?.hits[0]?.item;
	// Keep the last opened section mounted while popping back to the root, so
	// the detail page has content during its slide-out.
	const [lastSection, setLastSection] = useState<SettingsSectionKey | null>(
		section ?? null,
	);
	useEffect(() => {
		if (section) setLastSection(section);
	}, [section]);

	const detail = section ?? null;
	const shownSection = detail ?? lastSection;
	const shownLabel = SECTIONS.find((s) => s.key === shownSection)?.label;
	const pageEase = "transition-transform duration-[var(--dur-lg)] ease-[var(--ease)]";

	return (
		<BottomSheet onClose={onBack} label="Settings" className="settings-sheet h-[93dvh]">
			{(dismiss) => (
				<>
					<div className="relative flex h-11 shrink-0 items-center justify-center px-3">
						{detail && (
							<button
								className="absolute left-1 flex items-center gap-0.5 rounded-control border-none bg-transparent px-2 py-2 text-control-label font-medium text-accent"
								onClick={() => onShowRoot?.()}
							>
								<IconChevronLeft size={22} />
								Settings
							</button>
						)}
						{/* The sheet's own title, and the only one on phones: the panel
						    h1 hides in here (`[.settings-sheet_&]:hidden` in ui/settings).
						    It carries the same weight that h1 does, so the title reads the
						    same on a phone as it does on the desktop page. */}
						<span className="text-section-title font-title text-fg">
							{detail ? shownLabel : "Settings"}
						</span>
						<button
							className="absolute right-3 flex h-8 w-8 items-center justify-center rounded-full border-none bg-active text-dim"
							onClick={dismiss}
							aria-label="Close settings"
						>
							<IconX size={22} />
						</button>
					</div>

					<div className="relative min-h-0 flex-1 overflow-hidden">
						{/* Root page: grouped section list over a bottom search bar.
						    Parked slightly left while a detail page covers it, iOS-style. */}
						<div
							className={cn("absolute inset-0", pageEase, detail && "-translate-x-1/3")}
							aria-hidden={!!detail}
						>
							<div className={SETTINGS_SHEET_LIST}>
								{shown.map((g) => (
									<div key={g.group}>
										<div className="mb-2 mt-5 px-1 text-control-label font-semibold text-faint">
											{g.group}
										</div>
										<div className="overflow-hidden rounded-2xl border border-divider bg-settings-plate">
											{g.hits.map(({ item: s, hint }) => (
												<button
													key={s.key}
													className="flex w-full items-center gap-3 border-x-0 border-b border-t-0 border-solid border-line bg-transparent px-3.5 py-3 text-left last:border-b-0 active:bg-hover"
													onClick={() => onSelect(s.key)}
												>
													<span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-active text-dim">
														{s.icon}
													</span>
												<span className="min-w-0 flex-1 text-item-title font-medium text-fg">
														{s.label}
														{hint && (
															<span className="block truncate text-meta font-normal text-faint">
																{hint}
															</span>
														)}
													</span>
													<IconChevronRight size={20} className="shrink-0 text-faint" />
												</button>
											))}
										</div>
									</div>
								))}
								{shown.length === 0 && (
									<div className="mt-6 px-1 text-supporting text-faint">
										Nothing matches “{query}”.
									</div>
								)}
								{!query && <SettingsAccountCard />}
							</div>

							{/* Search sits at the bottom edge, where the thumb is and where
							    iOS 26 puts it (the native app's sessions list does the same),
							    on glass — so the list stays legible passing behind it and the
							    way out of 22 sections is always in reach. */}
							<NavSearch
								sheet
								value={query}
								onChange={setQuery}
								onSubmit={() => firstHit && onSelect(firstHit.key)}
								className={SETTINGS_SHEET_SEARCH_BAR}
							/>
						</div>

						{/* Detail page: the picked section's panel, slid in from the right. */}
						<div
							className={cn(
								"absolute inset-0 flex flex-col bg-surface",
								pageEase,
								detail ? "translate-x-0" : "translate-x-full",
							)}
							aria-hidden={!detail}
						>
							{shownSection && (
								<div data-settings-scroll className={SETTINGS_CONTENT_SHEET}>
									{TOOL_SECTIONS.has(shownSection) ? (
										<SectionPanel section={shownSection} workspace={workspace}>{children}</SectionPanel>
									) : (
										<div className={SETTINGS_PANEL_FRAME_SHEET}>
											<SectionPanel section={shownSection} onBack={onBack} workspace={workspace}>
												{children}
											</SectionPanel>
										</div>
									)}
								</div>
							)}
						</div>
					</div>
				</>
			)}
		</BottomSheet>
	);
}
