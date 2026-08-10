/** Per-session sandbox status and explicit lifecycle controls. */

import { audit } from "../audit";
import { hostRunBusy } from "../host-registry";
import { getSandboxProvider } from "../sandbox";
import { findSession, touchNativeSession } from "../session-cache";
import type { RouteContext } from "./context";

async function sandboxView(session: NonNullable<ReturnType<typeof findSession>>) {
	const recorded = session.sandbox;
	if (!recorded?.provider)
		return { enabled: false, status: "none" as const };
	if (!recorded.sandboxId) {
		return {
			enabled: true,
			provider: recorded.provider,
			workspace: recorded.workspace,
			status: "gone" as const,
			materialized: false,
		};
	}
	const provider = getSandboxProvider(recorded.provider);
	const sandbox = await provider.get(recorded.sandboxId);
	const status = sandbox ? await sandbox.status() : "gone";
	let logs: { setup?: string; resume?: string } | undefined;
	if (sandbox && status === "running") {
		const read = async (suffix: "setup" | "resume") => {
			const result = await sandbox.exec([
				"sh",
				"-c",
				`f=$(find /home/ubuntu/.opensession/lifecycle -maxdepth 1 -name '*-${suffix}.log' -type f 2>/dev/null | head -1); [ -z "$f" ] || tail -c 12000 "$f"`,
			]);
			return result.exitCode === 0 && result.stdout ? result.stdout : undefined;
		};
		logs = { setup: await read("setup"), resume: await read("resume") };
	}
	return {
		enabled: true,
		provider: recorded.provider,
		sandboxId: recorded.sandboxId,
		workspace: recorded.workspace,
		status,
		materialized: status !== "gone",
		busy: hostRunBusy(session.id),
		cwd: sandbox?.cwd || session.worktreeDir || null,
		canPause: Boolean(provider.pause),
		canResume: Boolean(provider.resume),
		logs,
	};
}

export async function handleSandboxRoutes(
	ctx: RouteContext,
): Promise<Response | undefined> {
	const match = ctx.path.match(
		/^\/api\/sessions\/([^/]+)\/sandbox(?:\/(pause|resume|recreate))?$/,
	);
	if (!match) return undefined;
	const session = findSession(decodeURIComponent(match[1]!));
	if (!session)
		return Response.json({ error: "Session not found" }, { status: 404 });
	const action = match[2];
	if (!action && ctx.req.method === "GET") {
		try {
			return Response.json(await sandboxView(session));
		} catch (error) {
			return Response.json(
				{ error: error instanceof Error ? error.message : String(error) },
				{ status: 500 },
			);
		}
	}
	if (!action || ctx.req.method !== "POST") return undefined;
	const recorded = session.sandbox;
	if (!recorded?.provider || !recorded.sandboxId)
		return Response.json({ error: "Session has no materialized sandbox" }, { status: 400 });
	if (hostRunBusy(session.id))
		return Response.json(
			{ error: "Sandbox lifecycle is locked while the agent is running" },
			{ status: 409 },
		);
	const provider = getSandboxProvider(recorded.provider);
	try {
		if (action === "pause") {
			if (!provider.pause)
				return Response.json(
					{ error: `${recorded.provider} does not expose manual pause` },
					{ status: 400 },
				);
			await provider.pause(recorded.sandboxId);
		} else if (action === "resume") {
			if (!provider.resume)
				return Response.json(
					{ error: `${recorded.provider} does not expose manual resume` },
					{ status: 400 },
				);
			await provider.resume(recorded.sandboxId);
		} else {
			const body = (await ctx.req.json().catch(() => ({}))) as {
				confirm?: boolean;
			};
			if (body.confirm !== true)
				return Response.json(
					{ error: "Recreate deletes unpushed sandbox workspace data; confirm is required" },
					{ status: 400 },
				);
			await provider.destroy(recorded.sandboxId);
			const recreated = await provider.ensure({
				sessionId: session.id,
				repo: session.repo,
				branch: session.branch || undefined,
				mode: session.mode,
				cwd: session.worktreeDir || undefined,
			});
			touchNativeSession(session.id, {
				sandbox: {
					...recorded,
					sandboxId: recreated.id,
					workspace: recreated.workspace,
				},
			});
		}
		audit({
			msg: `sandbox_${action}`,
			session_id: session.id,
			sandbox_id: recorded.sandboxId,
			provider: recorded.provider,
		});
		return Response.json(await sandboxView(findSession(session.id) || session));
	} catch (error) {
		return Response.json(
			{ error: error instanceof Error ? error.message : String(error) },
			{ status: 500 },
		);
	}
}
