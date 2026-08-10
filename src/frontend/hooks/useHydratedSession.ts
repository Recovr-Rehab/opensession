import { useEffect, useState } from "react";
import { fetchSession } from "../lib/api";
import type { UnifiedSession } from "../lib/types";

/**
 * The whole session behind the open route, when the list can't supply it.
 *
 * The polled list is the live slice now, and the archived index that fills the
 * gap carries summaries (`slim`). So two ordinary things leave the app holding
 * either nothing or not enough: opening a session from Archived, and having
 * the session you are reading archived out from under you by someone else.
 * Both used to be impossible, because the list carried every session in full.
 *
 * Resolves aliases the same way the list lookup does, so an old link keeps
 * working. A 404 — deleted session, stale link — leaves this null rather than
 * retrying: the caller already renders "not found" for a route it can't
 * resolve.
 */
export function useHydratedSession(
	sessionId: string | null,
	fromList: UnifiedSession | null,
): UnifiedSession | null {
	const [hydrated, setHydrated] = useState<UnifiedSession | null>(null);
	const needed = !!sessionId && (!fromList || fromList.slim === true);
	const have =
		hydrated &&
		sessionId &&
		(hydrated.id === sessionId || hydrated.aliasIds?.includes(sessionId))
			? hydrated
			: null;

	useEffect(() => {
		if (!needed || !sessionId || have) return;
		const controller = new AbortController();
		void fetchSession(sessionId, { signal: controller.signal })
			.then((session) => {
				if (session) setHydrated(session);
			})
			.catch(() => {
				// Offline or a server hiccup. The list poll is still running and
				// may yet produce the session; nothing here should throw the
				// route away over one failed request.
			});
		return () => controller.abort();
	}, [needed, sessionId, have]);

	if (!sessionId) return null;
	// A full row from the list always wins: it is the one the poll keeps fresh,
	// where a hydrated copy is a snapshot from whenever it was fetched.
	if (fromList && !fromList.slim) return fromList;
	return have ?? fromList;
}
