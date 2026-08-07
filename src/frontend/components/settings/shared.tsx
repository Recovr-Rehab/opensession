import type * as React from "react";
import {
	SettingRow as SettingsRow,
	SettingRowControl,
	SettingRowDescription,
	SettingRowText,
	SettingRowTitle,
	settingsSelectClass,
} from "../../ui/settings";
import { Switch } from "../../ui/switch";
import { IconChevronDown } from "../icons";

// ── Reusable controls ──────────────────────────────────────────────────────

export function SettingRow({
	title,
	desc,
	control,
}: {
	title: string;
	desc: React.ReactNode;
	control: React.ReactNode;
}) {
	return (
		<SettingsRow>
			<SettingRowText>
				<SettingRowTitle>{title}</SettingRowTitle>
				<SettingRowDescription>{desc}</SettingRowDescription>
			</SettingRowText>
			<SettingRowControl>{control}</SettingRowControl>
		</SettingsRow>
	);
}

export function Toggle({
	checked,
	onChange,
	label,
}: {
	checked: boolean;
	onChange: (v: boolean) => void;
	label: string;
}) {
	return (
		<Switch checked={checked} onCheckedChange={onChange} aria-label={label} />
	);
}

export function Select<T extends string>({
	value,
	options,
	onChange,
	label,
}: {
	value: T;
	options: { value: T; label: string }[];
	onChange: (v: T) => void;
	label: string;
}) {
	return (
		<span className="relative inline-grid">
			<select
				className={`${settingsSelectClass} appearance-none !pr-9`}
				aria-label={label}
				value={value}
				onChange={(e) => onChange(e.target.value as T)}
			>
				{options.map((o) => (
					<option key={o.value} value={o.value}>
						{o.label}
					</option>
				))}
			</select>
			<IconChevronDown
				className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2"
				size={20}
			/>
		</span>
	);
}
