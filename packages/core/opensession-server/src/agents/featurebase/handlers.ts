import { archiveSessionsForFeaturebaseRef } from "./archive";
import { isTerminalStatusType } from "./api";
import { featurebaseMentionHandle } from "./config";
import { htmlToText } from "./html";
import { featurebaseMentionRe } from "./mention";

export const TICKET_CREATED = "featurebase:ticket_created";
export const POST_CREATED = "featurebase:post_created";
export const CONVERSATION_CREATED = "featurebase:conversation_created";

export interface FeaturebaseWebhookEvent {
  id?: string;
  object?: string;
  topic?: string;
  organizationId?: string;
  data?: {
    object?: string;
    item?: Record<string, unknown>;
    changes?: Array<{ field?: string; oldValue?: unknown; newValue?: unknown }>;
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function itemStatusType(item: Record<string, unknown>): string | null {
  const status = asRecord(item.status);
  return asString(status.type);
}

function ticketIdFromItem(item: Record<string, unknown>): string | null {
  if (typeof item.ticketNumber === "number") return String(item.ticketNumber);
  const nested = asRecord(item.ticket);
  if (typeof nested.ticketNumber === "number") return String(nested.ticketNumber);
  for (const candidate of [item.id, item.ticketId, nested.id]) {
    const value = asString(candidate);
    if (value && /^\d+$/.test(value)) return value;
  }
  return null;
}

function postIdFromItem(item: Record<string, unknown>): string | null {
  if (asString(item.object) === "post") return asString(item.id);
  if (asString(item.postId)) return asString(item.postId);
  const post = asRecord(item.post);
  return asString(post.id);
}

function itemText(item: Record<string, unknown>): string {
  return (
    asString(item.bodyMarkdown) ||
    (asString(item.bodyHtml) ? htmlToText(asString(item.bodyHtml)!) : "") ||
    asString(item.content) ||
    asString(item.title) ||
    ""
  );
}

function payloadFor(topic: string, item: Record<string, unknown>): Record<string, unknown> {
  const title = asString(item.title);
  const ticketId = ticketIdFromItem(item);
  const postId = postIdFromItem(item);
  return {
    source: "featurebase",
    topic,
    title,
    ticketId,
    ticketNumber: typeof item.ticketNumber === "number" ? item.ticketNumber : null,
    ticketUrl: asString(item.ticketUrl) || asString(item.url),
    postId,
    postUrl: asString(item.postUrl) || (postId ? asString(item.url) : null),
    conversationId: asString(item.object) === "conversation" ? asString(item.id) : asString(item.conversationId),
    status: asRecord(item.status),
    preview: itemText(item).slice(0, 500),
  };
}

async function deliverMention(ticketId: string, noteId: string, text: string): Promise<void> {
  const handle = featurebaseMentionHandle();
  if (!handle) return;
  const re = featurebaseMentionRe(handle);
  if (!re.test(text)) return;
  const { tryGetSessionControl } = await import("../../server/session-control");
  const { getCachedSessions } = await import("../../server/session-cache");
  const control = tryGetSessionControl();
  if (!control) return;
  const session = getCachedSessions()
    .filter(
      (s) =>
        !s.archived &&
        (s.externalRefs || []).some((r) => r.kind === "featurebase-ticket" && r.id === ticketId),
    )
    .sort((a, b) => new Date(b.lastActivity).getTime() - new Date(a.lastActivity).getTime())[0];
  if (!session) return;
  const request = text.replace(re, "").trim();
  if (!request) return;
  await control.deliverToSession(
    session.id,
    `Internal note from a teammate on this Featurebase ticket (${ticketId}):\n\n${request}\n\nAct on it. If a reply is useful, post it as an internal note, not a customer reply.`,
    "Featurebase",
    { deliveryId: `featurebase-note:${noteId}` },
  );
}

export async function handleFeaturebaseEvent(event: FeaturebaseWebhookEvent): Promise<{
  topic: string;
  fired: number;
  archived: number;
}> {
  const topic = asString(event.topic) || "";
  const item = asRecord(event.data?.item);
  let fired = 0;
  let archived = 0;
  const { fireAutomationsForEvent } = await import("../../server/automations");
  const { invalidateFeedCache } = await import("../../server/feeds");

  if (topic === "ticket.created") {
    const ticketId = ticketIdFromItem(item);
    if (ticketId) {
      fired = fireAutomationsForEvent(TICKET_CREATED, JSON.stringify(payloadFor(topic, item), null, 2));
    }
    invalidateFeedCache("featurebase-tickets");
  } else if (topic === "ticket.updated") {
    const ticketId = ticketIdFromItem(item);
    if (ticketId && isTerminalStatusType(itemStatusType(item))) {
      archived = await archiveSessionsForFeaturebaseRef("featurebase-ticket", ticketId);
    }
    invalidateFeedCache("featurebase-tickets");
  } else if (topic === "post.created") {
    const postId = postIdFromItem(item);
    if (postId) {
      fired = fireAutomationsForEvent(POST_CREATED, JSON.stringify(payloadFor(topic, item), null, 2));
    }
    invalidateFeedCache("featurebase-posts");
  } else if (topic === "post.updated") {
    const postId = postIdFromItem(item);
    if (postId && isTerminalStatusType(itemStatusType(item))) {
      archived = await archiveSessionsForFeaturebaseRef("featurebase-post", postId);
    }
    invalidateFeedCache("featurebase-posts");
  } else if (topic === "conversation.user.created") {
    fired = fireAutomationsForEvent(
      CONVERSATION_CREATED,
      JSON.stringify(payloadFor(topic, item), null, 2),
    );
    invalidateFeedCache("featurebase-tickets");
  } else if (topic === "conversation.admin.noted") {
    const ticketId = ticketIdFromItem(item);
    const noteId = asString(item.id) || asString(event.id) || "note";
    if (ticketId) {
      await deliverMention(ticketId, noteId, itemText(item)).catch((error) =>
        console.error("[featurebase] mention delivery failed:", error),
      );
    }
  } else if (topic === "conversation.admin.closed") {
    const ticketId = ticketIdFromItem(item);
    if (ticketId) {
      archived = await archiveSessionsForFeaturebaseRef("featurebase-ticket", ticketId);
    }
    invalidateFeedCache("featurebase-tickets");
  } else {
    console.log(`[featurebase] Ignoring topic ${topic || "(none)"}`);
  }

  return { topic, fired, archived };
}
