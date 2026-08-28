import type { AgentModule } from "../types";
import type { FeedProvider } from "../../server/feeds";
import { verifyFeaturebaseSignature } from "../../server/shared/signature";
import {
  MAX_WEBHOOK_BODY_BYTES,
  RequestBodyTooLargeError,
  readRequestTextWithinLimit,
  webhookBodyTooLargeResponse,
} from "../../server/shared/bounded-body";
import { handleFeaturebaseEvent, type FeaturebaseWebhookEvent } from "./handlers";
import { featurebaseOrgUrl, featurebaseWebhookSecret } from "./config";
import { formatPostContext, formatTicketContext, getPost, getTicket, listOpenTickets, listRecentPosts } from "./api";

const FEATUREBASE_BG = "#4f46e5";

function statusLane(type: string | null | undefined): string {
  const value = (type || "").toLowerCase();
  if (value === "reviewing") return "reviewing";
  if (value === "unstarted") return "unstarted";
  if (value === "active") return "active";
  if (value === "completed") return "completed";
  if (value === "canceled" || value === "cancelled") return "canceled";
  return "unstarted";
}

const STATUS_LANES = [
  { key: "reviewing", label: "In review", dot: "var(--yellow)" },
  { key: "unstarted", label: "Open", dot: "var(--blue)" },
  { key: "active", label: "Active", dot: "var(--accent)" },
  { key: "completed", label: "Completed", dot: "var(--green)" },
  { key: "canceled", label: "Canceled", dot: "var(--text-faint)" },
];

function ticketsFeed(): FeedProvider {
  const orgUrl = featurebaseOrgUrl();
  return {
    descriptor: {
      id: "featurebase-tickets",
      title: "Featurebase tickets",
      refKind: "featurebase-ticket",
      tileBg: FEATUREBASE_BG,
      mcpServers: ["featurebase-reader", "featurebase"],
      lanes: STATUS_LANES.filter((lane) => lane.key !== "completed" && lane.key !== "canceled"),
      attentionLane: "reviewing",
      searchMeta: ["author.name", "author.email", "preview"],
      filters: [
        {
          key: "assignee",
          label: "Assignee",
          mode: "meta",
          field: "assigneeId",
          options: [{ value: "__unassigned__", label: "Unassigned" }],
        },
      ],
      panel: {
        label: "Ticket",
        component: "featurebase-ticket",
        ...(orgUrl
          ? { links: [{ label: "Open in Featurebase", hrefTemplate: `${orgUrl}/{id}` }] }
          : {}),
      },
    },
    async listItems() {
      const tickets = await listOpenTickets(100);
      return tickets.map((ticket) => ({
        id: String(ticket.ticketNumber),
        title: `TK-${ticket.ticketNumber} ${ticket.title}`,
        preview: ticket.preview,
        lane: statusLane(ticket.status.type),
        ts: ticket.updatedAt ? Date.parse(ticket.updatedAt) || undefined : undefined,
        url: ticket.url || undefined,
        meta: ticket as unknown as Record<string, unknown>,
      }));
    },
    async contextForRef(id) {
      const ticket = await getTicket(id);
      return ticket ? formatTicketContext(ticket) : null;
    },
  };
}

function postsFeed(): FeedProvider {
  const orgUrl = featurebaseOrgUrl();
  return {
    descriptor: {
      id: "featurebase-posts",
      title: "Featurebase feedback",
      refKind: "featurebase-post",
      tileBg: FEATUREBASE_BG,
      mcpServers: ["featurebase-reader", "featurebase"],
      lanes: STATUS_LANES,
      attentionLane: "reviewing",
      searchMeta: ["author.name", "boardName", "preview"],
      filters: [
        {
          key: "board",
          label: "Board",
          mode: "meta",
          field: "boardName",
          optionsFromItems: { value: "boardName", label: "boardName" },
        },
        {
          key: "status",
          label: "Status",
          mode: "meta",
          field: "status.name",
          optionsFromItems: { value: "name", label: "name" },
        },
      ],
      panel: {
        label: "Post",
        component: "featurebase-post",
        ...(orgUrl
          ? { links: [{ label: "Open in Featurebase", hrefTemplate: `${orgUrl}/{id}` }] }
          : {}),
      },
    },
    async listItems() {
      const posts = await listRecentPosts(100);
      return posts.map((post) => ({
        id: post.id,
        title: post.title,
        preview: post.preview,
        lane: statusLane(post.status.type),
        ts: post.updatedAt ? Date.parse(post.updatedAt) || undefined : undefined,
        url: post.url || undefined,
        meta: post as unknown as Record<string, unknown>,
      }));
    },
    async contextForRef(id) {
      const post = await getPost(id);
      return post ? formatPostContext(post) : null;
    },
  };
}

export class FeaturebaseAgent implements AgentModule {
  name = "featurebase";

  getFeeds(): FeedProvider[] {
    return [ticketsFeed(), postsFeed()];
  }

  getRoutes(): Map<string, (req: Request, url: URL) => Promise<Response>> {
    const routes = new Map<string, (req: Request, url: URL) => Promise<Response>>();
    routes.set("POST /featurebase/webhook", async (req) => {
      let body: string;
      try {
        body = await readRequestTextWithinLimit(req, MAX_WEBHOOK_BODY_BYTES);
      } catch (error) {
        if (error instanceof RequestBodyTooLargeError) return webhookBodyTooLargeResponse(MAX_WEBHOOK_BODY_BYTES);
        throw error;
      }
      const signature = req.headers.get("x-webhook-signature") || "";
      const timestamp = req.headers.get("x-webhook-timestamp") || "";
      if (!verifyFeaturebaseSignature(body, signature, timestamp, featurebaseWebhookSecret())) {
        console.error("[featurebase] Invalid webhook signature");
        return Response.json({ error: "Invalid signature" }, { status: 401 });
      }
      try {
        const payload = JSON.parse(body) as FeaturebaseWebhookEvent;
        // Ack immediately after verification; process off the webhook timeout.
        void handleFeaturebaseEvent(payload).catch((error) =>
          console.error("[featurebase] Webhook handler failed:", error),
        );
        return Response.json({ ok: true });
      } catch (error) {
        console.error("[featurebase] Error parsing webhook payload:", error);
        return Response.json({ error: "Invalid payload" }, { status: 400 });
      }
    });
    return routes;
  }

  async startup(): Promise<void> {
    console.log("[featurebase] Agent started");
  }

  async shutdown(): Promise<void> {
    console.log("[featurebase] Agent shut down");
  }

  health(): Record<string, unknown> {
    return { status: "operational" };
  }
}
