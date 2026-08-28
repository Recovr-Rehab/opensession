/**
 * Featurebase routes used by the ticket and post workspace panes.
 * Human-gated — agent runs never see these as tools.
 */
import { requestUser, type RouteContext } from "./context";
import { listAutomations, runAutomation } from "../automations";
import { getCachedSessionsAsync, invalidateSessionsCache } from "../session-cache";
import { TICKET_CREATED, POST_CREATED } from "../../agents/featurebase/handlers";

async function existingLinkedSession(
  kind: string,
  id: string,
): Promise<string | null> {
  const existing = (await getCachedSessionsAsync())
    .filter(
      (s) =>
        !s.archived &&
        (s.externalRefs || []).some((ref) => ref.kind === kind && ref.id === id),
    )
    .sort(
      (a, b) =>
        new Date(b.lastActivity).getTime() - new Date(a.lastActivity).getTime(),
    )[0];
  return existing ? existing.id : null;
}

async function startEventAutomation(
  eventKey: string,
  payload: Record<string, unknown>,
): Promise<string | null> {
  const automation = listAutomations().find((a) => a.eventKey === eventKey);
  if (!automation) return null;
  return new Promise<string | null>((resolve) => {
    const timer = setTimeout(() => resolve(null), 120_000);
    void runAutomation(
      automation,
      (id) => {
        invalidateSessionsCache();
        clearTimeout(timer);
        resolve(id);
      },
      {
        trigger: "event",
        eventContext: JSON.stringify(payload, null, 2),
      },
    );
  });
}

export async function handleFeaturebaseRoutes(
  ctx: RouteContext,
): Promise<Response | undefined> {
  const { req, path } = ctx;

  if (path === "/api/featurebase/status" && req.method === "GET") {
    try {
      const { connectionStatus } = await import("../../agents/featurebase/api");
      return Response.json(await connectionStatus());
    } catch (error: any) {
      return Response.json(
        { ok: false, error: error?.message || "Featurebase lookup failed" },
        { status: error?.status && error.status < 500 ? error.status : 502 },
      );
    }
  }

  if (path === "/api/featurebase/admins" && req.method === "GET") {
    try {
      const { listAdmins } = await import("../../agents/featurebase/api");
      return Response.json({ admins: await listAdmins() });
    } catch (error: any) {
      return Response.json(
        { error: error?.message || "Featurebase lookup failed" },
        { status: error?.status && error.status < 500 ? error.status : 502 },
      );
    }
  }

  const ticketMatch = path.match(/^\/api\/featurebase\/tickets\/([^/]+)(?:\/([^/]+))?$/);
  if (ticketMatch && req.method === "GET" && !ticketMatch[2]) {
    const id = decodeURIComponent(ticketMatch[1]);
    try {
      const { getTicket } = await import("../../agents/featurebase/api");
      const ticket = await getTicket(id);
      if (!ticket) return Response.json({ error: "Ticket not found" }, { status: 404 });
      return Response.json({ ticket });
    } catch (error: any) {
      console.error(`[featurebase] Ticket lookup failed for ${id}:`, error);
      return Response.json(
        { error: error?.message || "Featurebase lookup failed" },
        { status: error?.status && error.status < 500 ? error.status : 502 },
      );
    }
  }

  if (ticketMatch && ticketMatch[2] === "reply" && req.method === "POST") {
    const id = decodeURIComponent(ticketMatch[1]);
    const body = (await req.json().catch(() => null)) as {
      text?: string;
      kind?: string;
      user?: string;
    } | null;
    const text = typeof body?.text === "string" ? body.text.trim() : "";
    const kind = body?.kind === "note" ? "note" : "reply";
    if (!text) return Response.json({ error: "Empty message" }, { status: 400 });
    const senderName = requestUser(ctx, body?.user);
    const firstName = senderName.split(/\s+/)[0] || "";
    try {
      const { getTicket, replyToTicket } = await import("../../agents/featurebase/api");
      const ticket = await getTicket(id);
      if (!ticket) return Response.json({ error: "Ticket not found" }, { status: 404 });
      const signed =
        kind === "note"
          ? firstName
            ? `${senderName} (via Open Session):\n\n${text}`
            : text
          : firstName && !new RegExp(`\\b${firstName}\\b`, "i").test(text)
            ? `${text}\n\n— ${firstName}`
            : text;
      await replyToTicket(ticket, signed, kind);
      const { invalidateFeedCache } = await import("../feeds");
      invalidateFeedCache("featurebase-tickets");
      return Response.json({ ok: true });
    } catch (error: any) {
      console.error(`[featurebase] Reply failed for ${id}:`, error);
      return Response.json(
        { error: error?.message || "Featurebase reply failed" },
        { status: error?.status && error.status < 500 ? error.status : 502 },
      );
    }
  }

  if (ticketMatch && ticketMatch[2] === "triage" && req.method === "POST") {
    const id = decodeURIComponent(ticketMatch[1]);
    const existing = await existingLinkedSession("featurebase-ticket", id);
    if (existing) return Response.json({ sessionId: existing });
    try {
      const { getTicket } = await import("../../agents/featurebase/api");
      const ticket = await getTicket(id);
      const sessionId = await startEventAutomation(TICKET_CREATED, {
        source: "featurebase",
        topic: "ticket.created",
        ticketId: id,
        ticketNumber: ticket?.ticketNumber ?? null,
        title: ticket?.title ?? null,
        ticketUrl: ticket?.url ?? null,
        preview: ticket?.preview ?? null,
      });
      if (!sessionId) {
        return Response.json(
          { error: "No Featurebase ticket triage automation is enabled" },
          { status: 404 },
        );
      }
      return Response.json({ sessionId });
    } catch (error: any) {
      console.error(`[featurebase] Triage failed for ${id}:`, error);
      return Response.json(
        { error: error?.message || "Triage failed" },
        { status: 502 },
      );
    }
  }

  const postMatch = path.match(/^\/api\/featurebase\/posts\/([^/]+)(?:\/([^/]+))?$/);
  if (postMatch && req.method === "GET" && !postMatch[2]) {
    const id = decodeURIComponent(postMatch[1]);
    try {
      const { getPost } = await import("../../agents/featurebase/api");
      const post = await getPost(id);
      if (!post) return Response.json({ error: "Post not found" }, { status: 404 });
      return Response.json({ post });
    } catch (error: any) {
      console.error(`[featurebase] Post lookup failed for ${id}:`, error);
      return Response.json(
        { error: error?.message || "Featurebase lookup failed" },
        { status: error?.status && error.status < 500 ? error.status : 502 },
      );
    }
  }

  if (postMatch && postMatch[2] === "comment" && req.method === "POST") {
    const id = decodeURIComponent(postMatch[1]);
    const body = (await req.json().catch(() => null)) as {
      text?: string;
      private?: boolean;
      user?: string;
    } | null;
    const text = typeof body?.text === "string" ? body.text.trim() : "";
    if (!text) return Response.json({ error: "Empty comment" }, { status: 400 });
    const senderName = requestUser(ctx, body?.user);
    const firstName = senderName.split(/\s+/)[0] || "";
    const signed = firstName ? `${senderName} (via Open Session):\n\n${text}` : text;
    try {
      const { commentOnPost } = await import("../../agents/featurebase/api");
      await commentOnPost(id, signed, body?.private !== false);
      const { invalidateFeedCache } = await import("../feeds");
      invalidateFeedCache("featurebase-posts");
      return Response.json({ ok: true });
    } catch (error: any) {
      console.error(`[featurebase] Comment failed for ${id}:`, error);
      return Response.json(
        { error: error?.message || "Featurebase comment failed" },
        { status: error?.status && error.status < 500 ? error.status : 502 },
      );
    }
  }

  if (postMatch && postMatch[2] === "triage" && req.method === "POST") {
    const id = decodeURIComponent(postMatch[1]);
    const existing = await existingLinkedSession("featurebase-post", id);
    if (existing) return Response.json({ sessionId: existing });
    try {
      const { getPost } = await import("../../agents/featurebase/api");
      const post = await getPost(id);
      const sessionId = await startEventAutomation(POST_CREATED, {
        source: "featurebase",
        topic: "post.created",
        postId: id,
        title: post?.title ?? null,
        postUrl: post?.url ?? null,
        preview: post?.preview ?? null,
      });
      if (!sessionId) {
        return Response.json(
          { error: "No Featurebase post triage automation is enabled" },
          { status: 404 },
        );
      }
      return Response.json({ sessionId });
    } catch (error: any) {
      console.error(`[featurebase] Post triage failed for ${id}:`, error);
      return Response.json(
        { error: error?.message || "Triage failed" },
        { status: 502 },
      );
    }
  }

  return undefined;
}
