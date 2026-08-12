/** Workspace Runner registration, policy, reservation, and revocation routes. */

import { audit } from "../audit";
import { disconnectRunner, isRunnerConnected } from "../runner-ws";
import {
	createRunnerPairing,
	isTailnetAddress,
	listRunnerPairings,
	listRunners,
	publicRunner,
	registerRunner,
	releaseRunnerReservation,
	removeRunner,
	reserveRunner,
	touchRunner,
	updateRunner,
	authenticateRunner,
	type RunnerPlatform,
} from "../runners";
import { requestUser, type RouteContext } from "./context";

function peerAddress(ctx: RouteContext): string {
	const server = (globalThis as any).__opensessionServer as { requestIP?(req: Request): { address: string } | null } | undefined;
	const direct = server?.requestIP?.(ctx.req)?.address ?? "";
	if (["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(direct)) {
		const hops = ctx.req.headers.get("x-forwarded-for")?.split(",").map((value) => value.trim()).filter(Boolean);
		if (hops?.length) return hops.at(-1)!;
	}
	return direct;
}

function publicView() {
	return listRunners().map((runner) => publicRunner(runner, isRunnerConnected(runner.id)));
}

export async function handleRunnersRoutes(ctx: RouteContext): Promise<Response | undefined> {
	const { path, req } = ctx;
	if (path === "/api/runners" && req.method === "GET") return Response.json({ runners: publicView() });
	if (path === "/api/runners/pair" && req.method === "POST") {
		const pairing = createRunnerPairing(requestUser(ctx) || undefined);
		audit({ msg: "runner_pairing_created", user: requestUser(ctx), pending: listRunnerPairings().length });
		return Response.json({ ...pairing, pending: listRunnerPairings().length });
	}
	if (path === "/api/runners/register" && req.method === "POST") {
		const body = await req.json().catch(() => null) as Record<string, unknown> | null;
		if (!body) return Response.json({ error: "Invalid JSON" }, { status: 400 });
		const platform = String(body.platform ?? "");
		if (!(["darwin", "linux", "win32"] as const).includes(platform as RunnerPlatform)) return Response.json({ error: "Unsupported Runner platform" }, { status: 400 });
		const result = registerRunner({
			code: String(body.code ?? ""), name: String(body.name ?? ""), platform: platform as RunnerPlatform,
			arch: String(body.arch ?? "unknown"), capabilities: body.capabilities as any, resources: body.resources as any,
			label: typeof body.label === "string" ? body.label : undefined,
			description: typeof body.description === "string" ? body.description : undefined,
			softwareVersion: typeof body.softwareVersion === "string" ? body.softwareVersion : undefined,
			address: peerAddress(ctx),
		});
		if (!result.ok) return Response.json({ error: result.error }, { status: 403 });
		audit({ msg: "runner_registered", runner_id: result.runner.id, name: result.runner.name, address: result.runner.address });
		return Response.json({ runner: publicRunner(result.runner, false), token: result.token });
	}
	if (path === "/api/runners/heartbeat" && req.method === "POST") {
		const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/, "");
		const id = req.headers.get("x-opensession-runner") ?? "";
		if (!authenticateRunner(id, token)) return Response.json({ error: "Unauthorized" }, { status: 401 });
		if (!isTailnetAddress(peerAddress(ctx))) return Response.json({ error: "Not on the tailnet" }, { status: 403 });
		const body = await req.json().catch(() => ({})) as Record<string, unknown>;
		touchRunner(id, { capabilities: body.capabilities as any, resources: body.resources as any, softwareVersion: typeof body.softwareVersion === "string" ? body.softwareVersion : undefined });
		return Response.json({ ok: true });
	}
	const match = path.match(/^\/api\/runners\/(runner-[^/]+)(?:\/(reserve|release))?$/);
	if (!match) return undefined;
	const [, id, action] = match;
	if (!action && req.method === "PATCH") {
		const body = await req.json().catch(() => null) as Record<string, unknown> | null;
		if (!body) return Response.json({ error: "Invalid JSON" }, { status: 400 });
		const runner = updateRunner(id, body as any);
		if (!runner) return Response.json({ error: "Runner not found" }, { status: 404 });
		audit({ msg: "runner_updated", runner_id: id, user: requestUser(ctx) });
		return Response.json({ runner: publicRunner(runner, isRunnerConnected(id)) });
	}
	if (!action && req.method === "DELETE") {
		if (!removeRunner(id)) return Response.json({ error: "Runner not found" }, { status: 404 });
		const disconnected = disconnectRunner(id);
		audit({ msg: "runner_revoked", runner_id: id, user: requestUser(ctx), disconnected });
		return Response.json({ ok: true, disconnected });
	}
	if (action === "reserve" && req.method === "POST") {
		const body = await req.json().catch(() => ({})) as Record<string, unknown>;
		const runner = reserveRunner(id, { reason: String(body.reason ?? "Session work"), sessionId: typeof body.sessionId === "string" ? body.sessionId : undefined, reservedBy: requestUser(ctx) || undefined, durationMinutes: typeof body.durationMinutes === "number" ? body.durationMinutes : undefined });
		if (!runner) return Response.json({ error: "Runner is unavailable or already reserved" }, { status: 409 });
		audit({ msg: "runner_reserved", runner_id: id, user: requestUser(ctx), session_id: runner.reservation?.sessionId });
		return Response.json({ runner: publicRunner(runner, isRunnerConnected(id)) });
	}
	if (action === "release" && req.method === "POST") {
		const runner = releaseRunnerReservation(id, requestUser(ctx) || undefined);
		if (!runner) return Response.json({ error: "Runner reservation cannot be released" }, { status: 409 });
		audit({ msg: "runner_reservation_released", runner_id: id, user: requestUser(ctx) });
		return Response.json({ runner: publicRunner(runner, isRunnerConnected(id)) });
	}
	return undefined;
}
