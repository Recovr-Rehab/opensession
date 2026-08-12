import {
	shareShippedVisualChange,
	shippedChangeChannels,
} from "../../agents/github/shipped-change-notify";
import { shippedChangesChannel } from "../../agents/github/constants";
import { findSession } from "../session-cache";
import { resolvePrTarget } from "../session-repos";
import { prHostFor } from "../pr-host";
import { getRepo } from "../worktree";
import { requestUser, type RouteContext } from "./context";

export async function handleShippedChangeRoutes(
	ctx: RouteContext,
): Promise<Response | undefined> {
	const { req, path } = ctx;
	const match = path.match(/^\/api\/sessions\/([^/]+)\/share-shipped-change$/);
	if (!match || (req.method !== "GET" && req.method !== "POST")) return;
	const session = findSession(decodeURIComponent(match[1]));
	if (!session)
		return Response.json({ error: "Session not found" }, { status: 404 });
	if (req.method === "GET") {
		return Response.json({
			channels: shippedChangeChannels(),
			defaultChannel: shippedChangesChannel(),
		});
	}
	const body = await req.json().catch(() => ({}));
	const caller = ctx.authUser?.login || ctx.authUser?.name || requestUser(ctx, body?.user);
	const { mcpUserGrantToken } = await import("../mcp-oauth");
	const slackToken = caller ? mcpUserGrantToken("slack", caller) : undefined;
	const target = resolvePrTarget(session, body?.repo, body?.branch);
	if (!target)
		return Response.json({ error: "Pull request target not found" }, { status: 404 });
	const repo = getRepo(target.repoId);
	const pr = await prHostFor(repo).getPrDetails(target.branch, target.ghRepo);
	if (!pr)
		return Response.json({ error: "Pull request not found" }, { status: 404 });
	if (pr.state !== "MERGED")
		return Response.json(
			{ error: "Share to Slack is available after the pull request merges" },
			{ status: 409 },
		);

	try {
		return Response.json(
			await shareShippedVisualChange({
				session,
				pr: { number: pr.number, title: pr.title, url: pr.url },
				repoFullName: target.ghRepo,
				requestedBy: requestUser(ctx, body?.user),
				channel: body?.channel,
				message: body?.message,
				slackToken,
			}),
		);
	} catch (error: any) {
		return Response.json(
			{ error: error?.message || "Couldn't share the shipped update" },
			{ status: 502 },
		);
	}
}
