import { afterEach, describe, expect, test } from "bun:test";
import {
	allClients,
	computeGlobalPresence,
	revalidateLocalClients,
} from "./ws-hub";

const sockets = new Set<any>();

afterEach(() => {
	for (const socket of sockets) allClients.delete(socket);
	sockets.clear();
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
	const viewer = (user: string | null, at: number, away?: boolean) => ({
		data: { user, watchJoinedAt: at, away },
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

	test("anonymous viewers stay out — there's nobody to follow", () => {
		expect(
			computeGlobalPresence(
				watchers({ s: [viewer("Anonymous", 1), viewer(null, 2)] }),
			),
		).toEqual([]);
	});
});
