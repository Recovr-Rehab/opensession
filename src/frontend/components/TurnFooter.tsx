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
import { canonicalToolName, useToolPathRoots } from "./ToolCallBlock";
import { tidyPath, type PathRoot } from "../lib/tidy-path";
import { useIsPhone } from "../hooks/useIsPhone";
import { LANG_MARKS } from "./lang-marks";

export interface TouchedFile {
  path: string;
  additions: number;
  deletions: number;
}

/**
 * The row sits 10px into the answer above it, closing the turn's own 18px
 * bottom margin to 8px: these actions belong to that answer, and a full row
 * gap read as the next block starting.
 *
 * It is a class the CALLER places rather than one the row wears, because the
 * lift only works on a box nothing clips. TranscriptBlocks wraps each block in
 * VirtualTranscriptBlock, whose `content-visibility: auto` applies layout and
 * paint containment: layout containment stops this margin collapsing out
 * through the wrapper, so the row hangs 10px above the wrapper's box, and
 * paint containment then clips exactly those 10px off the top, taking half the
 * duration and the top of every chip with them. On that wrapper the same class
 * is a plain margin, outside the box it contains.
 */
export const TURN_FOOTER_LIFT = "-mt-2.5";

interface Props {
  /** The turn's final answer entry — copy copies its markdown, fork forks from it. */
  entry: TranscriptEntry;
  durationMs: number;
  /** Where the caller puts the row. TURN_FOOTER_LIFT when nothing contains it. */
  className?: string;
  /** Files the turn's tool calls wrote, merged per path in first-touch order. */
  files: TouchedFile[];
  /** Scratch files the turn wrote (`opensession-assets`), in first-write order. */
  assets: string[];
  onFork?: (entryId: string) => void;
}

/**
 * Quiet answer actions plus produced assets, and which files the turn wrote.
 * Work duration and model stay one click away.
 *
 * Nothing here is hover-revealed. Which files a turn touched, and how long it
 * took, are the answer's result — read as often as the answer itself — and an
 * affordance you have to hover to find is one you have to already suspect is
 * there. The row is muted instead: faint ink under the answer, at a size that
 * reads past. The full file list, with paths rather than bare names, is in the
 * ⋯ menu, which is also where a narrow row's "+N more" resolves.
 */
export const TurnFooter = React.memo(function TurnFooter({
  entry,
  durationMs,
  files,
  assets,
  onFork,
  className,
}: Props) {
  const pathRoots = useToolPathRoots();
  const isPhone = useIsPhone();
  const [copied, setCopied] = useState(false);
  const doCopy = () => {
    copyText(entry.content, () => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  const duration = formatDuration(durationMs);

  return (
    <div
      className={cn(
        "mx-auto mb-[18px] flex w-full max-w-[var(--session-col)] flex-wrap items-center gap-x-0.5 gap-y-1.5",
        className
      )}
    >
      {duration && (
        <span className="mr-1.5 pl-1 text-meta font-medium leading-4 text-faint">
          {duration}
        </span>
      )}
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
          <Menu.Popup
            side="bottom"
            align="start"
            sideOffset={4}
            className="max-w-[380px]"
          >
            {onFork && (
              <Menu.Item onClick={() => onFork(entry.id)}>
                <IconBranches size={20} className="text-faint" />
                Fork from here
              </Menu.Item>
            )}
            {onFork && <Menu.Separator className="my-1" />}
            <div className="flex items-center gap-2 px-2.5 py-1.5 text-xs font-medium text-faint">
              <IconClock size={20} />
              {fullTime(entry.timestamp)}
            </div>
            {entry.model && (
              <div className="flex items-center gap-2 px-2.5 py-1.5 text-xs font-medium text-faint">
                <IconSparkle size={20} />
                Written by {messageModelLabel(entry.model)}
              </div>
            )}
            {/* The chips' non-hover home. Paths are tidied rather than cut to
                the filename: with room for the whole line, which of two
                same-named files a turn touched is worth more than the space. */}
            {files.length > 0 && (
              <>
                <Menu.Separator className="my-1" />
                {/* GroupLabel MUST live inside a Group — bare it throws Base UI
                    error #31 and white-screens the app on open. */}
                <Menu.Group>
                  <Menu.GroupLabel className="px-2.5 pt-0.5">
                    Changed files
                  </Menu.GroupLabel>
                  {files.slice(0, MAX_MENU_FILES).map((f) => (
                    <div
                      key={f.path}
                      className="flex items-center gap-2 px-2.5 py-1 text-xs font-medium text-faint"
                    >
                      <ExtBadge name={fileName(f.path)} />
                      <span className="min-w-0 flex-1 truncate text-dim">
                        {tidyPath(f.path, pathRoots)}
                      </span>
                      <LineStats
                        additions={f.additions}
                        deletions={f.deletions}
                      />
                    </div>
                  ))}
                  {files.length > MAX_MENU_FILES && (
                    <div className="px-2.5 py-1 text-xs font-medium text-faint">
                      +{files.length - MAX_MENU_FILES} more
                    </div>
                  )}
                </Menu.Group>
              </>
            )}
          </Menu.Popup>
        </Menu.Root>
      </div>
      <TouchedFileChips files={files} max={isPhone ? 1 : MAX_CHIPS} />
    </div>
  );
}, turnFooterPropsEqual);

/**
 * The files a turn wrote, named with the ±lines each moved, and one count for
 * whatever is past `max`. Shared by this footer and the work fold's summary, so
 * a turn reports its files in the same shape wherever you read it.
 *
 * Chips keep their natural width and wrap with the row rather than sharing a
 * shrinking box: a chip spends ~60px on its ± counts before it spends any on
 * the name, so a row that seats them by shrinking crushes exactly the part
 * worth reading — at 390px both names went to nothing and left two bare
 * "TS +160" chips.
 */
export function TouchedFileChips({
  files,
  max,
}: {
  files: TouchedFile[];
  max: number;
}) {
  const pathRoots = useToolPathRoots();
  const shown = files.slice(0, max);
  const rest = files.slice(shown.length);
  return (
    <>
      {shown.map((f) => (
        <FileChip key={f.path} file={f} roots={pathRoots} />
      ))}
      {rest.length > 0 && <MoreChip files={rest} />}
    </>
  );
}

function turnFooterPropsEqual(prev: Props, next: Props): boolean {
  if (
    prev.entry !== next.entry ||
    prev.durationMs !== next.durationMs ||
    prev.onFork !== next.onFork ||
    prev.className !== next.className ||
    prev.assets.length !== next.assets.length ||
    prev.files.length !== next.files.length
  )
    return false;
  for (let i = 0; i < next.assets.length; i++)
    if (prev.assets[i] !== next.assets[i]) return false;
  for (let i = 0; i < next.files.length; i++) {
    const a = prev.files[i];
    const b = next.files[i];
    if (
      a.path !== b.path ||
      a.additions !== b.additions ||
      a.deletions !== b.deletions
    )
      return false;
  }
  return true;
}

const BTN =
  "flex size-6 flex-shrink-0 cursor-pointer items-center justify-center rounded-sm border-0 bg-transparent p-0 text-faint hover:bg-hover hover:text-dim";

/** The whole row is always on the page, and muted rather than hidden: an
 * action you can see is one you know exists, and `text-faint` on a transparent
 * button is quiet enough to read past. The colour is the only thing separating
 * it from the answer — hover and focus still bring both up. */
const ACTIONS = "flex items-center gap-0.5";

/** Named files in the row; the rest collapse into MoreChip. A phone seats one;
 * the ⋯ menu is the complete list either way. */
const MAX_CHIPS = 2;

/** The menu has room to name more of them, being a list rather than a row. */
const MAX_MENU_FILES = 10;

function fileName(path: string): string {
  return path.split("/").pop() || path;
}

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

/** The shared chip shell: the footer's file and asset chips are the same
 * object with different tails (± counts, or a way in). */
const CHIP =
  "ml-1 flex h-6 min-w-0 items-center gap-1.5 overflow-hidden rounded-control border-0 bg-fg/[0.03] py-0 pl-1 text-left";

/**
 * One file the turn wrote, with the ±lines it moved there. A label rather than
 * a button: the per-file diff lives in the Changes tab, which reads the real
 * worktree instead of these tool inputs, and a chip that looked clickable
 * would promise a second, disagreeing answer. The tooltip carries the path the
 * name was cut from.
 */
function FileChip({
  file,
  roots,
}: {
  file: TouchedFile;
  roots: readonly PathRoot[];
}) {
  const name = fileName(file.path);
  return (
    <Tooltip label={tidyPath(file.path, roots)}>
      <span className={cn(CHIP, "pr-1.5")}>
        <ExtBadge name={name} />
        <span className={cn("max-w-[180px] truncate text-dim", FOOTER_TEXT)}>
          {name}
        </span>
        <LineStats additions={file.additions} deletions={file.deletions} />
      </span>
    </Tooltip>
  );
}

/** Everything past the row's chip budget, as one count plus its own totals. */
function MoreChip({ files }: { files: TouchedFile[] }) {
  const additions = files.reduce((n, f) => n + f.additions, 0);
  const deletions = files.reduce((n, f) => n + f.deletions, 0);
  return (
    <Tooltip
      label={
        files.slice(0, 12).map((f) => fileName(f.path)).join(", ") +
        (files.length > 12 ? ", …" : "")
      }
    >
      <span className="ml-1 flex h-6 flex-shrink-0 items-center gap-1.5 rounded-md px-1.5">
        <span className={cn("text-faint", FOOTER_TEXT)}>
          +{files.length} more
        </span>
        <LineStats additions={additions} deletions={deletions} />
      </span>
    </Tooltip>
  );
}

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
