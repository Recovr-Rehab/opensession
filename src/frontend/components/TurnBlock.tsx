import React, { useState, useEffect, useRef } from "react";
import type { TranscriptEntry } from "../lib/types";
import {
  assetToolPath,
  canonicalToolName,
  PathSummary,
  ToolCallBlock,
  ToolGlyph,
  toolDisplayName,
  toolFamily,
  toolLineStats,
  toolSummary,
  useToolPathRoots,
} from "./ToolCallBlock";
import { ClampedBody } from "./MessageBubble";
import { resolveEntryImageSrc } from "../lib/osBlob";
import { IconChevronDown, IconStack } from "./icons";
import { cn } from "../ui/cn";
import { msgBody, msgMedia } from "../lib/msg-classes";
import { formatDuration } from "../lib/time";
import {
  getTurnActivityPref,
  onTurnActivityChanged,
} from "../lib/turn-activity";
import {
  collectTouchedFiles,
  LineStats,
  TouchedFileChips,
  touchedFilesFromTool,
} from "./TurnFooter";

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
        // The 8px overhang gives the icon-aligned chevron breathing room; the
        // compensating padding keeps every child at its previous coordinate.
        className="-mx-2 flex w-[calc(100%+16px)] min-w-0 cursor-pointer items-baseline gap-2 rounded-control border-0 bg-transparent px-3 py-1 text-left font-sans text-[14px] leading-5 text-dim transition-colors hover:bg-hover/40 hover:text-fg"
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
                <ToolSection
                  items={sec.items}
                  toolResults={toolResults}
                  live={live}
                  defaultExpanded={pref === "expanded"}
                  sessionId={sessionId}
                  onOpenSubagent={onOpenSubagent}
                />
              </div>
            )
          )}
          {expanded && (failures > 0 || editedFiles.length > 0) && (
            <div className="ml-7 mt-1 flex flex-wrap items-center gap-x-0.5 gap-y-1 px-1 text-label leading-4 text-faint">
              {failures > 0 && (
                <span className="mr-1.5 text-red/80">
                  {failures} failed {failures === 1 ? "step" : "steps"}
                </span>
              )}
              {/* The same chips the answer's footer ends with: a bare count
                  said how many files without saying which, and the name is
                  the part worth reading. The fold header keeps the turn's
                  totals; these carry each file's own. */}
              <TouchedFileChips files={editedFiles} max={FOLD_FILE_CHIPS} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}, turnBlockPropsEqual);

/** Files named in the expanded summary before the rest become one count. This
 * row wraps onto as many lines as it needs, unlike the answer footer's single
 * row, so it can afford to name more of them. */
const FOLD_FILE_CHIPS = 6;

const COMPACT_TOOL_FAMILIES = new Set([
  "run",
  "file",
  "find",
  "web",
]);

export interface ToolSectionProps {
  items: TranscriptEntry[];
  toolResults: Map<string, TranscriptEntry>;
  live: boolean;
  defaultExpanded: boolean;
  onOpenSubagent?: (agentId: string, label: string) => void;
  sessionId?: string;
}

/**
 * Routine tool calls are evidence of the work, not the conversation itself.
 * Keep uninterrupted runs to one line, while calls with their own important
 * affordance (a worker, an asset, or explicitly featured media) stay direct.
 */
export function ToolSection(props: ToolSectionProps) {
  const runs: Array<{
    compact: boolean;
    editKey: string;
    items: TranscriptEntry[];
  }> = [];
  for (const entry of props.items) {
    const result = entry.toolUseId
      ? props.toolResults.get(entry.toolUseId)
      : undefined;
    const compact = isCompactTool(entry, result);
    const editKey = compact ? "" : editRunKey(entry, result);
    const last = runs[runs.length - 1];
    if (last && (compact ? last.compact : !!editKey && last.editKey === editKey))
      last.items.push(entry);
    else runs.push({ compact, editKey, items: [entry] });
  }

  return runs.map((run) =>
    run.compact ? (
      <ToolRunBlock key={run.items[0].id} {...props} items={run.items} />
    ) : run.editKey && run.items.length > 1 ? (
      <EditRunBlock key={run.items[0].id} {...props} items={run.items} />
    ) : (
      <React.Fragment key={run.items[0].id}>
        {run.items.map((entry) => (
          <ToolCallBlock
            key={entry.id}
            entry={entry}
            sessionId={props.sessionId}
            result={
              entry.toolUseId
                ? props.toolResults.get(entry.toolUseId)
                : undefined
            }
            pending={
              props.live &&
              !!entry.toolUseId &&
              !props.toolResults.has(entry.toolUseId)
            }
            onOpenSubagent={props.onOpenSubagent}
          />
        ))}
      </React.Fragment>
    )
  );
}

function ToolRunBlock({
  items,
  toolResults,
  live,
  defaultExpanded,
  onOpenSubagent,
  sessionId,
}: ToolSectionProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const userToggledRef = useRef(false);
  useEffect(() => {
    if (!userToggledRef.current) setExpanded(defaultExpanded);
  }, [defaultExpanded]);

  const label = groupedToolLabel(items);
  let failures = 0;
  let pending = 0;
  let images = 0;
  let videos = 0;
  for (const entry of items) {
    const result = entry.toolUseId ? toolResults.get(entry.toolUseId) : undefined;
    if (result?.isError) failures++;
    if (live && entry.toolUseId && !result) pending++;
    images += result?.images?.length ?? 0;
    videos += result?.videos?.length ?? 0;
  }
  const mediaCount = images + videos;
  const statusLabel = [
    failures > 0 ? `${failures} failed` : "",
    mediaCount > 0 ? `${mediaCount} media` : "",
    pending > 0 ? "running" : "",
  ].filter(Boolean).join(", ");
  const mediaLabel =
    mediaCount === 0
      ? ""
      : videos === 0
        ? `${images} image${images === 1 ? "" : "s"}`
        : images === 0
          ? `${videos} video${videos === 1 ? "" : "s"}`
          : `${mediaCount} media`;

  return (
    <div data-tool-run="true" data-eid={`${items[items.length - 1].id}#run`}>
      <button
        type="button"
        aria-expanded={expanded}
        aria-label={`${expanded ? "Hide" : "Show"} ${items.length} grouped steps: ${label}${statusLabel ? `. ${statusLabel}` : ""}`}
        title={`${items.length} grouped steps`}
        onClick={() => {
          userToggledRef.current = true;
          setExpanded(!expanded);
        }}
        className="group flex w-full min-w-0 cursor-pointer items-center gap-2 rounded-control border-0 bg-transparent px-1 py-[3px] text-left font-sans transition-colors hover:bg-hover/40 phone:min-h-10"
      >
        {/* Open, the row is a heading for the steps under it, so it keeps the
            chevron rather than a stack of what is already on screen. Closed,
            the stack stands in until a hover offers the chevron. */}
        <span className="relative grid size-[22px] flex-shrink-0 place-items-center text-faint">
          <span
            className={cn(
              "absolute inset-0 transition-opacity duration-150 group-hover:opacity-0 group-focus-visible:opacity-0",
              expanded && "opacity-0"
            )}
          >
            <IconStack size={18} className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2" />
          </span>
          <IconChevronDown
            size={20}
            className={cn(
              "absolute block transition-[opacity,transform] duration-150 group-hover:opacity-100 group-focus-visible:opacity-100",
              expanded ? "opacity-100" : "-rotate-90 opacity-0"
            )}
          />
        </span>
        {/* Just the count. Which tools ran is what the row is folding away,
            and one click puts every step back with its own glyph, so naming
            them here only asks to be read. The names stay in the aria-label,
            where the count alone would tell a screen reader nothing. */}
        <span className="min-w-0 flex-1 truncate text-[14px] font-medium leading-5 text-dim transition-colors group-hover:text-fg">
          {items.length} step{items.length === 1 ? "" : "s"}
        </span>
        {mediaLabel && (
          <span className="flex-shrink-0 text-meta text-faint">{mediaLabel}</span>
        )}
        {failures > 0 && (
          <span className="flex-shrink-0 text-meta text-red/80">
            {failures} failed
          </span>
        )}
        {pending > 0 && (
          <span className="size-[11px] flex-shrink-0 animate-spin rounded-full border border-b-line-strong border-l-line-strong border-r-line-strong border-t-dim" />
        )}
      </button>
      {expanded && (
        <div className="ml-3">
          {items.map((entry) => (
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
      )}
    </div>
  );
}

/**
 * Consecutive edits to one file, folded into a single row: the path once, the
 * summed ±lines, and a count. Four passes over the same file are one change to
 * a reader, and four rows of the same path push the rest of the turn off the
 * screen. Every individual call is one click away, with its own diff.
 *
 * The path comes from the same derivation the turn's changed-file summary uses,
 * so a call whose input arrived clamped (no readable path) simply keeps its own
 * row rather than joining a group it can't be checked against.
 */
function editRunKey(
  entry: TranscriptEntry,
  result: TranscriptEntry | undefined
): string {
  const name = entry.toolName || "Tool";
  if (toolFamily(name) !== "edit") return "";
  // Media the agent asked to show keeps its own row, as it does everywhere else.
  if (result?.featuredMedia?.length) return "";
  const files = touchedFilesFromTool(entry);
  if (files.length !== 1) return "";
  return `${canonicalToolName(name)}\u0000${files[0].path}`;
}

function EditRunBlock({
  items,
  toolResults,
  live,
  defaultExpanded,
  onOpenSubagent,
  sessionId,
}: ToolSectionProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const userToggledRef = useRef(false);
  useEffect(() => {
    if (!userToggledRef.current) setExpanded(defaultExpanded);
  }, [defaultExpanded]);

  const pathRoots = useToolPathRoots();
  const first = items[0];
  const toolName = first.toolName || "Tool";
  const path = toolSummary(toolName, first.toolInput, first.content, pathRoots);

  let additions = 0;
  let deletions = 0;
  let failures = 0;
  let pending = 0;
  for (const entry of items) {
    // Summed from what the rows themselves show, so opening the fold adds up
    // to the number that was on it.
    const stats = toolLineStats(entry.toolName || "Tool", entry.toolInput);
    additions += stats?.additions ?? 0;
    deletions += stats?.deletions ?? 0;
    const result = entry.toolUseId ? toolResults.get(entry.toolUseId) : undefined;
    if (result?.isError) failures++;
    if (live && entry.toolUseId && !result) pending++;
  }

  return (
    <div data-tool-run="edits" data-eid={`${items[items.length - 1].id}#edits`}>
      <button
        type="button"
        aria-expanded={expanded}
        aria-label={`${expanded ? "Hide" : "Show"} ${items.length} ${toolName} steps on ${path}${failures > 0 ? `. ${failures} failed` : ""}`}
        // The single-call row's own line box: a folded group has to sit in the
        // same column as the edits around it, or the transcript reads as two
        // kinds of row.
        className="group flex w-full min-w-0 cursor-pointer items-baseline gap-2 rounded-control border-0 bg-transparent px-1 py-[3px] text-left font-sans transition-colors hover:bg-hover/40"
        onClick={() => {
          userToggledRef.current = true;
          setExpanded(!expanded);
        }}
      >
        <span
          className={cn(
            "relative z-[1] flex size-[22px] flex-shrink-0 self-center items-center justify-center",
            failures > 0 ? "text-red/70" : "text-faint"
          )}
        >
          <span className="transition-opacity duration-150 group-hover:opacity-0 group-focus-visible:opacity-0">
            <ToolGlyph toolName={toolName} size={20} />
          </span>
          <IconChevronDown
            size={20}
            className={cn(
              "absolute block text-dim opacity-0 transition-[opacity,transform] duration-150 group-hover:opacity-100 group-focus-visible:opacity-100",
              expanded && "rotate-180"
            )}
          />
        </span>
        <span className="flex-shrink-0 text-[14px] leading-5 font-medium text-dim transition-colors group-hover:text-fg">
          {toolName}
        </span>
        <span className="flex min-w-0 flex-1 items-baseline gap-2">
          <span
            className={cn(
              "min-w-0 truncate text-label leading-4",
              failures > 0 ? "text-red/80" : "text-dim"
            )}
          >
            <PathSummary path={path} />
          </span>
          <span className="flex-shrink-0 text-label leading-4 text-faint">
            ×{items.length}
          </span>
          {additions + deletions > 0 && (
            <span className="flex flex-shrink-0 gap-1.5 text-label leading-4">
              {additions > 0 && <span className="text-green">+{additions}</span>}
              {deletions > 0 && <span className="text-red">-{deletions}</span>}
            </span>
          )}
        </span>
        {failures > 0 && (
          <span className="flex-shrink-0 text-meta text-red/80">
            {failures} failed
          </span>
        )}
        {pending > 0 && (
          <span className="size-[11px] flex-shrink-0 self-center animate-spin rounded-full border border-b-line-strong border-l-line-strong border-r-line-strong border-t-dim" />
        )}
      </button>
      {expanded && (
        <div className="ml-3">
          {items.map((entry) => (
            <ToolCallBlock
              key={entry.id}
              entry={entry}
              sessionId={sessionId}
              result={
                entry.toolUseId ? toolResults.get(entry.toolUseId) : undefined
              }
              pending={
                live && !!entry.toolUseId && !toolResults.has(entry.toolUseId)
              }
              onOpenSubagent={onOpenSubagent}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function isCompactTool(
  entry: TranscriptEntry,
  result: TranscriptEntry | undefined
): boolean {
  const name = entry.toolName || "Tool";
  if (!COMPACT_TOOL_FAMILIES.has(toolFamily(name))) return false;
  if (assetToolPath(name, entry.toolInput)) return false;
  return !result?.featuredMedia?.length;
}

/** The run's tools in call order, each with how often it ran. */
function groupedTools(
  items: TranscriptEntry[]
): Array<{ name: string; count: number }> {
  const counts = new Map<string, number>();
  for (const entry of items) {
    const name = canonicalToolName(entry.toolName || "Tool");
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return [...counts].map(([name, count]) => ({ name, count }));
}

function groupedToolName(name: string, count: number): string {
  return count > 1 ? `${name} ×${count}` : name;
}

/** Same run, spelled out for a screen reader: the glyphs carry no text. */
function groupedToolLabel(items: TranscriptEntry[]): string {
  return groupedTools(items)
    .map(({ name, count }) => groupedToolName(name, count))
    .join(" · ");
}

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
        className={cn(msgBody, "markdown text-fg")}
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
