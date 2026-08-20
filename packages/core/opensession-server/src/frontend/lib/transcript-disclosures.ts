export type TranscriptDisclosureKind = "turn" | "tool-run";

export interface TranscriptDisclosureLedger {
	read(
		kind: TranscriptDisclosureKind,
		sessionId: string | undefined,
		entryIds: readonly string[],
	): boolean | undefined;
	write(
		kind: TranscriptDisclosureKind,
		sessionId: string | undefined,
		entryIds: readonly string[],
		expanded: boolean,
	): void;
}

type RememberedDisclosure = {
	expanded: boolean;
	revision: number;
};

/**
 * Keeps a person's disclosure choices attached to transcript entries rather
 * than React component instances. A live turn gets a new render key as steps
 * arrive, and virtualized history can unmount it entirely. Looking up every
 * overlapping entry lets the replacement recover the last explicit choice.
 */
export function createTranscriptDisclosureLedger(
	maxEntries = 20_000,
): TranscriptDisclosureLedger {
	const remembered = new Map<string, RememberedDisclosure>();
	let revision = 0;

	function key(
		kind: TranscriptDisclosureKind,
		sessionId: string | undefined,
		entryId: string,
	) {
		return `${sessionId ?? ""}\u0000${kind}\u0000${entryId}`;
	}

	return {
		read(kind, sessionId, entryIds) {
			let latest: RememberedDisclosure | undefined;
			for (const entryId of entryIds) {
				const candidate = remembered.get(key(kind, sessionId, entryId));
				if (candidate && (!latest || candidate.revision > latest.revision)) {
					latest = candidate;
				}
			}
			return latest?.expanded;
		},

		write(kind, sessionId, entryIds, expanded) {
			const next = { expanded, revision: ++revision };
			for (const entryId of entryIds) {
				const itemKey = key(kind, sessionId, entryId);
				// Refresh insertion order so the bounded ledger drops least-recently
				// changed entries rather than an actively used old turn.
				remembered.delete(itemKey);
				remembered.set(itemKey, next);
			}
			while (remembered.size > maxEntries) {
				const oldest = remembered.keys().next().value;
				if (oldest === undefined) break;
				remembered.delete(oldest);
			}
		},
	};
}

export const transcriptDisclosureLedger = createTranscriptDisclosureLedger();
