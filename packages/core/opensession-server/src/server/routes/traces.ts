/**
 * Per-user Traces connect (GitHub device login) and status.
 * Publishing uses the stored device token; these routes never return it.
 */
import { type RouteContext } from "./context";
import { webAuthRequired } from "../web-auth";
import { tracesBin, tracesNamespaceSlug } from "../../agents/traces/config";
import {
  disconnectTracesAccount,
  listTracesAccounts,
  pollTracesConnect,
  startTracesConnect,
  tracesAccountForLogin,
  tracesConnectResult,
  watchTracesConnect,
} from "../../agents/traces/auth";

function expectedLogin(ctx: RouteContext): string | undefined {
  return ctx.authUser?.login || undefined;
}

export async function handleTracesRoutes(ctx: RouteContext): Promise<Response | undefined> {
  const { req, path } = ctx;
  if (!path.startsWith("/api/traces/")) return undefined;

  if (path === "/api/traces/status" && req.method === "GET") {
    const login = expectedLogin(ctx);
    const me = login ? tracesAccountForLogin(login) : null;
    return Response.json({
      cliPresent: Boolean(Bun.which(tracesBin())),
      namespaceSlug: tracesNamespaceSlug(),
      me,
      accounts: webAuthRequired() ? (me ? [me] : []) : listTracesAccounts(),
    });
  }

  if (path === "/api/traces/connect" && req.method === "POST") {
    if (webAuthRequired() && !ctx.authUser?.login) {
      return Response.json({ error: "Sign in to connect Traces as yourself" }, { status: 403 });
    }
    const result = await startTracesConnect();
    if ("error" in result) return Response.json(result, { status: 400 });
    watchTracesConnect(result, expectedLogin(ctx));
    return Response.json(result);
  }

  if (path === "/api/traces/connect/poll" && req.method === "POST") {
    if (webAuthRequired() && !ctx.authUser?.login) {
      return Response.json({ error: "Sign in to connect Traces as yourself" }, { status: 403 });
    }
    const body = (await req.json().catch(() => null)) as { state?: string } | null;
    const state = typeof body?.state === "string" ? body.state : "";
    if (!state) return Response.json({ error: "state required" }, { status: 400 });
    const parked = tracesConnectResult(state);
    if (parked.status !== "pending") return Response.json(parked);
    const result = await pollTracesConnect(state, expectedLogin(ctx));
    return Response.json(result);
  }

  if (path === "/api/traces/connect" && req.method === "DELETE") {
    const login = expectedLogin(ctx);
    const fallback = !login && !webAuthRequired() ? listTracesAccounts() : [];
    const target = login || (fallback.length === 1 ? fallback[0].githubLogin : "");
    if (!target) {
      return Response.json({ error: "Sign in to disconnect Traces" }, { status: 403 });
    }
    const ok = disconnectTracesAccount(target);
    return Response.json({ ok });
  }

  return undefined;
}
