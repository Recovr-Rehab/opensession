import { request } from "./request";

export interface FeaturebaseAdmin {
  id: string | null;
  name: string | null;
  email: string | null;
}

export async function fetchFeaturebaseStatus(): Promise<{
  ok: boolean;
  tickets?: number;
  posts?: number;
  admins?: FeaturebaseAdmin[];
  error?: string;
}> {
  try {
    return await request("/featurebase/status", {
      label: "Featurebase status",
    });
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof Error ? error.message : "Featurebase status failed",
    };
  }
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
  assigneeId: string | null;
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

/** The open queue, newest activity first. The Support surfaces poll this; a
 *  single ticket comes from fetchFeaturebaseTicket below. */
export async function fetchFeaturebaseTickets(): Promise<FeaturebaseTicket[]> {
  const body = await request<{ tickets?: FeaturebaseTicket[] }>(
    "/featurebase/tickets",
    { label: "Failed to fetch Featurebase tickets" },
  );
  return body?.tickets || [];
}

export async function fetchFeaturebaseTicket(
  id: string,
): Promise<FeaturebaseTicket | null> {
  const body = await request<{ ticket?: FeaturebaseTicket }>(
    `/featurebase/tickets/${encodeURIComponent(id)}`,
    { label: "Failed to load ticket" },
  );
  return body?.ticket || null;
}

export async function sendFeaturebaseTicketMessage(
  id: string,
  text: string,
  kind: "reply" | "note",
  user: string,
): Promise<void> {
  await request(`/featurebase/tickets/${encodeURIComponent(id)}/reply`, {
    method: "POST",
    body: { text, kind, user },
    label: "Failed to send",
  });
}

export async function startFeaturebaseTicketTriage(
  id: string,
): Promise<string> {
  const body = await request<{ sessionId?: string }>(
    `/featurebase/tickets/${encodeURIComponent(id)}/triage`,
    { method: "POST", label: "Failed to start triage" },
  );
  if (!body?.sessionId) throw new Error("Triage did not return a session");
  return body.sessionId;
}

export async function fetchFeaturebasePost(
  id: string,
): Promise<FeaturebasePost | null> {
  const body = await request<{ post?: FeaturebasePost }>(
    `/featurebase/posts/${encodeURIComponent(id)}`,
    { label: "Failed to load post" },
  );
  return body?.post || null;
}

export async function sendFeaturebasePostComment(
  id: string,
  text: string,
  asPrivate: boolean,
  user: string,
): Promise<void> {
  await request(`/featurebase/posts/${encodeURIComponent(id)}/comment`, {
    method: "POST",
    body: { text, private: asPrivate, user },
    label: "Failed to comment",
  });
}

export async function startFeaturebasePostTriage(id: string): Promise<string> {
  const body = await request<{ sessionId?: string }>(
    `/featurebase/posts/${encodeURIComponent(id)}/triage`,
    { method: "POST", label: "Failed to start triage" },
  );
  if (!body?.sessionId) throw new Error("Triage did not return a session");
  return body.sessionId;
}
