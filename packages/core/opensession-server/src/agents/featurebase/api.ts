/**
 * Featurebase REST client for the support-ticket and feedback-post feeds.
 * Human-gated UI routes and webhook handlers use this; agent runs use the
 * operator-provided Featurebase MCP server.
 */
import { fetchWithTimeout } from "../../server/shared/fetch-with-timeout";
import {
  featurebaseAdminId,
  featurebaseApiBase,
  featurebaseApiKey,
  featurebaseApiVersion,
} from "./config";
import { htmlToText, textToHtml, withHtmlImages } from "./html";

export { htmlToText, textToHtml } from "./html";

export class FeaturebaseApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "FeaturebaseApiError";
    this.status = status;
  }
}

type Json = Record<string, unknown>;

function asRecord(value: unknown): Json {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Json)
    : {};
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asBool(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

async function fbFetch<T = unknown>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const key = featurebaseApiKey();
  if (!key)
    throw new FeaturebaseApiError("FEATUREBASE_API_KEY is not set", 401);
  const url = `${featurebaseApiBase()}${path.startsWith("/") ? path : `/${path}`}`;
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${key}`);
  headers.set("Featurebase-Version", featurebaseApiVersion());
  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  const res = await fetchWithTimeout(url, { ...init, headers });
  const text = await res.text();
  let parsed: unknown = null;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = text;
    }
  }
  if (!res.ok) {
    const errObj = asRecord(parsed);
    const message =
      asString(errObj.message) ||
      asString(errObj.error) ||
      (typeof parsed === "string"
        ? parsed.slice(0, 200)
        : `Featurebase ${res.status}`);
    throw new FeaturebaseApiError(message, res.status);
  }
  return parsed as T;
}

async function listPages<T>(
  path: string,
  query: Record<string, string | number | string[] | undefined>,
  max: number,
): Promise<T[]> {
  const out: T[] = [];
  let cursor: string | undefined;
  while (out.length < max) {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === "") continue;
      if (Array.isArray(value)) {
        for (const item of value) params.append(key, item);
      } else {
        params.set(key, String(value));
      }
    }
    params.set("limit", String(Math.min(100, max - out.length)));
    if (cursor) params.set("cursor", cursor);
    const page = await fbFetch(`${path}?${params.toString()}`);
    const data = Array.isArray(page)
      ? (page as T[])
      : Array.isArray(asRecord(page).data)
        ? (asRecord(page).data as T[])
        : [];
    out.push(...data);
    const next = asString(asRecord(page).nextCursor);
    if (!next || data.length === 0) break;
    cursor = next;
  }
  return out.slice(0, max);
}

function unwrapResource(raw: unknown): unknown {
  const rec = asRecord(raw);
  const nested = rec.data;
  if (
    nested &&
    typeof nested === "object" &&
    !Array.isArray(nested) &&
    asString(asRecord(nested).id)
  ) {
    return nested;
  }
  return raw;
}

/** Featurebase ticket retrieve/reply paths take the numeric ticketNumber, not the Mongo id. */
export function ticketPathId(id: string, ticketNumber?: number | null): string {
  if (/^\d+$/.test(id)) return id;
  if (ticketNumber != null) return String(ticketNumber);
  throw new FeaturebaseApiError(
    "Featurebase tickets are addressed by ticket number (GET /v2/tickets/{number})",
    400,
  );
}

export interface FeaturebasePerson {
  id: string | null;
  name: string | null;
  email: string | null;
  type: string | null;
}

export interface FeaturebaseStatus {
  id: string | null;
  name: string | null;
  color: string | null;
  type: string | null;
}

export interface FeaturebaseConversationPart {
  id: string;
  timestamp: string | null;
  actorName: string | null;
  actorType: "customer" | "admin" | "bot" | "note" | "system";
  text: string;
  html: string | null;
}

export interface FeaturebaseTicket {
  id: string;
  ticketNumber: number | null;
  title: string;
  preview: string;
  content: string;
  url: string | null;
  open: boolean;
  status: FeaturebaseStatus;
  author: FeaturebasePerson;
  assignee: FeaturebasePerson | null;
  assigneeId: string | null;
  teamAssigneeId: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  parts: FeaturebaseConversationPart[];
}

export interface FeaturebaseComment {
  id: string;
  text: string;
  authorName: string | null;
  createdAt: string | null;
  private: boolean;
}

export interface FeaturebasePost {
  id: string;
  title: string;
  preview: string;
  content: string;
  url: string | null;
  boardId: string | null;
  boardName: string | null;
  status: FeaturebaseStatus;
  author: FeaturebasePerson;
  upvoteCount: number | null;
  createdAt: string | null;
  updatedAt: string | null;
  comments: FeaturebaseComment[];
}

function person(raw: unknown): FeaturebasePerson {
  const rec = asRecord(raw);
  return {
    id: asString(rec.id),
    name: asString(rec.name) || asString(rec.fullName),
    email: asString(rec.email),
    type: asString(rec.type),
  };
}

function personIfPresent(raw: unknown): FeaturebasePerson | null {
  if (raw == null || typeof raw !== "object") return null;
  const value = person(raw);
  return value.id || value.name || value.email ? value : null;
}

function formatPerson(who: FeaturebasePerson): string {
  if (who.name && who.email) return `${who.name} <${who.email}>`;
  return who.name || who.email || "";
}

function status(raw: unknown): FeaturebaseStatus {
  const rec = asRecord(raw);
  return {
    id: asString(rec.id),
    name: asString(rec.name),
    color: asString(rec.color),
    type: asString(rec.type),
  };
}

function partActorType(
  partType: string | null,
  authorType: string | null,
): FeaturebaseConversationPart["actorType"] {
  if (partType === "note" || partType === "admin_note") return "note";
  if (authorType === "bot") return "bot";
  if (partType === "admin_msg" || authorType === "admin") return "admin";
  if (
    partType === "user_msg" ||
    authorType === "customer" ||
    authorType === "lead" ||
    authorType === "guest"
  ) {
    return "customer";
  }
  return "system";
}

export function normalizeConversationPart(
  raw: unknown,
): FeaturebaseConversationPart | null {
  const rec = asRecord(raw);
  const id = asString(rec.id);
  if (!id) return null;
  const author = person(rec.author);
  const html = asString(rec.bodyHtml) || asString(rec.body);
  const markdown = asString(rec.bodyMarkdown);
  const body =
    markdown || (html ? htmlToText(html) : "") || asString(rec.content) || "";
  // Same attachment repair as the source body: a part's markdown can carry an
  // empty-URL image too, and the HTML beside it holds the filename.
  const text = html ? withHtmlImages(body, html) : body;
  const actorType = partActorType(asString(rec.partType), author.type);
  if (!text && actorType === "system") return null;
  return {
    id,
    timestamp: asString(rec.createdAt) || asString(rec.updatedAt),
    actorName: author.name,
    actorType,
    text,
    html,
  };
}

export function normalizeTicket(raw: unknown): FeaturebaseTicket | null {
  const rec = asRecord(raw);
  const id = asString(rec.id);
  if (!id) return null;
  const contentHtml = asString(rec.content) || "";
  const content = htmlToText(contentHtml);
  const title = asString(rec.title) || "Ticket";
  const parts = Array.isArray(rec.conversationParts)
    ? rec.conversationParts
        .map(normalizeConversationPart)
        .filter((p): p is FeaturebaseConversationPart => !!p)
    : [];
  return {
    id,
    ticketNumber: asNumber(rec.ticketNumber),
    title,
    preview: content.slice(0, 240) || title,
    content,
    url: asString(rec.ticketUrl) || asString(rec.url),
    open: asBool(rec.open) ?? true,
    status: status(rec.status),
    author: person(rec.author),
    assignee: personIfPresent(rec.assignee),
    assigneeId:
      asString(rec.assigneeId) || personIfPresent(rec.assignee)?.id || null,
    teamAssigneeId: asString(rec.teamAssigneeId),
    createdAt: asString(rec.createdAt),
    updatedAt: asString(rec.updatedAt),
    parts,
  };
}

function normalizeComment(raw: unknown): FeaturebaseComment | null {
  const rec = asRecord(raw);
  const id = asString(rec.id);
  if (!id) return null;
  const html = asString(rec.content) || asString(rec.bodyHtml) || "";
  const author =
    personIfPresent(rec.author) || personIfPresent(rec.user) || person(null);
  return {
    id,
    text:
      asString(rec.bodyMarkdown) ||
      htmlToText(html) ||
      asString(rec.content) ||
      "",
    authorName: author.name,
    createdAt: asString(rec.createdAt),
    private:
      asBool(rec.private) ||
      asBool(rec.isPrivate) ||
      asString(rec.privacy) === "private",
  };
}

export function normalizePost(raw: unknown): FeaturebasePost | null {
  const rec = asRecord(raw);
  const id = asString(rec.id);
  if (!id) return null;
  const contentHtml = asString(rec.content) || "";
  const content = htmlToText(contentHtml);
  const title = asString(rec.title) || "Post";
  const board = asRecord(rec.board);
  return {
    id,
    title,
    preview: content.slice(0, 240) || title,
    content,
    url: asString(rec.postUrl) || asString(rec.url),
    boardId: asString(rec.boardId) || asString(board.id),
    boardName: asString(board.name),
    status: status(rec.status),
    author: person(rec.author),
    upvoteCount:
      asNumber(rec.upvotes) ??
      asNumber(rec.upvoteCount) ??
      asNumber(rec.voteCount),
    createdAt: asString(rec.createdAt),
    updatedAt: asString(rec.updatedAt),
    comments: Array.isArray(rec.comments)
      ? rec.comments
          .map(normalizeComment)
          .filter((c): c is FeaturebaseComment => !!c)
      : [],
  };
}

export function isTerminalStatusType(type: string | null | undefined): boolean {
  const value = (type || "").toLowerCase();
  return value === "completed" || value === "canceled" || value === "cancelled";
}

function isOpenTicket(ticket: FeaturebaseTicket): boolean {
  if (ticket.open === false) return false;
  return !isTerminalStatusType(ticket.status.type);
}

export async function listTicketStatuses(): Promise<FeaturebaseStatus[]> {
  const raw = await fbFetch<unknown>("/v2/tickets/statuses");
  const rows = Array.isArray(raw)
    ? raw
    : Array.isArray(asRecord(raw).data)
      ? asRecord(raw).data
      : [];
  return (rows as unknown[]).map(status).filter((row) => row.id);
}

export async function listBoards(): Promise<
  Array<{ id: string; name: string }>
> {
  const raw = await fbFetch<unknown>("/v2/boards");
  const rows = Array.isArray(raw)
    ? raw
    : Array.isArray(asRecord(raw).data)
      ? asRecord(raw).data
      : [];
  const out: Array<{ id: string; name: string }> = [];
  for (const row of rows as unknown[]) {
    const rec = asRecord(row);
    const id = asString(rec.id);
    const name = asString(rec.name);
    if (id && name) out.push({ id, name });
  }
  return out;
}

export async function listAdmins(): Promise<FeaturebasePerson[]> {
  const raw = await listPages<unknown>("/v2/admins", {}, 50);
  return raw.map(person).filter((admin) => admin.id);
}

/**
 * A message's identity by content, for de-duplicating across conversations.
 *
 * A ticket links a `customer` conversation and one or more `tracker`
 * conversations, and the trackers MIRROR the customer thread — so merging all
 * of them naively shows the same message twice. Ids differ per conversation,
 * so only the body can tell them apart.
 *
 * Attachment links are collapsed to their filename because the same image
 * arrives presigned in one conversation (`![shot.png](https://...?X-Amz-...)`)
 * and unsigned in another (`📎 shot.png`) — different text, same message.
 * Short bodies are not keyed: "ok" recurring is a real second message, not a
 * mirror, and dropping it would lose the thread.
 */
function contentKey(text: string): string | null {
  const hasAttachment = /!\[[^\]]*\]\([^)]*\)|📎/.test(text);
  const collapsed = text
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/📎\s*/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
  if (!collapsed) return null;
  // A filename is short ("image.png") but still uniquely identifies the
  // message, so attachments skip the length floor that protects real repeats
  // of a short reply.
  return hasAttachment || collapsed.length >= 15 ? collapsed : null;
}

/** Does this body carry an attachment we can actually display? */
function hasViewableImage(text: string): boolean {
  return /!\[[^\]]*\]\(\s*https?:/i.test(text);
}

async function mergeLinkedConversationParts(
  ticket: FeaturebaseTicket,
  raw: unknown,
): Promise<FeaturebaseTicket> {
  const rec = asRecord(unwrapResource(raw));
  const links = Array.isArray(rec.linkedConversations)
    ? rec.linkedConversations
    : [];
  const seen = new Set(ticket.parts.map((part) => part.id));
  // key -> index in ticket.parts, so a later copy of the same message can
  // REPLACE an earlier one rather than only being skipped.
  const keys = new Map<string, number>();
  ticket.parts.forEach((part, index) => {
    const key = contentKey(part.text);
    if (key && !keys.has(key)) keys.set(key, index);
  });
  /** Keep the copy we can actually show. The same attachment arrives unsigned
   *  on a conversation's `source` and presigned on a part; whichever lands
   *  second wins only if it is the viewable one. */
  const admit = (key: string | null, text: string): boolean => {
    if (!key) return true;
    const at = keys.get(key);
    if (at === undefined) return true;
    const existing = ticket.parts[at];
    if (existing && !hasViewableImage(existing.text) && hasViewableImage(text))
      return true;
    return false;
  };
  for (const link of links) {
    const convId = asString(asRecord(link).id);
    if (!convId) continue;
    try {
      const conv = asRecord(
        await fbFetch(`/v2/conversations/${encodeURIComponent(convId)}`),
      );
      // A conversation's OPENING message is not a conversationPart: it lives
      // on `source`, and conversationParts holds only what came after it
      // (replies, notes, and body-less events like `assign`). Reading parts
      // alone dropped the first message of every thread — and on a ticket
      // whose only part was an assignment that left the pane reading
      // "No conversation yet" over a conversation that plainly had one.
      const source = asRecord(conv.source);
      const sourceHtml = asString(source.bodyHtml) || asString(source.body);
      const sourceMarkdown =
        asString(source.bodyMarkdown) ||
        (sourceHtml ? htmlToText(sourceHtml) : "");
      // Featurebase writes attachments into the source markdown as `![Image]()`
      // with no URL; the filename (and sometimes a usable src) is only in the
      // HTML, so fill them in from there.
      const sourceText = sourceHtml
        ? withHtmlImages(sourceMarkdown, sourceHtml)
        : sourceMarkdown;
      if (sourceText || sourceHtml) {
        // Featurebase gives the source no id of its own; key it to the
        // conversation so re-fetching the ticket cannot duplicate it.
        const sourceId = `${convId}:source`;
        const sourceKey = contentKey(sourceText);
        if (!seen.has(sourceId) && admit(sourceKey, sourceText)) {
          seen.add(sourceId);
          const author = person(source.author);
          // A source author is only {type, id} - no name. The ticket's own
          // author is the same person on a customer-initiated thread, so
          // borrow that rather than render an anonymous row.
          const actorName =
            author.name ||
            (author.id && author.id === ticket.author.id
              ? ticket.author.name || ticket.author.email
              : null) ||
            (author.type === "customer"
              ? ticket.author.name || ticket.author.email
              : null);
          const sourcePart = {
            id: sourceId,
            timestamp: asString(conv.createdAt) || asString(conv.updatedAt),
            actorName,
            actorType: partActorType(null, author.type),
            text: sourceText,
            html: sourceHtml,
          };
          const replaceAt = sourceKey ? keys.get(sourceKey) : undefined;
          if (replaceAt !== undefined) {
            ticket.parts[replaceAt] = sourcePart;
          } else {
            if (sourceKey) keys.set(sourceKey, ticket.parts.length);
            ticket.parts.push(sourcePart);
          }
        }
      }
      const extra = Array.isArray(conv.conversationParts)
        ? conv.conversationParts
        : [];
      for (const partRaw of extra) {
        const part = normalizeConversationPart(partRaw);
        if (!part || seen.has(part.id)) continue;
        const key = contentKey(part.text);
        if (!admit(key, part.text)) continue;
        seen.add(part.id);
        const replaceAt = key ? keys.get(key) : undefined;
        if (replaceAt !== undefined) {
          ticket.parts[replaceAt] = part;
          continue;
        }
        if (key) keys.set(key, ticket.parts.length);
        ticket.parts.push(part);
      }
    } catch (error) {
      // The ticket still renders with the parts Featurebase already attached,
      // but say so: a silent catch here is indistinguishable from a thread
      // that genuinely has no messages.
      console.warn(
        `[featurebase] Linked conversation ${convId} could not be read:`,
        error,
      );
    }
  }
  ticket.parts.sort((a, b) =>
    String(a.timestamp || "").localeCompare(String(b.timestamp || "")),
  );
  return ticket;
}

export async function listOpenTickets(max = 100): Promise<FeaturebaseTicket[]> {
  let statusIds: string[] | undefined;
  try {
    statusIds = (await listTicketStatuses())
      .filter((row) => row.id && !isTerminalStatusType(row.type))
      .map((row) => row.id as string);
  } catch {
    statusIds = undefined;
  }
  const raw = await listPages<unknown>(
    "/v2/tickets",
    { sortBy: "recent", ...(statusIds?.length ? { statusIds } : {}) },
    max,
  );
  return raw
    .map(normalizeTicket)
    .filter(
      (t): t is FeaturebaseTicket =>
        !!t && isOpenTicket(t) && t.ticketNumber != null,
    );
}

export async function getTicket(id: string): Promise<FeaturebaseTicket | null> {
  const raw = await fbFetch(
    `/v2/tickets/${encodeURIComponent(ticketPathId(id))}`,
  );
  const ticket = normalizeTicket(unwrapResource(raw));
  if (!ticket) return null;
  return mergeLinkedConversationParts(ticket, raw);
}

/**
 * Ticket admin: status, assignment, and open/closed.
 *
 * `PATCH /v2/tickets/{id}` also takes title, content, companyId, customFields
 * and snoozedUntil; only the three the pane offers are exposed, because those
 * are the ones with somewhere to put them. Featurebase tickets have no
 * priority, spam or label concept, so the Plain pane's controls for those have
 * no counterpart here rather than a stubbed one.
 *
 * `assigneeId: null` unassigns - deliberately distinct from omitting the key,
 * which leaves the assignment alone.
 */
export async function updateTicket(
  id: string,
  patch: {
    statusId?: string;
    assigneeId?: string | null;
    open?: boolean;
  },
): Promise<FeaturebaseTicket | null> {
  const body: Record<string, unknown> = {};
  if (patch.statusId !== undefined) body.statusId = patch.statusId;
  if (patch.assigneeId !== undefined) body.assigneeId = patch.assigneeId;
  if (patch.open !== undefined) body.open = patch.open;
  if (Object.keys(body).length === 0)
    throw new FeaturebaseApiError("Nothing to update", 400);
  await fbFetch(`/v2/tickets/${encodeURIComponent(ticketPathId(id))}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
  // Re-read rather than trust the PATCH response: the pane wants the ticket
  // with its conversation merged in, which only getTicket assembles.
  return getTicket(id);
}

/** Featurebase caps a reply at 10 attachments. */
export const FEATUREBASE_MAX_ATTACHMENTS = 10;

/**
 * Reply to a ticket, optionally with attachments.
 *
 * Attachments are URLs, not bytes: the reply endpoint takes `attachmentUrls`
 * (max 10) and Featurebase has no upload endpoint of its own, so whatever is
 * listed here must already be somewhere Featurebase and the customer can
 * fetch. That is the whole mechanism the API offers.
 */
export async function replyToTicket(
  ticket: FeaturebaseTicket,
  text: string,
  kind: "reply" | "note",
  attachmentUrls: string[] = [],
): Promise<void> {
  const adminId = featurebaseAdminId();
  if (!adminId) {
    throw new FeaturebaseApiError(
      "Set FEATUREBASE_ADMIN_ID in Settings → Integrations → Featurebase to send replies",
      400,
    );
  }
  const pathId = ticketPathId(ticket.id, ticket.ticketNumber);
  await fbFetch(`/v2/tickets/${encodeURIComponent(pathId)}/reply`, {
    method: "POST",
    body: JSON.stringify({
      type: "admin",
      adminId,
      body: textToHtml(text),
      messageType: kind === "note" ? "note" : "comment",
      ...(attachmentUrls.length
        ? { attachmentUrls: attachmentUrls.slice(0, FEATUREBASE_MAX_ATTACHMENTS) }
        : {}),
    }),
  });
}

export async function listRecentPosts(max = 100): Promise<FeaturebasePost[]> {
  const [raw, boards] = await Promise.all([
    listPages<unknown>("/v2/posts", { sortBy: "recent" }, max),
    listBoards().catch(() => [] as Array<{ id: string; name: string }>),
  ]);
  const boardName = new Map(boards.map((board) => [board.id, board.name]));
  return raw
    .map(normalizePost)
    .filter((p): p is FeaturebasePost => !!p)
    .map((post) => ({
      ...post,
      boardName:
        post.boardName ||
        (post.boardId ? boardName.get(post.boardId) || null : null),
    }));
}

export async function getPost(id: string): Promise<FeaturebasePost | null> {
  const raw = await fbFetch(`/v2/posts/${encodeURIComponent(id)}`);
  const post = normalizePost(unwrapResource(raw));
  if (!post) return null;
  if (!post.boardName && post.boardId) {
    try {
      const boards = await listBoards();
      post.boardName =
        boards.find((board) => board.id === post.boardId)?.name || null;
    } catch {}
  }
  if (post.comments.length === 0) {
    try {
      const commentsPage = asRecord(
        await fbFetch(
          `/v2/comments?postId=${encodeURIComponent(id)}&limit=100`,
        ),
      );
      const comments = Array.isArray(commentsPage.data)
        ? commentsPage.data
        : [];
      post.comments = comments
        .map(normalizeComment)
        .filter((c): c is FeaturebaseComment => !!c);
    } catch {
      // Comments are optional; the post still renders.
    }
  }
  return post;
}

export async function commentOnPost(
  postId: string,
  text: string,
  asPrivate: boolean,
): Promise<void> {
  await fbFetch("/v2/comments", {
    method: "POST",
    body: JSON.stringify({
      postId,
      content: textToHtml(text),
      isPrivate: asPrivate,
    }),
  });
}

export async function connectionStatus(): Promise<{
  ok: boolean;
  tickets: number;
  posts: number;
  admins: FeaturebasePerson[];
}> {
  const [tickets, posts, admins] = await Promise.all([
    listOpenTickets(20),
    listRecentPosts(20),
    listAdmins(),
  ]);
  return { ok: true, tickets: tickets.length, posts: posts.length, admins };
}

export function formatTicketContext(ticket: FeaturebaseTicket): string {
  const author = formatPerson(ticket.author);
  const lines = [
    `Ticket ${ticket.ticketNumber != null ? `TK-${ticket.ticketNumber}` : ticket.id}: ${ticket.title}`,
    `Status: ${ticket.status.name || ticket.status.type || "unknown"}`,
    `Customer: ${author || "unknown"}`,
    ticket.url ? `URL: ${ticket.url}` : "",
    "",
    ticket.content,
  ];
  if (ticket.parts.length) {
    lines.push("", "Conversation:");
    for (const part of ticket.parts.slice(-20)) {
      lines.push(
        `[${part.actorType}] ${part.actorName || "unknown"}: ${part.text}`,
      );
    }
  }
  return lines
    .filter((line, i, arr) => line !== "" || arr[i - 1] !== "")
    .join("\n");
}

export function formatPostContext(post: FeaturebasePost): string {
  const lines = [
    `Feedback post: ${post.title}`,
    `Status: ${post.status.name || post.status.type || "unknown"}`,
    post.boardName ? `Board: ${post.boardName}` : "",
    post.upvoteCount != null ? `Upvotes: ${post.upvoteCount}` : "",
    post.url ? `URL: ${post.url}` : "",
    "",
    post.content,
  ];
  if (post.comments.length) {
    lines.push("", "Comments:");
    for (const comment of post.comments.slice(-20)) {
      lines.push(
        `${comment.private ? "[internal] " : ""}${comment.authorName || "unknown"}: ${comment.text}`,
      );
    }
  }
  return lines
    .filter((line, i, arr) => line !== "" || arr[i - 1] !== "")
    .join("\n");
}
