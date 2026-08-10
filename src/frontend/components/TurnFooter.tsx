import React, { useState } from "react";
import type { TranscriptEntry } from "../lib/types";
import { Menu } from "../ui/menu";
import { Tooltip } from "../ui/tooltip";
import { cn } from "../ui/cn";
import {
  IconArrowUpRight,
  IconBranches,
  IconCheck,
  IconClock,
  IconCopy,
  IconDotsHorizontal,
  IconSparkle,
} from "./icons";
import { useOpenAsset } from "../lib/open-asset";
import { formatDuration, fullTime } from "../lib/time";
import { friendlyModelSlug, opencodeModelParts } from "./ModelEffortSelect";
import { canonicalToolName } from "./ToolCallBlock";
import { LANG_MARKS } from "./lang-marks";

export interface TouchedFile {
  path: string;
  additions: number;
  deletions: number;
}

interface Props {
  /** The turn's final answer entry — copy copies its markdown, fork forks from it. */
  entry: TranscriptEntry;
  durationMs: number;
  /** Scratch files the turn wrote (`opensession-assets`), in first-write order. */
  assets: string[];
  onFork?: (entryId: string) => void;
}

/**
 * Quiet answer actions plus produced assets. Work duration, model and exact
 * time stay one click away; touched files live in the work disclosure/Changes.
 */
export const TurnFooter = React.memo(function TurnFooter({
  entry,
  durationMs,
  assets,
  onFork,
}: Props) {
  const [copied, setCopied] = useState(false);
  const doCopy = () => {
    copyText(entry.content, () => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  const duration = formatDuration(durationMs);
  return (
    <div className="mx-auto -mt-2.5 mb-[18px] flex w-full max-w-[var(--session-col)] flex-wrap items-center gap-x-0.5 gap-y-1.5">
      {assets.map((path) => (
        <AssetChip key={path} path={path} />
      ))}
      <div className={ACTIONS}>
        <Tooltip label={copied ? "Copied" : "Copy message"}>
          <button
            type="button"
            onClick={doCopy}
            className={BTN}
            aria-label={copied ? "Copied" : "Copy message"}
          >
            {copied ? (
              <IconCheck size={20} className="text-green" />
            ) : (
              <IconCopy size={20} />
            )}
          </button>
        </Tooltip>
        <Menu.Root>
          <Menu.Trigger
            className={BTN + " data-[popup-open]:bg-hover data-[popup-open]:text-dim"}
            aria-label="More message actions"
          >
            <IconDotsHorizontal size={20} />
          </Menu.Trigger>
          <Menu.Popup side="bottom" align="start" sideOffset={4}>
            {onFork && (
              <Menu.Item onClick={() => onFork(entry.id)}>
                <IconBranches size={20} className="text-faint" />
                Fork from here
              </Menu.Item>
            )}
            {onFork && <Menu.Separator className="my-1" />}
            <div className="flex items-center gap-2 px-2.5 py-1.5 text-xs font-medium text-faint">
              <IconClock size={20} />
              {[duration, fullTime(entry.timestamp)].filter(Boolean).join(" · ")}
            </div>
            {entry.model && (
              <div className="flex items-center gap-2 px-2.5 py-1.5 text-xs font-medium text-faint">
                <IconSparkle size={20} />
                Written by {messageModelLabel(entry.model)}
              </div>
            )}
          </Menu.Popup>
        </Menu.Root>
      </div>
    </div>
  );
}, turnFooterPropsEqual);

function turnFooterPropsEqual(prev: Props, next: Props): boolean {
  if (
    prev.entry !== next.entry ||
    prev.durationMs !== next.durationMs ||
    prev.onFork !== next.onFork ||
    prev.assets.length !== next.assets.length
  )
    return false;
  for (let i = 0; i < next.assets.length; i++)
    if (prev.assets[i] !== next.assets[i]) return false;
  return true;
}

const BTN =
  "flex size-7 flex-shrink-0 cursor-pointer items-center justify-center rounded-md border-0 bg-transparent p-0 text-faint hover:bg-hover hover:text-dim";

const ACTIONS =
  "flex items-center gap-0.5 [@media(hover:hover)]:opacity-0 " +
  "[@media(hover:hover)]:transition-opacity [@media(hover:hover)]:focus-within:opacity-100 " +
  "[@media(hover:hover)]:[.transcript-window:hover_&]:opacity-100 " +
  "[@media(hover:hover)]:[.transcript-window:hover+.transcript-window_&]:opacity-100";

/** Friendly name for a per-message model id: opencode ids take their model
 * part, raw API ids drop the date suffix — "opencode/anthropic/claude-sonnet-5"
 * and "claude-sonnet-5-20250929" both read "Sonnet 5". */
function messageModelLabel(id: string): string {
  const slug = opencodeModelParts(id)?.model || id;
  return friendlyModelSlug(slug.replace(/-\d{8}$/, ""));
}

/** Shared line box for asset names and the expanded work summary's stats. */
const FOOTER_TEXT = "text-label font-medium leading-4";

/**
 * One scratch file the turn wrote. Clicking lifts it over the conversation;
 * the overlay can promote it into the Assets tab when it needs to stay open.
 * The write_asset row's own Open chip takes the same route, so the two ways
 * into one file don't disagree.
 *
 * Unlike a touched file there is no diff to preview: an asset lives outside
 * every worktree, and the file itself is the thing worth looking at. Where
 * nothing can open it (the Desk overlay, a sub-agent pane) the chip stays, but
 * as a plain label — a name is still worth reading; a dead button isn't.
 */
function AssetChip({ path }: { path: string }) {
  const name = path.split("/").pop() || path;
  const asset = useOpenAsset();
  const body = (
    <>
      <ExtBadge name={name} />
      <span className={cn("max-w-[180px] truncate text-dim", FOOTER_TEXT)}>
        {name}
      </span>
      <IconArrowUpRight size={20} className="size-4 flex-shrink-0 text-faint" />
    </>
  );
  if (!asset.available)
    return (
      <span className={cn(CHIP, "pr-1")}>
        {body}
      </span>
    );
  return (
    <Tooltip label="Open this file">
      <button
        type="button"
        onClick={() => asset.open(path)}
        className={cn(CHIP, "cursor-pointer pr-1 hover:bg-hover")}
      >
        {body}
      </button>
    </Tooltip>
  );
}

/** A quiet produced-asset shortcut beneath the answer. */
const CHIP =
  "ml-1 flex h-6 min-w-0 items-center gap-1.5 overflow-hidden rounded-control border-0 bg-fg/[0.03] py-0 pl-1 text-left";

export function LineStats({
  additions,
  deletions,
  className,
}: {
  additions: number;
  deletions: number;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "flex flex-shrink-0 items-center gap-1 text-label font-medium leading-4",
        className
      )}
    >
      <span className="text-green">+{additions}</span>
      <span className="text-red">-{deletions}</span>
    </span>
  );
}

/**
 * The file's language mark: the brand glyph where one reads at this size, its
 * letters otherwise. The faint background belongs to the whole file chip, not
 * this mark, so the icon, filename and counts read as one object.
 *
 * Mixing a quarter of the theme's own text colour into the ink lifts the dark
 * ones (Ruby's #701516, JSON's #953800) off `--bg` in dark mode and settles the
 * bright ones in light mode, from one expression and without a second palette
 * to keep in sync. The ink sits 1px low inside the centred tint: its optical
 * baseline then meets the 13px filename instead of floating above it.
 */
function ExtBadge({ name, className }: { name: string; className?: string }) {
  const dot = name.lastIndexOf(".");
  const ext = dot > 0 && dot < name.length - 1 ? name.slice(dot + 1).toLowerCase() : "";
  const color = EXT_COLORS[ext] || "#6e7681";
  const Glyph = LANG_MARKS[ext];
  return (
    <span
      className={cn(
        "flex h-4 min-w-4 flex-shrink-0 items-center justify-center px-0.5 text-meta font-bold leading-none",
        className
      )}
      style={{ color: `color-mix(in oklab, ${color} 75%, var(--text))` }}
    >
      <span className="flex translate-y-px items-center justify-center">
        {Glyph ? <Glyph size={12} /> : extLabel(ext)}
      </span>
    </span>
  );
}

/**
 * An extension keeps its real name up to four characters and is cut to three
 * beyond that. A blind three-letter cut spelled "JSO", "YAM", "SCS" and "JAV"
 * — word-shaped enough to read as a typo rather than an abbreviation, and the
 * badge is elastic, so the fourth character costs a few pixels.
 */
function extLabel(ext: string): string {
  if (!ext) return "?";
  return (ext.length <= 4 ? ext : ext.slice(0, 3)).toUpperCase();
}

const EXT_COLORS: Record<string, string> = {
  ts: "#3178c6",
  tsx: "#3178c6",
  js: "#a38319",
  jsx: "#a38319",
  mjs: "#a38319",
  cjs: "#a38319",
  css: "#663399",
  scss: "#c6538c",
  html: "#e34c26",
  md: "#0969da",
  mdx: "#0969da",
  json: "#953800",
  yaml: "#cb171e",
  yml: "#cb171e",
  toml: "#9c4221",
  sh: "#459721",
  bash: "#459721",
  py: "#3572a5",
  rs: "#b7410e",
  go: "#0091b5",
  rb: "#701516",
  swift: "#f05138",
  java: "#b07219",
  sql: "#bf7600",
  svg: "#ca6f06",
  // Linguist's ReScript red (#ed5051) is the loudest hue in this map and only
  // clears 3.6:1 against the white label — darkened to sit with its neighbours.
  res: "#c93a3c",
  resi: "#c93a3c",
};

/**
 * Per-file line stats from one edit-family tool call, or null for tools that
 * don't write files. Line counts come from the tool inputs (old/new string
 * sizes), so they're the same "±N" a diff would show for those hunks — minus
 * tools that only report paths, such as Bash and Codex FileChange.
 */
export function touchedFilesFromTool(entry: TranscriptEntry): TouchedFile[] {
  const input = entry.toolInput;
  if (!input || typeof input !== "object") return [];
  const inp = input as Record<string, unknown>;
  const lines = (v: unknown) =>
    typeof v === "string" && v.length > 0 ? v.split("\n").length : 0;
  // Engines disagree on casing: opencode writes `filePath`/`oldString`, the
  // Claude SDK `file_path`/`old_string`.
  const key = (...names: string[]) => {
    for (const n of names) if (typeof inp[n] === "string" && inp[n]) return inp[n] as string;
    return "";
  };
  const filePath = key("file_path", "filePath");
  switch (canonicalToolName(entry.toolName)) {
    case "Edit": {
      // MultiEdit: several hunks against one file.
      if (filePath && Array.isArray(inp.edits)) {
        let additions = 0;
        let deletions = 0;
        for (const e of inp.edits) {
          if (!e || typeof e !== "object") continue;
          const ee = e as Record<string, unknown>;
          additions += lines(ee.new_string ?? ee.newString);
          deletions += lines(ee.old_string ?? ee.oldString);
        }
        return [{ path: filePath, additions, deletions }];
      }
      if (filePath) {
        const oldStr = key("old_string", "oldString");
        const newStr = key("new_string", "newString");
        return [{
          path: filePath,
          additions: lines(newStr),
          deletions: lines(oldStr),
        }];
      }
      // codex's apply_patch names its files inside the patch body.
      return mergeTouchedFiles(patchTouchedFiles(key("patchText", "patch")));
    }
    case "Write":
      if (!filePath) return [];
      return [{
        path: filePath,
        additions: lines(inp.content),
        deletions: 0,
      }];
    case "NotebookEdit":
      if (typeof inp.notebook_path !== "string") return [];
      return [{
        path: inp.notebook_path,
        additions: lines(inp.new_source),
        deletions: 0,
      }];
    case "FileChange": {
      if (!Array.isArray(inp.changes)) return [];
      const files: TouchedFile[] = [];
      for (const change of inp.changes) {
        const path = fileChangePath(change);
        if (!path) continue;
        files.push({ path, additions: 0, deletions: 0 });
      }
      return mergeTouchedFiles(files);
    }
    default:
      return [];
  }
}

/** All files a turn's tool calls edited, merged per path in first-touch order. */
export function collectTouchedFiles(items: TranscriptEntry[]): TouchedFile[] {
  return mergeTouchedFiles(
    items.flatMap((it) => {
      if (it.type !== "tool_use") return [];
      return touchedFilesFromTool(it);
    })
  );
}

/**
 * Files (and ± line counts) from a codex-style patch body: "*** Update File:
 * src/x.ts" headers followed by +/- lines, as apply_patch sends them.
 */
function patchTouchedFiles(patch: string): TouchedFile[] {
  if (!patch) return [];
  const files: TouchedFile[] = [];
  let current: TouchedFile | null = null;
  for (const line of patch.split("\n")) {
    const header = line.match(/^\*\*\* (?:Add|Update|Delete) File: (.+)$/);
    if (header) {
      current = { path: header[1].trim(), additions: 0, deletions: 0 };
      files.push(current);
      continue;
    }
    if (!current || line.startsWith("***")) continue;
    if (line.startsWith("+")) current.additions++;
    else if (line.startsWith("-")) current.deletions++;
  }
  return files;
}

function mergeTouchedFiles(files: TouchedFile[]): TouchedFile[] {
  const byPath = new Map<string, TouchedFile>();
  for (const f of files) {
    const prev = byPath.get(f.path);
    if (prev) {
      prev.additions += f.additions;
      prev.deletions += f.deletions;
    } else {
      byPath.set(f.path, { ...f });
    }
  }
  return [...byPath.values()];
}

function fileChangePath(change: unknown): string | null {
  if (typeof change === "string") {
    const m = change.match(/^(?:add|delete|update)\s+(.+)$/);
    return (m?.[1] || change).trim() || null;
  }
  if (!change || typeof change !== "object") return null;
  const path = (change as Record<string, unknown>).path;
  return typeof path === "string" && path.trim() ? path : null;
}

// navigator.clipboard needs a secure context — opensession is served over plain
// http on the tailnet, so fall back to a hidden-textarea copy.
function copyText(text: string, onDone: () => void) {
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(text).then(onDone, () => fallbackCopy(text, onDone));
  } else {
    fallbackCopy(text, onDone);
  }
}

function fallbackCopy(text: string, onDone: () => void) {
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.style.position = "fixed";
  ta.style.opacity = "0";
  document.body.appendChild(ta);
  ta.select();
  try {
    document.execCommand("copy");
    onDone();
  } catch {
    // nothing else to fall back to
  } finally {
    ta.remove();
  }
}
