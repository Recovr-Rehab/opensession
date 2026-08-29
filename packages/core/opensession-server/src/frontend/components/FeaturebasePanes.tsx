import React, { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "../ui/button";
import { Select } from "../ui/input";
import { InlineAlert, LoadingState } from "../ui/state";
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
import { noteSurface } from "../lib/tinted-surface";
import { palettePill } from "../lib/palette-classes";
import { Tooltip } from "../ui/tooltip";
import { PRODUCT_NAME } from "../lib/brand";
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
import {
  IconArrowUp,
  IconPaperclip,
  IconPencil,
  IconSparkle,
} from "./icons";
import { useCurrentUser } from "./UserPicker";
import {
  fetchFeaturebasePost,
  fetchFeaturebaseStatus,
  fetchFeaturebaseStatuses,
  fetchFeaturebaseTicket,
  updateFeaturebaseTicket,
  FEATUREBASE_MAX_ATTACHMENTS,
  sendFeaturebasePostComment,
  sendFeaturebaseTicketMessage,
  startFeaturebasePostTriage,
  startFeaturebaseTicketTriage,
  type FeaturebaseAdmin,
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

/**
 * The reply box, in the same shape as Plain's (PlainThreadPanel's composer).
 *
 * The mode is the one thing you must never have to guess — this box either
 * answers the customer or writes an aside only the team sees — so it is a
 * labelled pill with its own icon rather than a line of text, it says which
 * state it is in through `aria-pressed`, and in note mode the whole box takes
 * the yellow wash a note takes everywhere else (lib/tinted-surface.ts). The
 * line beside it names who the message will be posted as, because a reply sent
 * from here arrives under the workspace's admin rather than under your own
 * Featurebase account.
 */
function Composer({
  placeholder,
  sending,
  onSend,
  isNote,
  onToggleMode,
  allowAttachments = false,
}: {
  placeholder: string;
  sending: boolean;
  onSend: (text: string, attachmentUrls: string[]) => Promise<void>;
  isNote: boolean;
  onToggleMode: () => void;
  /**
   * Whether this surface can carry attachments. Tickets can: their reply
   * endpoint takes attachmentUrls. Feedback comments cannot - POST /v2/comments
   * has no attachment field at all - so the control is not offered there rather
   * than accepting a file and dropping it on send.
   */
  allowAttachments?: boolean;
}) {
  const [draft, setDraft] = useState("");
  const [sent, setSent] = useState(false);
  const [attachments, setAttachments] = useState<string[]>([]);
  const [attachError, setAttachError] = useState<string | null>(null);
  const currentUser = useCurrentUser();

  async function submit() {
    const text = draft.trim();
    // An attachment on its own is a message, the same as it is in Plain.
    // Featurebase still wants a body (min 1 character), and textToHtml("")
    // yields "<p></p>", which it accepts.
    const files = allowAttachments ? attachments : [];
    if ((!text && files.length === 0) || sending) return;
    await onSend(text, files);
    setDraft("");
    setAttachments([]);
    setSent(true);
    setTimeout(() => setSent(false), 2500);
  }

  // Featurebase takes attachment URLs, not bytes: its reply endpoint has an
  // `attachmentUrls` array and the API offers no upload of its own, so a file
  // has to already be somewhere it and the customer can fetch.
  function addAttachment() {
    if (attachments.length >= FEATUREBASE_MAX_ATTACHMENTS) return;
    const raw = window.prompt(
      "Attachment URL (Featurebase fetches this, so it must be publicly reachable):",
    );
    const url = raw?.trim();
    if (!url) return;
    if (!/^https?:\/\//i.test(url)) {
      setAttachError("Attachments must be an http(s) URL");
      return;
    }
    setAttachError(null);
    setAttachments((current) =>
      current.includes(url) ? current : [...current, url],
    );
  }

  return (
    <div
      className={cn(composerBox, composerBoxExpanded, "mt-3")}
      style={
        isNote
          ? { backgroundColor: noteSurface("var(--composer-surface)") }
          : undefined
      }
    >
      <textarea
        {...noAutofill}
        value={draft}
        disabled={sending}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          // Cmd/Ctrl+Enter, matching Plain. Plain Enter used to send, which
          // makes a half-written reply to a customer one keystroke away.
          if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
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
      {allowAttachments && attachments.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {attachments.map((url) => (
            <span
              key={url}
              className="inline-flex max-w-[16rem] items-center gap-1 rounded-full bg-panel px-2.5 py-1 text-meta text-dim"
            >
              <span className="truncate" title={url}>
                {url.split("/").pop() || url}
              </span>
              <button
                type="button"
                className="shrink-0 text-faint hover:text-fg"
                aria-label={`Remove ${url}`}
                onClick={() =>
                  setAttachments((current) => current.filter((u) => u !== url))
                }
              >
                &times;
              </button>
            </span>
          ))}
        </div>
      )}
      {attachError && (
        <div className="mt-1 truncate text-label text-red">{attachError}</div>
      )}
      <div className="mt-2 flex items-center gap-2">
        {allowAttachments && (
          <Tooltip label="Attach a file by URL (Featurebase has no upload API)">
            <button
              type="button"
              className={cn(palettePill, "shrink-0")}
              disabled={
                sending || attachments.length >= FEATUREBASE_MAX_ATTACHMENTS
              }
              onClick={addAttachment}
              aria-label="Attach a file by URL"
            >
              <IconPaperclip size={14} />
              Attach
            </button>
          </Tooltip>
        )}
        <Tooltip
          label={
            isNote
              ? "Switch to a customer reply"
              : "Write a note only the team sees"
          }
        >
          <button
            type="button"
            aria-pressed={isNote}
            disabled={sending}
            className={cn(
              palettePill,
              "shrink-0",
              isNote &&
                "bg-[color-mix(in_srgb,var(--yellow-tint)_22%,transparent)] text-yellow hover:bg-[color-mix(in_srgb,var(--yellow-tint)_32%,transparent)] hover:text-yellow",
            )}
            onClick={onToggleMode}
          >
            <IconPencil size={14} />
            Internal note
          </button>
        </Tooltip>
        <span className="min-w-0 truncate text-meta text-faint phone:hidden">
          {isNote
            ? `Posted as ${currentUser} (via ${PRODUCT_NAME})`
            : `Sent to the customer, signed \u201C${currentUser.split(/\s+/)[0]}\u201D`}
        </span>
        {sent && (
          <span className="shrink-0 text-meta font-semibold text-green">
            Sent \u2713
          </span>
        )}
        <button
          type="button"
          className={cn("ml-auto", composerSend, composerSendDefault)}
          disabled={
            (!draft.trim() && !(allowAttachments && attachments.length > 0)) ||
            sending
          }
          onClick={() => void submit()}
          title="Send (\u2318\u21B5)"
          aria-label={isNote ? "Add internal note" : "Send reply"}
        >
          <IconArrowUp size={24} />
        </button>
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

/**
 * Ticket admin from the pane - status, assignee, open/closed - so an answer
 * does not need a round trip to Featurebase, the same way PlainThreadActions
 * works for a Plain thread.
 *
 * The set stops where Featurebase's ticket API stops. `PATCH /v2/tickets/{id}`
 * takes statusId, assigneeId and open (plus title/content/company/custom
 * fields/snooze, which have nowhere to go here). It has no priority, spam or
 * label concept, so Plain's controls for those have no counterpart rather than
 * a button that cannot work.
 */
function FeaturebaseTicketActions({
  ticket,
  apiId,
  onChanged,
  className,
}: {
  ticket: FeaturebaseTicket;
  /** The path id the routes expect (ticket number when there is one). */
  apiId: string;
  onChanged: (next: FeaturebaseTicket | null) => void;
  className?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statuses, setStatuses] = useState<FeaturebaseStatus[]>([]);
  const [admins, setAdmins] = useState<FeaturebaseAdmin[]>([]);

  // Both lists are workspace-level and server-cached, so a fetch per mount is
  // cheap. A failure leaves the picker empty rather than breaking the pane.
  useEffect(() => {
    let alive = true;
    void fetchFeaturebaseStatuses()
      .then((rows) => {
        if (alive) setStatuses(rows);
      })
      .catch(() => {});
    void fetchFeaturebaseStatus()
      .then((s) => {
        if (alive && s.admins) setAdmins(s.admins);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  const apply = (patch: {
    statusId?: string;
    assigneeId?: string | null;
    open?: boolean;
  }) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    void updateFeaturebaseTicket(apiId, patch)
      .then(onChanged)
      .catch((e: Error) => setError(e.message))
      .finally(() => setBusy(false));
  };

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <div className="flex flex-wrap items-center gap-2">
        <Select
          size="sm"
          className="w-auto min-w-[8.5rem] max-w-[13rem]"
          aria-label="Ticket status"
          disabled={busy || statuses.length === 0}
          value={ticket.status.id || ""}
          onChange={(e) => apply({ statusId: e.target.value })}
        >
          {statuses.length === 0 && <option value="">Status</option>}
          {statuses.map((row) => (
            <option key={row.id || row.name || ""} value={row.id || ""}>
              {row.name || row.type || "Status"}
            </option>
          ))}
        </Select>

        <Select
          size="sm"
          className="w-auto min-w-[8.5rem] max-w-[13rem]"
          aria-label="Assignee"
          disabled={busy || admins.length === 0}
          value={ticket.assigneeId || ""}
          onChange={(e) =>
            apply({ assigneeId: e.target.value ? e.target.value : null })
          }
        >
          <option value="">Unassigned</option>
          {admins.map((admin) => (
            <option key={admin.id || ""} value={admin.id || ""}>
              {admin.name || admin.email || "Admin"}
            </option>
          ))}
        </Select>

        <Button
          size="sm"
          variant="ghost"
          disabled={busy}
          onClick={() => apply({ open: !ticket.open })}
          title={
            ticket.open
              ? "Close this ticket in Featurebase"
              : "Reopen this ticket in Featurebase"
          }
        >
          {ticket.open ? "Close" : "Reopen"}
        </Button>
      </div>
      {error && <InlineAlert>{error}</InlineAlert>}
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
      <div className="border-b border-divider px-4 py-2">
        <FeaturebaseTicketActions
          ticket={ticket}
          apiId={ticketApiId(ticket, ticketId)}
          onChanged={(next) => {
            if (next) setTicket(next);
            else load();
          }}
        />
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
          isNote={kind === "note"}
          allowAttachments
          onToggleMode={() => setKind((k) => (k === "note" ? "reply" : "note"))}
          onSend={async (text, attachmentUrls) => {
            setSending(true);
            try {
              await sendFeaturebaseTicketMessage(
                ticketApiId(ticket, ticketId),
                text,
                kind,
                user,
                attachmentUrls,
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
          isNote={asPrivate}
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
