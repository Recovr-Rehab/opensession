import React, { useEffect, useState } from "react";
import { useIsPhone } from "../hooks/useIsPhone";
import { fetchFeaturebaseTickets } from "../lib/api/featurebase";
import type { FeaturebaseTicket } from "../lib/api/featurebase";
import {
  SIDEBAR_GROUP_HEADER,
  SIDEBAR_GROUP_HEADER_INSET,
  SIDEBAR_GROUP_NAME,
  SIDEBAR_HOVER_LAYER,
  SIDEBAR_LANE_COUNT,
  SIDEBAR_LANE_HEADER,
  SIDEBAR_LANE_NAME,
  SIDEBAR_RAIL,
  SIDEBAR_RAIL_GAP,
} from "../lib/sidebar-classes";
import { SUPPORT_COLUMN_BAR } from "../lib/support-classes";
import { mineStatus } from "../lib/sidebar-lanes";
import { MINE_STATUS_META } from "../lib/sidebar-types";
import { shortTime } from "../lib/time";
import type { UnifiedSession } from "../lib/types";
import { Button } from "../ui/button";
import { cn } from "../ui/cn";
import { EmptyState, InlineAlert, LoadingState } from "../ui/state";
import { FeaturebaseTicketPane } from "./FeaturebasePanes";
import { IconMail } from "./icons";

/**
 * The Featurebase queue as a place of its own: the tickets in a column beside
 * the sidebar, the one you picked open next to them.
 *
 * This is the Support tool. It is the same shape as the Plain queue it
 * replaced — the sidebar's grammar at a column's width, the same 22px rail,
 * hover and selected washes — but the lanes are Featurebase's own ticket
 * statuses rather than Plain's priorities, because that is the axis the
 * queue is actually worked along.
 *
 * The ticket beside it is FeaturebaseTicketPane, the same surface the sidebar
 * band's ticket panel renders, so a reply written here and a reply written
 * there go through one code path.
 */

/** The column. Paper like the pane it sits in, separated by the chrome seam.
 *  On a phone the two panes are separate pages, so it is the whole width. */
const COLUMN =
  "flex min-h-0 flex-col " +
  "phone:w-full phone:flex-1 " +
  "desktop:w-[320px] desktop:shrink-0 desktop:border-r desktop:border-divider";

const COLUMN_TITLE =
  "m-0 text-item-title font-semibold text-fg phone:text-section-title";

const COLUMN_COUNT =
  "ml-auto shrink-0 text-meta font-medium tabular-nums text-faint";

const LIST =
  "min-h-0 flex-1 overflow-y-auto px-1.5 pt-2 pb-3 " +
  "[scrollbar-width:none] [&::-webkit-scrollbar]:hidden";

/** A ticket. Two lines, so it sets its own vertical rhythm; everything else —
 *  corner, rail gap, hover layer, `bg-selected` — is the shared row grammar. */
const ROW =
  "group mt-0.5 flex w-full cursor-pointer items-start rounded-row border-0 " +
  "bg-transparent py-2.5 pr-3 pl-2.5 text-left data-active:bg-selected " +
  `${SIDEBAR_RAIL_GAP} ${SIDEBAR_HOVER_LAYER}`;

const ROW_HEAD = "flex min-w-0 items-baseline gap-2";

const ROW_NAME =
  "min-w-0 flex-1 truncate text-label font-medium text-dim " +
  "group-hover:text-fg group-data-active:text-fg phone:text-[15px]";

const ROW_TIME = "shrink-0 text-right text-meta tabular-nums text-faint";

const ROW_SUBJECT =
  "mt-1 block truncate text-label text-faint " +
  "group-data-active:text-dim phone:text-[14px]";

/** Mirrors STATUS_LANES in src/agents/featurebase/index.ts, in the order the
 *  queue is read: what needs an answer first, then what is already moving.
 *  Terminal lanes are listed so a ticket opened from a link still lands in a
 *  group rather than vanishing from the column. */
const TICKET_LANES: { key: string; label: string; dot: string }[] = [
  { key: "reviewing", label: "In review", dot: "var(--yellow)" },
  { key: "unstarted", label: "Open", dot: "var(--blue)" },
  { key: "active", label: "Active", dot: "var(--accent)" },
  { key: "completed", label: "Completed", dot: "var(--green)" },
  { key: "canceled", label: "Canceled", dot: "var(--text-faint)" },
];

/** Same mapping as the feed provider's statusLane(): an unknown or missing
 *  status reads as Open rather than disappearing. */
function ticketLane(type: string | null | undefined): string {
  const value = (type || "").toLowerCase();
  if (value === "reviewing") return "reviewing";
  if (value === "active") return "active";
  if (value === "completed") return "completed";
  if (value === "canceled" || value === "cancelled") return "canceled";
  return "unstarted";
}

/** The id the route and the pane use. Ticket number when there is one, because
 *  that is what the URL and "TK-12" read as; the raw id otherwise. */
function ticketKey(ticket: FeaturebaseTicket): string {
  return ticket.ticketNumber != null ? String(ticket.ticketNumber) : ticket.id;
}

interface Props {
  /** The open ticket, or null for the list on its own. */
  ticketId: string | null;
  /** Live sessions, for the rail dot: a ticket already being worked on wears
   *  its session's status instead of its lane colour. */
  sessions: UnifiedSession[];
  /** Open a ticket (drives the route, so the pane is deep-linkable). */
  onSelectTicket: (ticketId: string) => void;
  /** Navigate into a session — what the pane's triage button resolves to. */
  onOpenSession: (id: string) => void;
}

export function FeaturebaseInbox({
  ticketId,
  sessions,
  onSelectTicket,
  onOpenSession,
}: Props) {
  const isPhone = useIsPhone();
  const [tickets, setTickets] = useState<FeaturebaseTicket[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  // The same gentle cadence the sidebar polls on. A poll that fails while
  // tickets are already on screen keeps them: the list is the queue as of the
  // last good answer, not an error page. The FIRST load is different — there
  // is nothing to keep, so it settles to an empty list and lets the error
  // render. Leaving it null there would sit on "Loading tickets…" forever and
  // make a dead credential look like a hang.
  useEffect(() => {
    let alive = true;
    const load = () =>
      fetchFeaturebaseTickets()
        .then((next) => {
          if (!alive) return;
          setTickets(next);
          setError(null);
        })
        .catch((e) => {
          if (!alive) return;
          setError(e?.message || "Failed to load the queue");
          setTickets((prev) => prev ?? []);
        });
    void load();
    const timer = setInterval(() => {
      if (document.visibilityState === "hidden") return;
      void load();
    }, 60_000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);

  // Newest live session per ticket, by the ref the Featurebase agent links
  // with. Both the ticket number and the raw id are accepted because a session
  // may have been opened from either.
  const sessionByTicket = (() => {
    const m = new Map<string, UnifiedSession>();
    for (const s of sessions) {
      if (s.archived) continue;
      for (const ref of s.externalRefs || []) {
        if (ref.kind !== "featurebase-ticket") continue;
        const prev = m.get(ref.id);
        if (!prev || s.lastActivity > prev.lastActivity) m.set(ref.id, s);
      }
    }
    return m;
  })();

  function sessionFor(ticket: FeaturebaseTicket): UnifiedSession | null {
    return (
      sessionByTicket.get(ticketKey(ticket)) ||
      sessionByTicket.get(ticket.id) ||
      null
    );
  }

  // Phone: list and ticket are separate pages, with a back button between.
  const showList = !isPhone || !ticketId;
  const showTicket = !isPhone || !!ticketId;

  function renderRow(ticket: FeaturebaseTicket, laneDot: string) {
    const key = ticketKey(ticket);
    const session = sessionFor(ticket);
    const who = ticket.author.name || ticket.author.email || "Unknown";
    const dot =
      (session
        ? MINE_STATUS_META.find((m) => m.key === mineStatus(session))?.dotColor
        : laneDot) || "var(--text-faint)";
    const stamp = ticket.updatedAt || ticket.createdAt;
    const number =
      ticket.ticketNumber != null ? `TK-${ticket.ticketNumber} ` : "";
    return (
      <Button
        variant="ghost"
        size="sm"
        key={ticket.id}
        type="button"
        className={ROW}
        data-active={(ticketId === key && !isPhone) || undefined}
        onClick={() => onSelectTicket(key)}
      >
        <span className={SIDEBAR_RAIL}>
          <span
            className="size-[7px] rounded-full"
            style={{ backgroundColor: dot }}
          />
        </span>
        <span className="min-w-0 flex-1">
          <span className={ROW_HEAD}>
            <span className={ROW_NAME}>{who}</span>
            {stamp && (
              <span
                className={ROW_TIME}
                title={new Date(stamp).toLocaleString()}
              >
                {shortTime(stamp)}
              </span>
            )}
          </span>
          <span className={ROW_SUBJECT}>
            {`${number}${ticket.title || ticket.preview || "No subject"}`}
          </span>
        </span>
      </Button>
    );
  }

  return (
    <div className="flex min-h-0 flex-1">
      {showList && (
        <aside className={COLUMN}>
          <div className={SUPPORT_COLUMN_BAR}>
            <h1 className={COLUMN_TITLE}>Support</h1>
            {tickets && <span className={COLUMN_COUNT}>{tickets.length}</span>}
          </div>
          <div className={LIST}>
            {tickets === null ? (
              <LoadingState>Loading tickets…</LoadingState>
            ) : error && tickets.length === 0 ? (
              <InlineAlert className="mt-2">{error}</InlineAlert>
            ) : tickets.length === 0 ? (
              <div className="px-3 py-6 text-center text-label text-faint">
                Nothing waiting in Featurebase.
              </div>
            ) : (
              TICKET_LANES.map((lane) => {
                const items = tickets.filter(
                  (t) => ticketLane(t.status.type) === lane.key,
                );
                if (items.length === 0) return null;
                return (
                  <div key={lane.key}>
                    {/* The sidebar's lane caption, not a heading of its own. */}
                    <div
                      className={cn(
                        SIDEBAR_GROUP_HEADER,
                        SIDEBAR_GROUP_HEADER_INSET,
                        SIDEBAR_LANE_HEADER,
                        "cursor-default hover:text-dim",
                      )}
                    >
                      <span
                        className={cn(SIDEBAR_GROUP_NAME, SIDEBAR_LANE_NAME)}
                        style={{ color: lane.dot }}
                      >
                        {lane.label}
                      </span>
                      <span
                        className={SIDEBAR_LANE_COUNT}
                        style={{ color: lane.dot }}
                      >
                        {items.length}
                      </span>
                    </div>
                    {items.map((t) => renderRow(t, lane.dot))}
                  </div>
                );
              })
            )}
          </div>
        </aside>
      )}

      {showTicket && (
        <section className="flex min-w-0 flex-1 flex-col">
          {/* An open ticket brings its own bar. This is the one for when
					    nothing is open, and for phones, where the app's floating back
					    control sits here. Either way the two columns start on one line. */}
          {(!ticketId || isPhone) && <div className={SUPPORT_COLUMN_BAR} />}
          {ticketId ? (
            <FeaturebaseTicketPane
              key={ticketId}
              ticketId={ticketId}
              onOpenSession={onOpenSession}
            />
          ) : (
            <div className="flex min-h-0 flex-1 items-center justify-center p-8">
              <EmptyState
                icon={<IconMail size={22} />}
                title="No ticket selected"
              >
                Pick a ticket to read the conversation, reply, and triage it
                without leaving this page.
              </EmptyState>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
