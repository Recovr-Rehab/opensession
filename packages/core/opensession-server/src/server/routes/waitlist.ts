/** Website waitlist ingestion and its admin-only Settings reader. */
import { addToWaitlist, listWaitlist, waitlistSlackChannel } from "../waitlist";
import { requireWorkspaceAdmin } from "../workspace-auth";
import type { RouteContext } from "./context";

export async function handleWaitlistRoutes(
	ctx: RouteContext,
): Promise<Response | undefined> {
	const { req, path } = ctx;
	if (path !== "/api/waitlist") return undefined;

	// Public by design: this is the landing page's one form. Only this method is
	// exempted from web auth in opensession.ts. The list below stays protected.
	if (req.method === "POST") {
		const contentLength = Number(req.headers.get("content-length") || 0);
		if (contentLength > 4_096) {
			return Response.json({ error: "Request is too large" }, { status: 413 });
		}
		const body = (await req.json().catch(() => null)) as {
			email?: unknown;
		} | null;
		try {
			const result = await addToWaitlist(body?.email);
			return Response.json({ ok: true, duplicate: result.duplicate });
		} catch (error: any) {
			return Response.json(
				{ error: error?.message || "Enter a valid email address" },
				{ status: 400 },
			);
		}
	}

	if (req.method === "GET") {
		const denied = requireWorkspaceAdmin(ctx);
		if (denied) return denied;
		return Response.json({
			entries: listWaitlist(),
			slackChannel: waitlistSlackChannel()?.name || null,
		});
	}

	return new Response(null, {
		status: 405,
		headers: { Allow: "GET, POST" },
	});
}
