import React, { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "../ui/button";
import { InlineAlert, LoadingState } from "../ui/state";
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
  const isCustomer = kind === "customer";
  return (
    <div className={cn("px-4 py-3", isNote && "bg-accent-soft/40")}>
      <div className="flex items-baseline gap-2 text-xs text-dim">
        <span className="font-medium text-fg">{name || kind}</span>
        <span>{kind}</span>
        {timestamp && (
          <span>
            {new Date(timestamp).toLocaleString(undefined, {
              dateStyle: "medium",
              timeStyle: "short",
            })}
          </span>
        )}
      </div>
      {/* Featurebase message bodies are markdown: attachments arrive as
          ![name](url) and links as [text](url). Rendered as plain text they
          read as raw source — a screenshot became a wall of signed S3 URL.
          renderMarkdown sanitizes (lib/html-sanitize.ts), which matters here
          because this body is customer-supplied. */}
      {text ? (
        <MarkdownBody
          className={cn("mt-1 text-sm text-fg", isCustomer && "text-fg")}
          html={renderMarkdown(text)}
        />
      ) : (
        <p className="mt-1 text-sm text-faint">(empty)</p>
      )}
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
          ticket.parts.map((part) => (
            <MessageRow
              key={part.id}
              name={part.actorName}
              kind={part.actorType}
              text={part.text}
              timestamp={part.timestamp}
            />
          ))
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
          post.comments.map((comment) => (
            <MessageRow
              key={comment.id}
              name={comment.authorName}
              kind={comment.private ? "note" : "customer"}
              text={comment.text}
              timestamp={comment.createdAt}
            />
          ))
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
