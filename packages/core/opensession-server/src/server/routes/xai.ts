/**
 * Connect, inspect and disconnect the ONE shared xAI (Grok) subscription.
 *
 * There is nothing per-person here, unlike the Claude and Codex account pools:
 * every session in the workspace runs on the same credential, so connecting or
 * replacing it changes what everyone can run — which is why the mutating
 * routes are workspace-admin only. Status stays readable by any signed-in
 * teammate so the picker can explain why Grok is absent.
 *
 * Tokens never leave xai-oauth.ts; xaiStatus() plus the viewer's own
 * authority is the whole of what these routes return.
 */
import { type RouteContext } from "./context";
import {
  requireWorkspaceAdmin,
  workspaceAdminAuthorized,
} from "../workspace-auth";
import {
  cancelXaiLogin,
  disconnectXai,
  pollXaiLogin,
  startXaiLogin,
  xaiStatus,
} from "../xai-oauth";

export async function handleXaiRoutes(
  ctx: RouteContext,
): Promise<Response | undefined> {
  const { req, path } = ctx;
  if (!path.startsWith("/api/xai/")) return undefined;

  if (path === "/api/xai/status" && req.method === "GET") {
    // canManage rides along so the Settings card can hide actions it would
    // only be refused for; the gate below is still what enforces it.
    return Response.json({
      ...xaiStatus(),
      canManage: workspaceAdminAuthorized(ctx),
    });
  }

  if (path === "/api/xai/connect" && req.method === "POST") {
    const forbidden = requireWorkspaceAdmin(ctx);
    if (forbidden) return forbidden;
    // The connector's GitHub login is stored for display only - authority
    // for this route came from requireWorkspaceAdmin above.
    const result = await startXaiLogin(ctx.authUser?.login);
    if ("error" in result) return Response.json(result, { status: 400 });
    return Response.json(result);
  }

  if (path === "/api/xai/connect/poll" && req.method === "POST") {
    const forbidden = requireWorkspaceAdmin(ctx);
    if (forbidden) return forbidden;
    const body = (await req.json().catch(() => null)) as {
      flowId?: string;
    } | null;
    const flowId = typeof body?.flowId === "string" ? body.flowId : "";
    if (!flowId) {
      return Response.json({ error: "flowId required" }, { status: 400 });
    }
    return Response.json(pollXaiLogin(flowId));
  }

  if (path === "/api/xai/connect/cancel" && req.method === "POST") {
    const forbidden = requireWorkspaceAdmin(ctx);
    if (forbidden) return forbidden;
    const body = (await req.json().catch(() => null)) as {
      flowId?: string;
    } | null;
    return Response.json({
      ok: cancelXaiLogin(typeof body?.flowId === "string" ? body.flowId : ""),
    });
  }

  if (path === "/api/xai/disconnect" && req.method === "POST") {
    const forbidden = requireWorkspaceAdmin(ctx);
    if (forbidden) return forbidden;
    return Response.json({ ok: await disconnectXai() });
  }

  return undefined;
}
