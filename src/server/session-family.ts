/**
 * Session families. A spawned worker (a review, a focused investigation) and
 * the session that spawned it are one piece of work, not two. The link already
 * exists on the session file (`parentSessionId`, or `spawnedBy` for internal
 * helpers); this module turns it into a root lookup and folds a ranked list of
 * hits so a family occupies one row.
 *
 * Pure and dependency-free on purpose: session-index.ts owns the index and the
 * session cache, this stays importable from tests without either.
 */

/** How far up a parent chain to walk before giving up (cycles are guarded
 *  separately; this bounds a pathological depth). */
const DEPTH_CAP = 8;

export interface FamilyMember {
	id: string;
	parentSessionId?: string;
	/** Attribution link for internal helper sessions. */
	spawnedBy?: string;
}

/** sessionId → parent sessionId, skipping self-links. */
export function parentLinks(sessions: FamilyMember[]): Map<string, string> {
	const parents = new Map<string, string>();
	for (const s of sessions) {
		const p = s.parentSessionId || s.spawnedBy;
		if (p && p !== s.id) parents.set(s.id, p);
	}
	return parents;
}

/** The oldest ancestor of `id`: the session a human should open. */
export function familyRoot(id: string, parents: Map<string, string>): string {
	let cur = id;
	const seen = new Set([cur]);
	for (let i = 0; i < DEPTH_CAP; i++) {
		const next = parents.get(cur);
		// An unindexed or deleted parent still roots the family: the id is the
		// link, whether or not that session is in the list we were handed.
		if (!next || seen.has(next)) break;
		cur = next;
		seen.add(next);
	}
	return cur;
}

export interface Foldable {
	/** Record id, `session:<id>` or a bare session id. */
	id: string;
}

export type Folded<T extends Foldable> = T & {
	/** Family root, when this record came from a spawned sub-session. Absent
	 *  when the record IS the root. */
	rootId?: string;
	/** Other sessions of the same family that also matched, folded in here. */
	foldedIds?: string[];
};

/**
 * Collapse a best-first ranked list so each family appears once. The first
 * (best-scoring) member keeps its own text and score; later members are
 * recorded as `foldedIds` and dropped from the list.
 */
export function foldFamilies<T extends Foldable>(
	hits: T[],
	parents: Map<string, string>,
	limit: number,
): Folded<T>[] {
	const byRoot = new Map<string, Folded<T>>();
	const order: string[] = [];
	for (const hit of hits) {
		const id = bareSessionId(hit.id);
		const root = familyRoot(id, parents);
		const leader = byRoot.get(root);
		if (!leader) {
			byRoot.set(root, root === id ? { ...hit } : { ...hit, rootId: root });
			order.push(root);
			continue;
		}
		(leader.foldedIds ??= []).push(id);
	}
	return order.slice(0, limit).map((root) => byRoot.get(root)!);
}

export function bareSessionId(id: string): string {
	return id.replace(/^session:/, "");
}
