import React, { useState, useEffect, useRef } from "react";
import type { TranscriptEntry } from "../lib/types";
import {
  ToolCallBlock,
  toolDisplayName,
  toolSummary,
  useToolPathRoots,
} from "./ToolCallBlock";
import { ClampedBody } from "./MessageBubble";
import { resolveEntryImageSrc } from "../lib/osBlob";
import { IconChevronDown } from "./icons";
import { cn } from "../ui/cn";
import { msgBody, msgMedia } from "../lib/msg-classes";
import { formatDuration } from "../lib/time";
import {
  getTurnActivityPref,
  onTurnActivityChanged,
} from "../lib/turn-activity";
import { collectTouchedFiles, LineStats } from "./TurnFooter";

interface Props {
  /** The folded part of one assistant turn: tool_use + intermediate assistant
   * text entries, in order (the turn's final answer renders outside, as a
   * normal bubble). */
  items: TranscriptEntry[];
  toolResults: Map<string, TranscriptEntry>;
  live: boolean; // this is the active block of a running stream
  onOpenSubagent?: (agentId: string, label: string) => void;
  /** Lets wire-clamped intermediate notes fetch their full content. */
  sessionId?: string;
}

/**
 * One assistant turn's work, folded into a single calm line — "Worked · 12m 4s
 * · 51 steps" — closed by default so the session reads as question → answer.
 * Expanding shows the full flat run: intermediate assistant notes interleaved
 * with the tool calls, followed by failures and a compact change summary.
 *
 * The collapsed line carries what a folded turn can't otherwise say: duration,
 * step count, and — when the turn wrote files — the ±lines it moved, in the
 * same green/red the diff surfaces use. Which files, and every failure, stay
 * one click away. The counts sit after the meta run and never shrink; the
 * duration/steps run truncates first, so a phone drops characters off the
 * middle instead of the numbers.
 */
// Memoized with a custom comparator: TranscriptBlocks rebuilds the `items`
// arrays and the `toolResults` Map on every render, so plain shallow-prop memo
// would never bail. The entries themselves keep stable references (mergeEntries
// reuses objects), so compare element-wise — and only the results this block's
// items actually read — letting untouched history blocks skip re-rendering on
// each stream event.
export const TurnBlock = React.memo(function TurnBlock({
  items,
  toolResults,
  live,
  onOpenSubagent,
  sessionId,
}: Props) {
  const pathRoots = useToolPathRoots();
  const tools = items.filter((it) => it.type === "tool_use");
  const messages = items.filter((it) => it.type === "assistant");

  // Default fold state follows the preference (Settings → Preferences) and
  // nothing else. The default ("auto") opens only the turn fold while it is
  // working and folds it again the moment the turn settles — a failed step or
  // a screenshot inside the turn used to pin it open forever, which is the one
  // thing both "Always folded" and "Expand while running" promise never
  // happens. Failures and media are one click away inside the disclosure.
  // "messages" folds the tool calls and nothing else,
  // "collapsed" folds the notes away too, and both stay folded even during a
  // live turn — the work line's tail reports the running tool. ToolCallBlock
  // owns its own disclosure, so this never expands a Bash input (including
  // generated comment metadata).
  const [pref, setPref] = useState(getTurnActivityPref);
  useEffect(
    () => onTurnActivityChanged(() => setPref(getTurnActivityPref())),
    []
  );
  const defaultExpanded = pref === "auto" ? live : pref === "expanded";
  const [expanded, setExpanded] = useState(defaultExpanded);
  // "messages" folds the tool calls only: the turn's in-between notes keep
  // reading as transcript, live and afterwards, while Bash and friends stay
  // behind the work line. Expanding puts the tools back in place, interleaved
  // with those same notes, so nothing moves except what appears between them.
  const messagesInline = pref === "messages" && !expanded;

  // Once the user has toggled the fold by hand, their choice wins — the
  // auto-sync below must not reopen/collapse it on a later default change
  // (the turn settling, or the preference itself changing).
  const userToggledRef = useRef(false);
  useEffect(() => {
    if (userToggledRef.current) return;
    setExpanded(defaultExpanded);
  }, [defaultExpanded]);

  const duration = blockDuration(items, toolResults);
  const failures = tools.filter(
    (it) => it.toolUseId && toolResults.get(it.toolUseId)?.isError
  ).length;
  const lastTool = tools[tools.length - 1];

  const editedFiles = collectTouchedFiles(tools);
  // Change detail stays behind this disclosure. The Changes tab remains the
  // place for per-file diffs; this is only a compact turn-level summary.
  const additions = editedFiles.reduce((n, f) => n + f.additions, 0);
  const deletions = editedFiles.reduce((n, f) => n + f.deletions, 0);

  const countsLabel =
    tools.length > 0
      ? `${tools.length} step${tools.length === 1 ? "" : "s"}`
      : messages.length > 0
        ? `${messages.length} message${messages.length === 1 ? "" : "s"}`
        : "";
  // One run of faint meta rather than three separately-shrinking ones, so the
  // line collapses by dropping characters off its tail instead of overflowing.
  const metaLabel = [!live && duration, countsLabel].filter(Boolean).join(" · ");

  // Interleave: consecutive tool calls share one timeline rail; intermediate
  // assistant messages break the rail into segments.
  const sections: Array<
    | { kind: "tools"; items: TranscriptEntry[] }
    | { kind: "msg"; entry: TranscriptEntry }
  > = [];
  for (const it of items) {
    if (it.type === "tool_use") {
      const last = sections[sections.length - 1];
      if (last?.kind === "tools") last.items.push(it);
      else sections.push({ kind: "tools", items: [it] });
    } else {
      sections.push({ kind: "msg", entry: it });
    }
  }
  const lastItem = items[items.length - 1];

  return (
    <div
      className="mx-auto mb-3 w-full max-w-[var(--session-col)]"
      // Anchor identity for the history scroll hold: the LAST item survives a
      // history page merging older items into this turn (the first doesn't).
      data-eid={lastItem ? `${lastItem.id}#turn` : undefined}
    >
      <button
        type="button"
        aria-expanded={expanded}
        onClick={() => {
          userToggledRef.current = true;
          setExpanded(!expanded);
        }}
        // Baseline, not centre: this row mixes its 14px title with 13px meta
        // runs, and centring aligns boxes rather than text. The chevron carries
        // no baseline of its own, so it keeps centring individually.
        className="mx-auto flex w-full max-w-[var(--session-col)] min-w-0 cursor-pointer items-baseline gap-2 rounded-control border-0 bg-transparent px-1 py-1 text-left font-sans text-[14px] leading-5 text-dim transition-colors hover:bg-hover/40 hover:text-fg"
      >
        <span
          className={cn(
            "grid size-5 flex-shrink-0 self-center place-items-center leading-none text-faint transition-transform duration-150",
            !expanded && "-rotate-90"
          )}
        >
          <IconChevronDown size={20} className="block" />
        </span>
        <span className="flex-shrink-0 font-medium">
          {live ? "Working" : "Worked"}
        </span>
        {metaLabel && (
          <span className="min-w-0 truncate text-label leading-4 text-faint">
            {metaLabel}
          </span>
        )}
        {additions + deletions > 0 && (
          <LineStats additions={additions} deletions={deletions} />
        )}
        {live && !expanded && lastTool && (
          <span className="min-w-0 truncate text-label leading-4 text-faint">
            {toolDisplayName(lastTool.toolName)}:{" "}
            {toolSummary(
              lastTool.toolName || "Tool",
              lastTool.toolInput,
              lastTool.content,
              pathRoots
            )}
          </span>
        )}
      </button>

      {(expanded || messagesInline) && (
        <div className="mt-0.5">
          {sections.map((sec) =>
            sec.kind === "msg" ? (
              <TurnMessage
                key={sec.entry.id}
                entry={sec.entry}
                sessionId={sessionId}
              />
            ) : messagesInline ? null : (
              // Tool icons align with the fold chevron on desktop. Phones use
              // the 1px optical correction for the icon's inset glyph.
              <div
                key={sec.items[0].id}
                className="-ml-px desktop:ml-0"
                data-eid={`${sec.items[sec.items.length - 1].id}#sec`}
              >
                {sec.items.map((entry) => (
                  <ToolCallBlock
                    key={entry.id}
                    entry={entry}
                    sessionId={sessionId}
                    result={
                      entry.toolUseId ? toolResults.get(entry.toolUseId) : undefined
                    }
                    pending={
                      live &&
                      !!entry.toolUseId &&
                      !toolResults.has(entry.toolUseId)
                    }
                    onOpenSubagent={onOpenSubagent}
                  />
                ))}
              </div>
            )
          )}
          {expanded && (failures > 0 || editedFiles.length > 0) && (
            <div className="ml-7 mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 px-1 text-label leading-4 text-faint">
              {failures > 0 && (
                <span className="text-red/80">
                  {failures} failed {failures === 1 ? "step" : "steps"}
                </span>
              )}
              {editedFiles.length > 0 && (
                // Line counts live on the fold header, where they read folded
                // and open alike; repeating them here would say the same
                // number twice within one block.
                <span>
                  {editedFiles.length}{" "}
                  {editedFiles.length === 1 ? "file" : "files"} changed
                </span>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}, turnBlockPropsEqual);

/** Intermediate reasoning stays readable while the turn itself provides the fold. */
function TurnMessage({
  entry,
  sessionId,
}: {
  entry: TranscriptEntry;
  sessionId?: string;
}) {
  return (
    <div
      // 7px, not the row's 4px: the fold header and the tool rows both pad by
      // 4 and then draw a glyph inset ~5px into its own box, so text padded to
      // 4 starts left of every other line in the turn. 7 sits just inside the
      // chevron's ink — the glyph's own side bearing makes a true 9 read as an
      // indent rather than an alignment.
      className="mx-auto my-2 w-full max-w-[var(--session-col)] pr-1 pl-[7px]"
      data-eid={entry.id}
    >
      <ClampedBody
        className={cn(msgBody, "markdown text-dim")}
        content={entry.content}
        entry={entry}
        sessionId={sessionId}
      />
      {entry.images && entry.images.length > 0 && (
        <div className={msgMedia}>
          {entry.images.map((raw, i) => {
            const src = resolveEntryImageSrc(raw, sessionId);
            return (
              <a
                key={i}
                href={src}
                target="_blank"
                rel="noopener noreferrer"
                className="md-image-link"
              >
                <img className="md-image" src={src} alt="" loading="lazy" />
              </a>
            );
          })}
        </div>
      )}
    </div>
  );
}

function turnBlockPropsEqual(prev: Props, next: Props): boolean {
  if (prev.live !== next.live) return false;
  if (prev.onOpenSubagent !== next.onOpenSubagent) return false;
  if (prev.sessionId !== next.sessionId) return false;
  if (prev.items.length !== next.items.length) return false;
  for (let i = 0; i < next.items.length; i++) {
    if (prev.items[i] !== next.items[i]) return false;
    const id = next.items[i].toolUseId;
    if (id && prev.toolResults.get(id) !== next.toolResults.get(id))
      return false;
  }
  return true;
}

function blockDuration(
  items: TranscriptEntry[],
  toolResults: Map<string, TranscriptEntry>
): string | null {
  if (items.length === 0) return null;
  const first = new Date(items[0].timestamp).getTime();
  const lastItem = items[items.length - 1];
  const lastResult = lastItem.toolUseId
    ? toolResults.get(lastItem.toolUseId)
    : undefined;
  const last = new Date((lastResult || lastItem).timestamp).getTime();
  return formatDuration(last - first);
}
