import type * as React from "react";
import {
	SettingRow as SettingsRow,
	SettingRowControl,
	SettingRowDescription,
	SettingRowText,
	SettingRowTitle,
	settingsSelectClass,
} from "../../ui/settings";
import { IconChevronDown } from "../icons";

// ── Reusable controls ──────────────────────────────────────────────────────
//
// Deliberately thin, and deliberately still here: SettingRow is a convenience
// prop-API over ui/settings' composable row parts (it renders exactly those
// primitives, so there is no style duplication to drift), and Select has no
// ui/ primitive to defer to — it is the settings-flavored native <select>
// with the chevron overlay. Panels use toggles via ui/switch's Switch
// directly; there is no wrapper for it.

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

export function Select<T extends string>({
	value,
	options,
	onChange,
	label,
	disabled,
}: {
	value: T;
	options: { value: T; label: string; disabled?: boolean }[];
	onChange: (v: T) => void;
	label: string;
	disabled?: boolean;
}) {
	return (
		<span className="relative inline-grid">
			<select
				className={`${settingsSelectClass} appearance-none !pr-9`}
				aria-label={label}
				disabled={disabled}
				value={value}
				onChange={(e) => onChange(e.target.value as T)}
			>
				{options.map((o) => (
					<option key={o.value} value={o.value} disabled={o.disabled}>
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
