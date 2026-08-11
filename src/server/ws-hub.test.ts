import { afterEach, describe, expect, test } from "bun:test";
import {
	allClients,
	computeGlobalPresence,
	leaveSession,
	revalidateLocalClients,
	sessionWatchers,
} from "./ws-hub";

const sockets = new Set<any>();

afterEach(() => {
	for (const socket of sockets) allClients.delete(socket);
	sockets.clear();
	sessionWatchers.clear();
});

function socket(login?: string) {
	const closed: Array<[number, string]> = [];
	const value = {
		data: { authLogin: login, authUser: "Old", user: "Old" },
		close(code: number, reason: string) {
			closed.push([code, reason]);
		},
	};
	sockets.add(value);
	allClients.add(value);
	return { value, closed };
}

describe("revalidateLocalClients", () => {
	test("keeps and restamps only sockets owned by the verified login", () => {
		const current = socket("ada");
		const stale = socket("grace");
		const legacy = socket();

		expect(revalidateLocalClients({ login: "ada", name: "Ada" })).toBe(2);
		expect(current.closed).toEqual([]);
		expect(current.value.data.authUser).toBe("Ada");
		expect(current.value.data.user).toBe("Ada");
		expect(stale.closed).toEqual([[4001, "Hosted GitHub session expired"]]);
		expect(legacy.closed).toEqual([[4001, "Hosted GitHub session expired"]]);
	});

	test("closes every retained socket when the hosted session expires", () => {
		const first = socket("ada");
		const second = socket("ada");

		expect(revalidateLocalClients(null)).toBe(2);
		expect(first.closed).toHaveLength(1);
		expect(second.closed).toHaveLength(1);
	});
});

describe("computeGlobalPresence", () => {
	// Both stamps default to now: a face is earned by a live transport AND by
	// recent attention, so a fixture that let either lapse reads as gone.
	const viewer = (
		user: string | null,
		at: number,
		away?: boolean,
		activeAt = Date.now(),
	) => ({
		data: {
			user,
			watchJoinedAt: at,
			away,
			activeAt,
			lastSeenAt: Date.now(),
		},
	});
	const watchers = (entries: Record<string, any[]>) =>
		new Map(Object.entries(entries).map(([id, set]) => [id, new Set(set)]));

	test("one entry per person, at their most recent join", () => {
		expect(
			computeGlobalPresence(
				watchers({ old: [viewer("Ada", 1)], recent: [viewer("Ada", 2)] }),
			),
		).toEqual([{ user: "Ada", sessionId: "recent" }]);
	});

	test("an away socket claims nobody — the whole point of the flag", () => {
		expect(
			computeGlobalPresence(watchers({ left: [viewer("Ada", 1, true)] })),
		).toEqual([]);
	});

	test("a hidden tab can't outrank the visible one it joined after", () => {
		expect(
			computeGlobalPresence(
				watchers({
					looking: [viewer("Ada", 1)],
					// The tab she left open in the background, opened later.
					background: [viewer("Ada", 9, true)],
				}),
			),
		).toEqual([{ user: "Ada", sessionId: "looking" }]);
	});

	test("a focused window keeps claiming its owner while they read", () => {
		expect(
			computeGlobalPresence(
				watchers({
					// Reading is quiet work: a scroll a couple of minutes ago is
					// still "here now", and the client keeps saying so.
					reading: [viewer("Ada", 1, false, Date.now() - 2 * 60_000)],
				}),
			),
		).toEqual([{ user: "Ada", sessionId: "reading" }]);
	});

	test("a window left open stops claiming its owner once it goes quiet", () => {
		expect(
			computeGlobalPresence(
				watchers({
					// Frontmost and focused since this morning — a locked Mac still
					// reports both — but nothing has touched it: the watch survives,
					// the face does not.
					parked: [viewer("Ada", 1, false, Date.now() - 30 * 60_000)],
				}),
			),
		).toEqual([]);
	});

	test("a focused viewer disappears when its transport stops heartbeating", () => {
		expect(
			computeGlobalPresence(
				watchers({
					stale: [{
						data: {
							user: "Ada",
							watchJoinedAt: 1,
							away: false,
							activeAt: Date.now(),
							lastSeenAt: Date.now() - 5 * 60_000,
						},
					}],
				}),
			),
		).toEqual([]);
	});

	test("anonymous viewers stay out — there's nobody to follow", () => {
		expect(
			computeGlobalPresence(
				watchers({ s: [viewer("Anonymous", 1), viewer(null, 2)] }),
			),
		).toEqual([]);
	});

	test("disconnect cleanup removes the viewer from global presence", () => {
		const ws = {
			data: {
				watchingSessionId: "s",
				user: "Ada",
				watchJoinedAt: 1,
				activeAt: Date.now(),
				lastSeenAt: Date.now(),
			},
			send() {},
		};
		sessionWatchers.set("s", new Set([ws]));
		expect(computeGlobalPresence(sessionWatchers)).toHaveLength(1);

		leaveSession(ws);
		expect(computeGlobalPresence(sessionWatchers)).toEqual([]);
	});
});
