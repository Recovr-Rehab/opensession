import { CTX_ITEM_STYLE, CTX_MENU_STYLE, CTX_SEP_STYLE } from "../../lib/sidebar-ctx";
import { statusMenuIcon } from "../../lib/sidebar-lanes";
import { MINE_STATUS_META, type CtxEntry } from "../../lib/sidebar-types";
import { snoozePresets } from "../../lib/snoozes";
import { IconCheck, IconChevronRight, IconMoon, IconStatusRing } from "../icons";
import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

function CtxItem({
	icon,
	label,
	shortcut,
	danger,
	trailing,
	onClick,
	onMouseEnter,
}: {
	icon?: React.ReactNode;
	label: string;
	shortcut?: string;
	danger?: boolean;
	trailing?: React.ReactNode;
	onClick?: () => void;
	onMouseEnter?: (e: React.MouseEvent) => void;
}) {
	return (
		<button
			type="button"
			style={{
				...CTX_ITEM_STYLE,
				display: "flex",
				alignItems: "center",
				gap: 11,
				...(danger ? { color: "var(--red, #e5534b)" } : {}),
			}}
			onClick={onClick}
			onMouseEnter={onMouseEnter}
		>
			{icon !== undefined && (
				<span
					style={{
						width: 20,
						display: "inline-flex",
						justifyContent: "center",
						flexShrink: 0,
						color: danger ? "inherit" : "var(--text-dim)",
					}}
				>
					{icon}
				</span>
			)}
			<span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis" }}>
				{label}
			</span>
			{shortcut && (
				<span
					style={{
						color: "var(--text-faint)",
						fontSize: 13,
						flexShrink: 0,
						marginLeft: 12,
					}}
				>
					{shortcut}
				</span>
			)}
			{trailing}
		</button>
	);
}

export function SidebarCtxMenu({
	x,
	y,
	entries,
	onClose,
}: {
	x: number;
	y: number;
	entries: CtxEntry[];
	onClose: () => void;
}) {
	// Flyout state + hover grace so the pointer can
	// cross the gap between the menu and the panel.
	const [sub, setSub] = useState<{
		kind: "status" | "snooze";
		rect: DOMRect;
	} | null>(null);
	const closeT = useRef<ReturnType<typeof setTimeout> | null>(null);
	function cancelClose() {
		if (closeT.current) clearTimeout(closeT.current);
		closeT.current = null;
	}
	function scheduleClose() {
		cancelClose();
		closeT.current = setTimeout(() => setSub(null), 160);
	}
	useEffect(() => cancelClose, []);

	const statusEntry = entries.find(
		(e): e is Extract<CtxEntry, { kind: "status" }> => e.kind === "status",
	);
	const snoozeEntry = entries.find(
		(e): e is Extract<CtxEntry, { kind: "snooze" }> => e.kind === "snooze",
	);
	const check = (on: boolean) =>
		on ? <IconCheck size={20} style={{ color: "var(--text-dim)" }} /> : undefined;

	const SUB_W = 210;
	const subLeft = sub
		? sub.rect.right + SUB_W + 8 > window.innerWidth
			? sub.rect.left - SUB_W - 4
			: sub.rect.right + 4
		: 0;
	const subTop = sub
		? Math.min(sub.rect.top - 6, window.innerHeight - 280)
		: 0;

	return createPortal(
		<>
			<div
				className="sidebar-ctx-menu"
				style={{ ...CTX_MENU_STYLE, left: x, top: y }}
				onClick={(e) => e.stopPropagation()}
			>
				{entries.map((entry, i) => {
					if (entry.kind === "sep")
						return <div key={i} style={CTX_SEP_STYLE} />;
					if (entry.kind === "status") {
						return (
							<button
								key={i}
								type="button"
								style={{
									...CTX_ITEM_STYLE,
									display: "flex",
									alignItems: "center",
									gap: 11,
								}}
								onMouseEnter={(e) => {
									cancelClose();
									setSub({
										kind: "status",
										rect: e.currentTarget.getBoundingClientRect(),
									});
								}}
								onMouseLeave={scheduleClose}
								onClick={(e) => {
									cancelClose();
									setSub({
										kind: "status",
										rect: e.currentTarget.getBoundingClientRect(),
									});
								}}
							>
								<span
									style={{
										width: 20,
										display: "inline-flex",
										justifyContent: "center",
										flexShrink: 0,
										color: "var(--text-dim)",
									}}
								>
									<IconStatusRing size={20} />
								</span>
								<span style={{ flex: 1 }}>Set status</span>
								<IconChevronRight
									size={16}
									style={{ color: "var(--text-faint)", flexShrink: 0 }}
								/>
							</button>
						);
					}
					if (entry.kind === "snooze") {
						return (
							<button
								key={i}
								type="button"
								style={{
									...CTX_ITEM_STYLE,
									display: "flex",
									alignItems: "center",
									gap: 11,
								}}
								onMouseEnter={(e) => {
									cancelClose();
									setSub({
										kind: "snooze",
										rect: e.currentTarget.getBoundingClientRect(),
									});
								}}
								onMouseLeave={scheduleClose}
								onClick={(e) => {
									cancelClose();
									setSub({
										kind: "snooze",
										rect: e.currentTarget.getBoundingClientRect(),
									});
								}}
							>
								<span
									style={{
										width: 20,
										display: "inline-flex",
										justifyContent: "center",
										flexShrink: 0,
										color: "var(--text-dim)",
									}}
								>
									<IconMoon size={20} />
								</span>
								<span style={{ flex: 1 }}>Snooze</span>
								<IconChevronRight
									size={16}
									style={{ color: "var(--text-faint)", flexShrink: 0 }}
								/>
							</button>
						);
					}
					return (
						<CtxItem
							key={i}
							icon={entry.icon}
							label={entry.label}
							shortcut={entry.shortcut}
							danger={entry.danger}
							onMouseEnter={scheduleClose}
							onClick={() => {
								entry.onClick();
								onClose();
							}}
						/>
					);
				})}
			</div>
			{sub?.kind === "status" && statusEntry && (
				<div
					className="sidebar-ctx-menu"
					style={{
						...CTX_MENU_STYLE,
						left: subLeft,
						top: subTop,
						minWidth: SUB_W,
					}}
					onClick={(e) => e.stopPropagation()}
					onMouseEnter={cancelClose}
					onMouseLeave={scheduleClose}
				>
					{MINE_STATUS_META.map((m) => (
						<CtxItem
							key={m.key}
							icon={statusMenuIcon(m.key, m.dotColor)}
							label={m.label}
							trailing={check(statusEntry.current === m.key)}
							onClick={() => {
								statusEntry.onPick(
									statusEntry.current === m.key ? null : m.key,
								);
								onClose();
							}}
						/>
					))}
					<div style={CTX_SEP_STYLE} />
					<CtxItem
						icon={<span />}
						label="Auto (default)"
						trailing={check(statusEntry.current === null)}
						onClick={() => {
							statusEntry.onPick(null);
							onClose();
						}}
					/>
				</div>
			)}
			{sub?.kind === "snooze" && snoozeEntry && (
				<div
					className="sidebar-ctx-menu"
					style={{
						...CTX_MENU_STYLE,
						left: subLeft,
						top: subTop,
						minWidth: SUB_W,
					}}
					onClick={(e) => e.stopPropagation()}
					onMouseEnter={cancelClose}
					onMouseLeave={scheduleClose}
				>
					{snoozePresets().map((p) => (
						<CtxItem
							key={p.label}
							label={p.label}
							onClick={() => {
								snoozeEntry.onPick(p.until.toISOString());
								onClose();
							}}
						/>
					))}
					{snoozeEntry.until && (
						<>
							<div style={CTX_SEP_STYLE} />
							<CtxItem
								label="Unsnooze"
								onClick={() => {
									snoozeEntry.onPick(null);
									onClose();
								}}
							/>
						</>
					)}
				</div>
			)}
		</>,
		document.body,
	);
}
