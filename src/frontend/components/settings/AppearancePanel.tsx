import { Reorder } from "motion/react";
import React, { useEffect, useState } from "react";
import { fetchFeeds } from "../../lib/api";
import {
	onSidebarFeedsChanged,
	readHiddenSidebarFeeds,
	setSidebarFeedVisible,
} from "../../lib/sidebar-feeds";
import {
	getSidebarOrder,
	onSidebarOrderChanged,
	setSidebarOrder,
	SIDEBAR_SECTION_LABELS,
	type SidebarSectionId,
} from "../../lib/sidebar-order";
import {
	onSidebarToolsChanged,
	readHiddenSidebarTools,
	setSidebarToolVisible,
	SIDEBAR_TOOL_IDS,
	SIDEBAR_TOOL_LABELS,
} from "../../lib/sidebar-tools";
import {
	getThemePref,
	onThemeChanged,
	setThemePref,
	type ThemePref,
} from "../../lib/theme";
import type { FeedDescriptor } from "../../lib/types";
import {
	getWsTimePref,
	onWsTimeChanged,
	setWsTimePref,
	type WsTimePref,
} from "../../lib/workspace-time";
import {
	SettingCard,
	SettingRow as SettingsRow,
	SettingRowDescription,
	SettingRowText,
	SettingRowTitle,
	SettingsGroupLabel,
	SettingsHeader,
	SettingsPanel,
	SettingsSection,
} from "../../ui/settings";
import { Switch } from "../../ui/switch";
import { Select, SettingRow } from "./shared";

// ── Appearance ─────────────────────────────────────────────────────────────

const THEME_OPTIONS: { value: ThemePref; label: string }[] = [
	{ value: "system", label: "System" },
	{ value: "light", label: "Light" },
	{ value: "dark", label: "Dark" },
];

// A miniature app mockup used inside the theme swatches. `tone` picks the fixed
// light/dark palette (independent of the current theme) via CSS-var classes.
function ThemeMock({ tone }: { tone: "light" | "dark" }) {
	return (
		<div className={`theme-mock mk-${tone}`}>
			<div className="theme-mock-head">
				<div className="theme-mock-bar w1" />
				<div className="theme-mock-bar w2" />
			</div>
			<div className="theme-mock-card">
				<div className="theme-mock-row" />
				<div className="theme-mock-row" />
				<div className="theme-mock-row" />
			</div>
		</div>
	);
}

function ThemeCard({
	option,
	active,
	onClick,
}: {
	option: ThemePref;
	active: boolean;
	onClick: () => void;
}) {
	const label = THEME_OPTIONS.find((o) => o.value === option)?.label ?? option;
	return (
		<button
			className={`theme-card ${active ? "active" : ""}`}
			role="radio"
			aria-checked={active}
			onClick={onClick}
		>
			<div className="theme-swatch">
				{/* System = light base with the dark mock clipped over the right half. */}
				<ThemeMock tone={option === "dark" ? "dark" : "light"} />
				{option === "system" && (
					<div className="theme-swatch-split">
						<ThemeMock tone="dark" />
					</div>
				)}
			</div>
			<span className="theme-card-label">{label}</span>
		</button>
	);
}

// ── Workspace · General ─────────────────────────────────────────────────────

/** Text field that commits on blur/Enter (Esc reverts), for the identity
 *  settings backed by the config file rather than local prefs. */
/**
 * Instance identity. The source of truth is ~/.opensession/config.json
 * (persona.name / branding.productName) on the server, read and written
 * through /api/settings/identity. A save applies to new runs immediately and
 * schedules a frontend rebuild, so open tabs get the update-pill nudge once
 * the re-branded bundle is live.
 */
export function AppearancePanel() {
	const [pref, setPref] = useState<ThemePref>(getThemePref);
	useEffect(() => onThemeChanged(() => setPref(getThemePref())), []);
	const [wsTime, setWsTime] = useState<WsTimePref>(getWsTimePref);
	useEffect(() => onWsTimeChanged(() => setWsTime(getWsTimePref())), []);
	const [hiddenSidebarTools, setHiddenSidebarTools] = useState(
		readHiddenSidebarTools,
	);
	const [sidebarFeeds, setSidebarFeeds] = useState<FeedDescriptor[]>([]);
	const [hiddenSidebarFeeds, setHiddenSidebarFeeds] = useState(
		readHiddenSidebarFeeds,
	);
	useEffect(() => {
		let alive = true;
		fetchFeeds()
			.then((feeds) => {
				if (alive) setSidebarFeeds(feeds);
			})
			.catch(() => {});
		return () => {
			alive = false;
		};
	}, []);
	const [sidebarOrder, setSidebarOrderState] = useState(getSidebarOrder);
	const sidebarOrderRef = React.useRef(sidebarOrder);
	useEffect(
		() =>
			onSidebarOrderChanged(() => {
				const next = getSidebarOrder();
				sidebarOrderRef.current = next;
				setSidebarOrderState(next);
			}),
		[],
	);
	useEffect(
		() =>
			onSidebarToolsChanged(() =>
				setHiddenSidebarTools(readHiddenSidebarTools()),
			),
		[],
	);
	useEffect(
		() =>
			onSidebarFeedsChanged(() =>
				setHiddenSidebarFeeds(readHiddenSidebarFeeds()),
			),
		[],
	);

	return (
		<SettingsPanel>
			<SettingsHeader
				title="Appearance"
				description="How this app looks, and what the sidebar shows. Theme and the tool toggles are per browser; sidebar order and feeds follow your account everywhere."
			/>
			<SettingsGroupLabel>Theme</SettingsGroupLabel>
			<SettingsSection>
				<div className="theme-cards" role="radiogroup" aria-label="Theme">
					{THEME_OPTIONS.map((o) => (
						<ThemeCard
							key={o.value}
							option={o.value}
							active={pref === o.value}
							onClick={() => {
								setThemePref(o.value);
								setPref(o.value);
							}}
						/>
					))}
				</div>
				<div className="mt-3 text-meta text-faint">
					{pref === "system"
						? "Matches your operating system."
						: `Always ${pref} mode.`}
				</div>
			</SettingsSection>

			<SettingsGroupLabel>
				Sidebar
			</SettingsGroupLabel>
			<SettingCard>
				<SettingsRow className="flex-col !items-stretch">
					<SettingRowText>
						<SettingRowTitle>Section order</SettingRowTitle>
						<SettingRowDescription>
							Reorder the sections below Tools. Stored per user and follows you
							across devices.
						</SettingRowDescription>
					</SettingRowText>
					<Reorder.Group
						as="div"
						axis="y"
						values={sidebarOrder}
						onReorder={(next: SidebarSectionId[]) => {
							sidebarOrderRef.current = next;
							setSidebarOrderState(next);
						}}
						className="mt-2 overflow-hidden rounded-lg bg-surface"
					>
						{sidebarOrder.map((section, index) => (
							<SidebarOrderRow
								key={section}
								section={section}
								index={index}
								onCommit={() => setSidebarOrder(sidebarOrderRef.current)}
							/>
						))}
					</Reorder.Group>
				</SettingsRow>
				<SettingRow
					title="Show last used time"
					desc="Show when each workspace was last active in the sidebar. A live run always shows its running time regardless."
					control={
						<Select
							label="Show last used time"
							value={wsTime}
							options={[
								{ value: "off", label: "Off" },
								{ value: "always", label: "Always" },
								{ value: "hover", label: "On hover" },
							]}
							onChange={setWsTimePref}
						/>
					}
				/>
				{SIDEBAR_TOOL_IDS.map((toolId) => (
					<SettingRow
						key={toolId}
						title={SIDEBAR_TOOL_LABELS[toolId]}
						desc="Show this tool in the sidebar."
						control={
							<Switch
								aria-label={`Show ${SIDEBAR_TOOL_LABELS[toolId]} in sidebar`}
								checked={!hiddenSidebarTools.has(toolId)}
								onCheckedChange={(visible) =>
									setSidebarToolVisible(toolId, visible)
								}
							/>
						}
					/>
				))}
				{sidebarFeeds.map((feed) => (
					<SettingRow
						key={feed.id}
						title={feed.title}
						desc="Show this source in the sidebar. Hidden sources stop refreshing until shown again."
						control={
							<Switch
								aria-label={`Show ${feed.title} in sidebar`}
								checked={!hiddenSidebarFeeds.has(feed.id)}
								onCheckedChange={(visible) =>
									setSidebarFeedVisible(feed.id, visible)
								}
							/>
						}
					/>
				))}
			</SettingCard>
		</SettingsPanel>
	);
}

function SidebarOrderRow({
	section,
	index,
	onCommit,
}: {
	section: SidebarSectionId;
	index: number;
	onCommit: () => void;
}) {
	return (
		<Reorder.Item
			as="div"
			value={section}
			onDragEnd={onCommit}
			whileDrag={{
				scale: 1.015,
				zIndex: 3,
				borderRadius: "calc(8px * var(--rf))",
				boxShadow: "0 8px 24px rgba(0, 0, 0, 0.24)",
			}}
			className="relative flex min-h-11 touch-none cursor-grab select-none items-center gap-2 border-b border-line bg-surface px-3 first:rounded-t-lg last:rounded-b-lg last:border-b-0 active:cursor-grabbing"
		>
			<span className="w-5 text-meta tabular-nums text-faint">
				{index + 1}
			</span>
			<span className="min-w-0 flex-1 text-body font-medium text-fg">
				{SIDEBAR_SECTION_LABELS[section]}
			</span>
			<span
				className="inline-flex size-9 items-center justify-center text-faint"
				aria-hidden="true"
			>
				<svg width="18" height="18" viewBox="0 0 18 18" fill="currentColor" aria-hidden="true">
					<circle cx="6" cy="4" r="1.2" />
					<circle cx="12" cy="4" r="1.2" />
					<circle cx="6" cy="9" r="1.2" />
					<circle cx="12" cy="9" r="1.2" />
					<circle cx="6" cy="14" r="1.2" />
					<circle cx="12" cy="14" r="1.2" />
				</svg>
			</span>
		</Reorder.Item>
	);
}
