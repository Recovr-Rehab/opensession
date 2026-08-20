// Per-user Active/Settled workspace lifecycle overrides. The map is keyed by
// the sidebar row key, not by every member session: settlement files a whole
// piece of work in one person's sidebar without changing it for teammates.
import {
	fetchSettlements,
	saveSettlementsApi,
	type SettlementRecord,
} from "./api";
import { makeUserMap } from "./user-map";

export type { SettlementRecord } from "./api";

const CHANGE_EVENT = "opensession-settlements-changed";

const store = makeUserMap<SettlementRecord>({
	changeEvent: CHANGE_EVENT,
	fetchMap: fetchSettlements,
	saveMap: saveSettlementsApi,
});

export function getSettlements(): Record<string, SettlementRecord> {
	return store.get();
}

export function setSettlement(
	key: string,
	state: SettlementRecord["state"],
	terminalSignature?: string | null,
): void {
	store.update((settlements) => ({
		...settlements,
		[key]: {
			state,
			at: new Date().toISOString(),
			...(terminalSignature ? { terminalSignature } : {}),
		},
	}));
}

export function clearSettlement(key: string): void {
	store.update((settlements) => {
		if (!(key in settlements)) return null;
		const next = { ...settlements };
		delete next[key];
		return next;
	});
}

export function onSettlementsChanged(handler: () => void): () => void {
	return store.onChanged(handler);
}
