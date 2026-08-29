import React, { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "../ui/button";
import { InlineAlert, LoadingState } from "../ui/state";
import { noteSurface } from "../lib/tinted-surface";
import {
  plainEntryBody,
  plainEntryHead,
  plainEntryIn,
  plainEntryMeta,
  plainEntryName,
  plainEntryNote,
  plainEntryOut,
  plainEntryRow,
} from "../lib/plain-classes";
import { renderMarkdown } from "../lib/markdown";
import { MarkdownBody } from "./MarkdownBody";
import { cn } from "../ui/cn";
import {
  composerBox,
  composerBoxExpanded,
  composerSend,
  composerSendDefault,
  composerTextarea,
  composerTextareaPadding,
} from "../lib/composer-classes";
import { noAutofill } from "../lib/composer-autofill";
import { IconArrowUp, IconSparkle } from "./icons";
import { useCurrentUser } from "./UserPicker";
import {
  fetchFeaturebasePost,
  fetchFeaturebaseTicket,
  sendFeaturebasePostComment,
  sendFeaturebaseTicketMessage,
  startFeaturebasePostTriage,
  startFeaturebaseTicketTriage,
  type FeaturebasePost,
  type FeaturebaseStatus,
  type FeaturebaseTicket,
} from "../lib/api/featurebase";

function statusBackground(color: string | null): string | undefined {
  if (
    !color ||
    !/^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(color.trim())
  ) {
    return undefined;
  }
  return `color-mix(in srgb, ${color.trim()} 22%, transparent)`;
}

function ticketApiId(ticket: FeaturebaseTicket, fallback: string): string {
  return ticket.ticketNumber != null ? String(ticket.ticketNumber) : fallback;
}

function StatusChip({ status }: { status: FeaturebaseStatus }) {
  const label = status.name || status.type || "Unknown";
  const background = statusBackground(status.color);
  return (
    <span
      className="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium text-fg"
      style={background ? { background } : undefined}
    >
      {label}
    </span>
  );
}

function OpenLink({ href }: { href: string | null }) {
  if (!href) return null;
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="whitespace-nowrap text-xs font-medium text-dim hover:text-fg"
    >
      Open in Featurebase ↗
    </a>
  );
}

function Composer({
  placeholder,
  sending,
  onSend,
  modeLabel,
  onToggleMode,
}: {
  placeholder: string;
  sending: boolean;
  onSend: (text: string) => Promise<void>;
  modeLabel: string;
  onToggleMode: () => void;
}) {
  const [draft, setDraft] = useState("");
  async function submit() {
    const text = draft.trim();
    if (!text || sending) return;
    await onSend(text);
    setDraft("");
  }
  return (
    <div className={cn(composerBox, composerBoxExpanded, "mt-3")}>
      <textarea
        {...noAutofill}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            void submit();
          }
        }}
        placeholder={placeholder}
        rows={3}
        className={cn(
          composerTextarea,
          composerTextareaPadding,
          "min-h-[4.5rem]",
        )}
      />
      <div className="mt-2 flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={onToggleMode}
          className="text-xs font-medium text-dim hover:text-fg"
        >
          {modeLabel}
        </button>
        <Button
          size="sm"
          className={cn(composerSend, composerSendDefault)}
          icon={<IconArrowUp size={16} />}
          disabled={!draft.trim() || sending}
          onClick={() => void submit()}
          aria-label="Send"
        />
      </div>
    </div>
  );
}

/**
 * One message in a Featurebase thread, in the same grammar as a Plain one
 * (PlainEntryRow / lib/plain-classes.ts) so the two support surfaces read
 * identically: the head above the message, the customer's words carrying no
 * surface because they are the page's content, our own half as a bubble on the
 * right, and a team note as a full-width yellow wash rather than a third
 * message style.
 *
 * The body is rendered markdown, which is load-bearing here and not
 * decoration: Featurebase sends attachments as `![name](url)` and links as
 * `[text](url)`, so as plain text a screenshot reads as a wall of signed URL.
 * renderMarkdown sanitizes (lib/html-sanitize.ts) — these bodies are
 * customer-supplied.
 */
function MessageRow({
  name,
  kind,
  text,
  timestamp,
}: {
  name: string | null;
  kind: string;
  text: string;
  timestamp: string | null;
}) {
  const isNote = kind === "note";
  // Anything not from the customer is our side of the conversation: a
  // teammate's reply, the autoresponder, an agent.
  const ours = kind !== "customer";
  const when = timestamp
    ? new Date(timestamp).toLocaleString(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      })
    : null;
  const body = text ? (
    <MarkdownBody className={plainEntryBody} html={renderMarkdown(text)} />
  ) : (
    <p className="m-0 text-meta text-faint">(empty)</p>
  );

  if (isNote) {
    return (
      <div
        className={plainEntryNote}
        style={{ background: noteSurface("transparent") }}
      >
        <div className={plainEntryHead}>
          <span className={plainEntryName}>{name || "Note"}</span>
          <span
            className="text-meta font-semibold text-yellow"
            title="Only the team sees this note"
          >
            Note
          </span>
          {when && <span className={plainEntryMeta}>{when}</span>}
        </div>
        {body}
      </div>
    );
  }

  return (
    <div className={plainEntryRow}>
      {/* The head sits above the message rather than inside it, so our own
			    bubble holds nothing but the words, and the customer's side can lose
			    its plate without losing who wrote it. */}
      <div className={cn(plainEntryHead, ours && "flex-row-reverse")}>
        <span className={plainEntryName}>{name || kind}</span>
        <span className={plainEntryMeta}>
          {kind}
          {when ? ` \u00B7 ${when}` : ""}
        </span>
      </div>
      <div className={ours ? plainEntryOut : plainEntryIn}>{body}</div>
    </div>
  );
}

export function FeaturebaseTicketPane({
  ticketId,
  className,
  onOpenSession,
}: {
  ticketId: string;
  className?: string;
  onOpenSession?: (id: string) => void;
}) {
  const [ticket, setTicket] = useState<FeaturebaseTicket | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [kind, setKind] = useState<"note" | "reply">("note");
  const [sending, setSending] = useState(false);
  const [triaging, setTriaging] = useState(false);
  const user = useCurrentUser();
  const aliveRef = useRef(true);

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  const load = useCallback(() => {
    void fetchFeaturebaseTicket(ticketId)
      .then((next) => {
        if (!aliveRef.current) return;
        setTicket(next);
        setError(next ? null : "Ticket not found");
      })
      .catch((e: Error) => {
        if (aliveRef.current) setError(e.message);
      })
      .finally(() => {
        if (aliveRef.current) setLoading(false);
      });
  }, [ticketId]);

  useEffect(() => {
    setLoading(true);
    load();
    const timer = setInterval(load, 20_000);
    return () => clearInterval(timer);
  }, [load]);

  if (loading && !ticket)
    return <LoadingState className={className}>Loading ticket</LoadingState>;
  if (error && !ticket)
    return <InlineAlert className={className}>{error}</InlineAlert>;
  if (!ticket) return null;

  const author = [ticket.author.name, ticket.author.email]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className={cn("flex h-full min-h-0 flex-col", className)}>
      <div className="flex items-start justify-between gap-3 border-b border-divider px-4 py-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="m-0 truncate text-item-title font-semibold text-fg">
              {ticket.title}
            </h2>
            <StatusChip status={ticket.status} />
          </div>
          <p className="m-0 mt-1 text-supporting text-dim">
            {ticket.ticketNumber != null
              ? `TK-${ticket.ticketNumber}`
              : ticket.id}
            {author ? ` · ${author}` : ""}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <OpenLink href={ticket.url} />
          {onOpenSession && (
            <Button
              size="sm"
              variant="ghost"
              icon={<IconSparkle size={16} />}
              disabled={triaging}
              onClick={() => {
                setTriaging(true);
                void startFeaturebaseTicketTriage(ticketApiId(ticket, ticketId))
                  .then(onOpenSession)
                  .catch((e: Error) => setError(e.message))
                  .finally(() => setTriaging(false));
              }}
            >
              {triaging ? "Starting…" : "Triage"}
            </Button>
          )}
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {ticket.content && (
          <div className="border-b border-divider px-4 py-3">
            <p className="whitespace-pre-wrap text-sm text-fg">
              {ticket.content}
            </p>
          </div>
        )}
        {ticket.parts.length === 0 ? (
          <p className="px-4 py-6 text-sm text-dim">No conversation yet.</p>
        ) : (
          <div className="flex flex-col gap-4 px-4 py-3">
            {ticket.parts.map((part) => (
              <MessageRow
                key={part.id}
                name={part.actorName}
                kind={part.actorType}
                text={part.text}
                timestamp={part.timestamp}
              />
            ))}
          </div>
        )}
      </div>
      <div className="border-t border-divider px-3 py-2">
        {error && <InlineAlert>{error}</InlineAlert>}
        <Composer
          placeholder={kind === "note" ? "Internal note" : "Reply to customer"}
          sending={sending}
          modeLabel={
            kind === "note" ? "Mode: internal note" : "Mode: customer reply"
          }
          onToggleMode={() => setKind((k) => (k === "note" ? "reply" : "note"))}
          onSend={async (text) => {
            setSending(true);
            try {
              await sendFeaturebaseTicketMessage(
                ticketApiId(ticket, ticketId),
                text,
                kind,
                user,
              );
              load();
              setSending(false);
            } catch (e: any) {
              setError(e.message);
              setSending(false);
              throw e;
            }
          }}
        />
      </div>
    </div>
  );
}

export function FeaturebasePostPane({
  postId,
  className,
  onOpenSession,
}: {
  postId: string;
  className?: string;
  onOpenSession?: (id: string) => void;
}) {
  const [post, setPost] = useState<FeaturebasePost | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [asPrivate, setAsPrivate] = useState(true);
  const [sending, setSending] = useState(false);
  const [triaging, setTriaging] = useState(false);
  const user = useCurrentUser();
  const aliveRef = useRef(true);

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  const load = useCallback(() => {
    void fetchFeaturebasePost(postId)
      .then((next) => {
        if (!aliveRef.current) return;
        setPost(next);
        setError(next ? null : "Post not found");
      })
      .catch((e: Error) => {
        if (aliveRef.current) setError(e.message);
      })
      .finally(() => {
        if (aliveRef.current) setLoading(false);
      });
  }, [postId]);

  useEffect(() => {
    setLoading(true);
    load();
    const timer = setInterval(load, 20_000);
    return () => clearInterval(timer);
  }, [load]);

  if (loading && !post)
    return <LoadingState className={className}>Loading post</LoadingState>;
  if (error && !post)
    return <InlineAlert className={className}>{error}</InlineAlert>;
  if (!post) return null;

  return (
    <div className={cn("flex h-full min-h-0 flex-col", className)}>
      <div className="flex items-start justify-between gap-3 border-b border-divider px-4 py-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="m-0 truncate text-item-title font-semibold text-fg">
              {post.title}
            </h2>
            <StatusChip status={post.status} />
          </div>
          <p className="m-0 mt-1 text-supporting text-dim">
            {[
              post.boardName,
              post.author.name,
              post.upvoteCount != null ? `${post.upvoteCount} upvotes` : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <OpenLink href={post.url} />
          {onOpenSession && (
            <Button
              size="sm"
              variant="ghost"
              icon={<IconSparkle size={16} />}
              disabled={triaging}
              onClick={() => {
                setTriaging(true);
                void startFeaturebasePostTriage(post.id)
                  .then(onOpenSession)
                  .catch((e: Error) => setError(e.message))
                  .finally(() => setTriaging(false));
              }}
            >
              {triaging ? "Starting…" : "Triage"}
            </Button>
          )}
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {post.content && (
          <div className="border-b border-divider px-4 py-3">
            <p className="whitespace-pre-wrap text-sm text-fg">
              {post.content}
            </p>
          </div>
        )}
        {post.comments.length === 0 ? (
          <p className="px-4 py-6 text-sm text-dim">No comments yet.</p>
        ) : (
          <div className="flex flex-col gap-4 px-4 py-3">
            {post.comments.map((comment) => (
              <MessageRow
                key={comment.id}
                name={comment.authorName}
                kind={comment.private ? "note" : "customer"}
                text={comment.text}
                timestamp={comment.createdAt}
              />
            ))}
          </div>
        )}
      </div>
      <div className="border-t border-divider px-3 py-2">
        {error && <InlineAlert>{error}</InlineAlert>}
        <Composer
          placeholder={asPrivate ? "Internal comment" : "Public comment"}
          sending={sending}
          modeLabel={
            asPrivate ? "Mode: internal comment" : "Mode: public comment"
          }
          onToggleMode={() => setAsPrivate((value) => !value)}
          onSend={async (text) => {
            setSending(true);
            try {
              await sendFeaturebasePostComment(post.id, text, asPrivate, user);
              load();
              setSending(false);
            } catch (e: any) {
              setError(e.message);
              setSending(false);
              throw e;
            }
          }}
        />
      </div>
    </div>
  );
}
