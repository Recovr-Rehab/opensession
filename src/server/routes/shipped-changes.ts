import {
	shareShippedVisualChange,
	shippedChangeChannels,
} from "../../agents/github/shipped-change-notify";
import { shippedChangesChannel } from "../../agents/github/constants";
import { findSession } from "../session-cache";
import { getSessionControl } from "../session-control";
import { resolvePrTarget } from "../session-repos";
import { prHostFor } from "../pr-host";
import { getRepo } from "../worktree";
import { publishWalkthrough } from "../walkthrough";
import { transcriptStore } from "../transcript-store";
import { latestFeaturedScreenshot } from "../../shared/shipped-change-media";
import { requestUser, type RouteContext } from "./context";
import type { CreateSessionOpts } from "../session-control";

const screenshotRequests: Map<string, string> =
	((globalThis as any).__osShippedScreenshotRequests ??= new Map());

const SCREENSHOT_PROMPT = `Capture a clear after screenshot of the user-visible change from the merged pull request represented by your current branch. Verify the real UI first. Do not change product code unless the screenshot reveals a regression. Publish a walkthrough on this session with the after screenshot and a concise outcome-focused summary. This is background proof work: do not create or send a message to another session.`;

export function shippedScreenshotWorkerOpts(
	sessionId: string,
	caller: string,
): CreateSessionOpts {
	return {
		prompt: SCREENSHOT_PROMPT,
		forkFrom: { sourceId: sessionId },
		parentSessionId: sessionId,
		spawnedBy: sessionId,
		reportBack: false,
		user: caller,
	};
}

async function transferScreenshotWhenReady(parentId: string, workerId: string) {
	const deadline = Date.now() + 30 * 60_000;
	while (Date.now() < deadline) {
		await Bun.sleep(2_000);
		const walkthrough = findSession(workerId)?.walkthrough;
		if (!walkthrough?.shots?.some((shot) => shot.after)) continue;
		try {
			const existing = findSession(parentId)?.walkthrough;
			await publishWalkthrough(
				parentId,
				{
					summary: existing?.summary || walkthrough.summary,
					video: existing?.video || walkthrough.video,
					videoTitle: existing?.videoTitle || walkthrough.videoTitle,
					shots: [...(existing?.shots || []), ...(walkthrough.shots || [])],
				},
				walkthrough.publishedBy,
			);
		} catch (error) {
			console.error(`[shipped-change] transfer screenshot from ${workerId} failed:`, error);
		} finally {
			screenshotRequests.delete(parentId);
		}
		return;
	}
	screenshotRequests.delete(parentId);
}

export async function handleShippedChangeRoutes(
	ctx: RouteContext,
): Promise<Response | undefined> {
	const { req, path } = ctx;
	const screenshotMatch = path.match(
		/^\/api\/sessions\/([^/]+)\/request-shipped-screenshot$/,
	);
	if (screenshotMatch && req.method === "POST") {
		const sessionId = decodeURIComponent(screenshotMatch[1]);
		const session = findSession(sessionId);
		if (!session)
			return Response.json({ error: "Session not found" }, { status: 404 });
		if (!session.branch)
			return Response.json(
				{ error: "This session has no branch to verify" },
				{ status: 409 },
			);
		const existing = screenshotRequests.get(sessionId);
		if (existing)
			return Response.json({ status: "capturing", workerSessionId: existing });

		const body = await req.json().catch(() => ({}));
		const caller = requestUser(ctx, body?.user);
		const { id } = await getSessionControl().createSession(
			shippedScreenshotWorkerOpts(session.id, caller),
		);
		screenshotRequests.set(sessionId, id);
		void transferScreenshotWhenReady(sessionId, id);
		return Response.json({ status: "capturing", workerSessionId: id });
	}
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
				featuredScreenshot: latestFeaturedScreenshot(
					transcriptStore().readTail(session.id, 200).entries,
				),
			}),
		);
	} catch (error: any) {
		return Response.json(
			{ error: error?.message || "Couldn't share the shipped update" },
			{ status: 502 },
		);
	}
}
