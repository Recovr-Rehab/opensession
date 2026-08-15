import { describe, expect, test } from "bun:test";
import { Api } from "../src/client/api";
import { fakeSession } from "./fakes";

/**
 * A server that ETags the sessions list the way ours does, and answers a
 * request carrying the matching validator with a 304 and no body.
 */
function etagServer(etag = '"v1"') {
	const calls: { conditional: boolean }[] = [];
	let current = etag;
	let sessions = [fakeSession()];
	const fetcher = (async (_input: RequestInfo | URL, init?: RequestInit) => {
		const asked = new Headers(init?.headers as HeadersInit).get("if-none-match");
		calls.push({ conditional: asked !== null });
		if (asked === current) {
			return new Response(null, { status: 304, headers: { etag: current } });
		}
		return new Response(JSON.stringify(sessions), {
			status: 200,
			headers: { "content-type": "application/json", etag: current },
		});
	}) as typeof fetch;
	return {
		calls,
		fetcher,
		change(next: typeof sessions, tag: string) {
			sessions = next;
			current = tag;
		},
	};
}

describe("the sessions list revalidates", () => {
	test("the first read is plain, the next one carries the validator", async () => {
		const server = etagServer();
		const api = new Api("http://host", "token", server.fetcher);

		await api.sessions();
		await api.sessions();

		expect(server.calls.map((c) => c.conditional)).toEqual([false, true]);
	});

	test("a 304 answers with the body we already had", async () => {
		const server = etagServer();
		const api = new Api("http://host", "token", server.fetcher);

		const first = await api.sessions();
		const second = await api.sessions();

		expect(second).toEqual(first);
		expect(second.length).toBe(1);
	});

	test("a list that really changed still arrives", async () => {
		const server = etagServer();
		const api = new Api("http://host", "token", server.fetcher);

		await api.sessions();
		server.change([fakeSession({ id: "s-2" }), fakeSession({ id: "s-3" })], '"v2"');
		const next = await api.sessions();

		expect(next.map((s) => s.id)).toEqual(["s-2", "s-3"]);
	});

	test("a new token asks plainly again", async () => {
		const server = etagServer();
		const api = new Api("http://host", "token", server.fetcher);

		await api.sessions();
		api.setToken("someone-else");
		await api.sessions();

		expect(server.calls.map((c) => c.conditional)).toEqual([false, false]);
	});

	test("a server that sends no ETag is never asked conditionally", async () => {
		const calls: { conditional: boolean }[] = [];
		const fetcher = (async (_input: RequestInfo | URL, init?: RequestInit) => {
			const asked = new Headers(init?.headers as HeadersInit).get("if-none-match");
			calls.push({ conditional: asked !== null });
			return new Response(JSON.stringify([fakeSession()]), {
				status: 200,
				headers: { "content-type": "application/json" },
			});
		}) as typeof fetch;
		const api = new Api("http://host", "token", fetcher);

		await api.sessions();
		await api.sessions();

		expect(calls.map((c) => c.conditional)).toEqual([false, false]);
	});
});
