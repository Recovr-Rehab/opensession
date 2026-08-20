import { makeUserPref } from "./user-pref";

export type AutoSettleDays = number | "off";

const daysPref = makeUserPref<AutoSettleDays>({
	localKey: "opensession-auto-settle-days",
	prefKey: "auto-settle-days",
	changeEvent: "opensession-auto-settle-days-changed",
	defaultValue: 3,
	decode: (raw) => {
		if (raw === "off") return "off";
		const days = Number(raw);
		return Number.isInteger(days) && days >= 1 && days <= 90 ? days : null;
	},
	encode: String,
});

const prsPref = makeUserPref<boolean>({
	localKey: "opensession-auto-settle-prs",
	prefKey: "auto-settle-prs",
	changeEvent: "opensession-auto-settle-prs-changed",
	defaultValue: true,
	decode: (raw) => (raw === "on" ? true : raw === "off" ? false : null),
	encode: (value) => (value ? "on" : "off"),
});

export interface SettlementPrefs {
	autoSettleDays: AutoSettleDays;
	autoSettlePrs: boolean;
}

export function getSettlementPrefs(): SettlementPrefs {
	return {
		autoSettleDays: daysPref.get(),
		autoSettlePrs: prsPref.get(),
	};
}

export function setAutoSettleDays(value: AutoSettleDays): void {
	daysPref.set(value);
}

export function setAutoSettlePrs(value: boolean): void {
	prsPref.set(value);
}

export function onSettlementPrefsChanged(handler: () => void): () => void {
	const offDays = daysPref.onChanged(handler);
	const offPrs = prsPref.onChanged(handler);
	return () => {
		offDays();
		offPrs();
	};
}
