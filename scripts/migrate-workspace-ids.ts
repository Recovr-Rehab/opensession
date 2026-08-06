/**
 * One-time data migration v2: `prj-` workspace ids → `ws-`, and the end of the
 * `projectId` dual-read.
 *
 * v1 (scripts/migrate-workspaces.ts) renamed the state DIRS and mirrored each
 * chat's `projectId` onto a new `workspaceId`, deliberately keeping `projectId`
 * for a one-release dual-read and leaving the `prj-` id prefix opaque. The
 * server and web UI now read/write `workspaceId` only and tolerate no `prj-`
 * id, so this migration retires both leftovers.
 *
 * What it does (idempotent, reversible):
 *   1. Renames every workspace record `prj-<uuid>` → `ws-<uuid>` (SAME uuid,
 *      prefix only): the file in ~/.opensession-workspaces and the `id` inside.
 *   2. In every chat file in ~/.opensession-chats: sets `workspaceId` to the
 *      migrated id (from `workspaceId` when present, else from the legacy
 *      `projectId`) and DELETES the `projectId` key.
 *   3. Rewrites every other persisted store that keys on a workspace id, so
 *      nothing dangles:
 *        - the per-user sidebar stores (~/.opensession-{pins,hides,snoozes,
 *          lanes,tab-colors,reads,folders,ui-prefs}/<user>.json), whose row
 *          keys are the composite `workspace:<id>` form;
 *        - the chats-dir registries (archive-registry.json,
 *          status-overrides.json, …), swept by the same pass as the chats;
 *        - ~/.opensession-scratch/<workspaceId>/ — scratch-mode working dirs
 *          are named after the workspace (worktree.ts ensureScratchDir) and
 *          their ABSOLUTE path is stored in chat/workspace `worktreeDir`, so
 *          the dir is renamed and every stored path is rewritten with it.
 *   4. Writes an idempotency marker + a rollback map into the workspaces dir.
 *
 * The rewrite is structural (a JSON walk over keys and string values), never a
 * blind text substitution: only a whole string that IS a workspace id
 * (`prj-<safe id>`), the composite row key (`workspace:prj-<safe id>`), or a
 * `.opensession-scratch/prj-<id>` path segment is touched. Prose that merely
 * mentions a `prj-…` id (chat titles, Slack transcripts, PR bodies, the audit
 * log, the search index) is left alone — those are historical records, not
 * keys. `prj-` is exclusively the workspace-id prefix (chat ids are
 * `os-`/`bks-`/`slack-`/`linear-`), so the lexical rule can't collide.
 *
 * Chats with neither key are left alone: the server backfills `workspaceId`
 * lazily (backfillWorkspaceId in src/server/workspace-resolve.ts), and wrapping
 * them would mint thousands of throwaway workspaces.
 *
 * Run it during a restart window — a live server resolves its state dirs at
 * boot and caches chats/registries in memory.
 *
 * Usage:
 *   bun scripts/migrate-workspace-ids.ts --dry-run       # preview, no writes
 *   bun scripts/migrate-workspace-ids.ts                 # apply
 *   bun scripts/migrate-workspace-ids.ts --home /tmp/copy  # test on a copy
 */

import { homedir } from "os";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
} from "fs";
import { writeJsonAtomic } from "../src/server/shared/atomic-write";

const args = process.argv.slice(2);
const DRY = args.includes("--dry-run");
const homeIdx = args.indexOf("--home");
const homeArg = homeIdx >= 0 ? args[homeIdx + 1] : undefined;
if (homeIdx >= 0 && (!homeArg || homeArg.startsWith("-"))) {
  console.error("--home needs a directory argument");
  process.exit(1);
}
const HOME = homeArg || process.env.HOME || homedir();

const WORKSPACES_DIR = `${HOME}/.opensession-workspaces`;
const CHATS_DIR = `${HOME}/.opensession-chats`;
const SCRATCH_DIR = `${HOME}/.opensession-scratch`;
/**
 * Per-user stores whose keys live in the sidebar row-key space (`workspace:<id>`
 * or a solo chat id) or are plain workspace ids. pins/hides/snoozes carry
 * workspace rows today; lanes/tab-colors/reads/folders/ui-prefs share the same
 * key space and are swept so a future entry can't dangle.
 */
const USER_STORES = [
  "pins",
  "hides",
  "snoozes",
  "lanes",
  "tab-colors",
  "reads",
  "folders",
  "ui-prefs",
];
const MARKER = "migration-v2-workspace-ids.json";
const ROLLBACK = "migration-v2-rollback.json";

function log(...a: unknown[]) {
  console.log(DRY ? "[dry-run]" : "[migrate]", ...a);
}

// ---------------------------------------------------------------------------
// The lexical rule
// ---------------------------------------------------------------------------

/**
 * A workspace id is `<prefix>-<safe id>`; `safeId` in src/server/workspaces.ts
 * caps the whole id at 64 chars of [A-Za-z0-9_-]. Anchored on both ends so
 * only a string that IS an id matches — never a sentence containing one.
 */
const PRJ_ID = /^prj-[A-Za-z0-9_-]{1,60}$/;
/** Sidebar row key for a workspace (pins/hides/snoozes) — see Sidebar.tsx mkRow. */
const PRJ_ROW_KEY = /^workspace:(prj-[A-Za-z0-9_-]{1,60})$/;
/** A scratch working dir inside an absolute `worktreeDir` path. */
const PRJ_SCRATCH_PATH = /(\.opensession-scratch\/)prj-([A-Za-z0-9_-]{1,60})(?=\/|$)/;

/** `prj-<uuid>` → `ws-<uuid>`: same uuid, prefix only. */
function migrateId(id: string): string {
  return `ws-${id.slice("prj-".length)}`;
}

/** The migrated form of a string, or null when it isn't a workspace id at all. */
function rewriteString(s: string): string | null {
  if (PRJ_ID.test(s)) return migrateId(s);
  const row = PRJ_ROW_KEY.exec(s);
  if (row) return `workspace:${migrateId(row[1]!)}`;
  if (PRJ_SCRATCH_PATH.test(s))
    return s.replace(PRJ_SCRATCH_PATH, (_m, prefix, rest) => `${prefix}ws-${rest}`);
  return null;
}

interface Rewritten {
  value: unknown;
  changed: number;
}

/**
 * Structural rewrite of a parsed JSON value: object KEYS (the composite row
 * keys) and string VALUES (ids, scratch paths), recursively. Returns the
 * original reference when nothing changed so callers can skip the write.
 */
function rewriteDeep(input: unknown): Rewritten {
  if (typeof input === "string") {
    const next = rewriteString(input);
    return next === null ? { value: input, changed: 0 } : { value: next, changed: 1 };
  }
  if (Array.isArray(input)) {
    let changed = 0;
    const out = input.map((v) => {
      const r = rewriteDeep(v);
      changed += r.changed;
      return r.value;
    });
    if (!changed) return { value: input, changed: 0 };
    // A rewrite can collapse two entries onto one id (a list already holding
    // the `ws-` form). De-dupe string lists (pins) rather than leave a dup.
    const deduped = out.every((v) => typeof v === "string")
      ? Array.from(new Set(out as string[]))
      : out;
    if (deduped.length !== out.length)
      log(`  de-duped ${out.length - deduped.length} list entr(y|ies) merged by the rename`);
    return { value: deduped, changed };
  }
  if (input && typeof input === "object") {
    let changed = 0;
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
      const nextKey = rewriteString(key);
      if (nextKey !== null) changed++;
      const r = rewriteDeep(value);
      changed += r.changed;
      const k = nextKey ?? key;
      if (nextKey !== null && k in out)
        log(`  WARN key ${key} → ${k} collides with an existing entry — keeping the later value`);
      out[k] = r.value;
    }
    return changed ? { value: out, changed } : { value: input, changed: 0 };
  }
  return { value: input, changed: 0 };
}

function readJson(path: string): unknown | undefined {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return undefined;
  }
}

/** Sweep one JSON file structurally. Returns how many strings/keys it rewrote. */
function sweepJsonFile(path: string): number {
  const parsed = readJson(path);
  if (parsed === undefined) return 0;
  const { value, changed } = rewriteDeep(parsed);
  if (changed && !DRY) writeJsonAtomic(path, value);
  return changed;
}

/** Sweep every top-level `*.json` in a store dir. Returns [files, rewrites]. */
function sweepStoreDir(dir: string): [number, number] {
  if (!existsSync(dir)) return [0, 0];
  let files = 0;
  let rewrites = 0;
  for (const name of readdirSync(dir)) {
    if (!name.endsWith(".json")) continue;
    const p = `${dir}/${name}`;
    try {
      if (!statSync(p).isFile()) continue;
    } catch {
      continue;
    }
    const n = sweepJsonFile(p);
    if (n) {
      files++;
      rewrites += n;
      log(`  ${p}: ${n} key/value rewrite(s)`);
    }
  }
  return [files, rewrites];
}

// ---------------------------------------------------------------------------
// Steps
// ---------------------------------------------------------------------------

interface Rollback {
  at: string;
  home: string;
  /** Every workspace id this run renamed — the reverse map (ws- → prj-). */
  renamedWorkspaces: Array<{ from: string; to: string }>;
  /** Scratch working dirs renamed alongside their workspace. */
  renamedScratchDirs: Array<{ from: string; to: string }>;
  /** Chat ids whose legacy `projectId` key this run deleted. */
  droppedProjectId: string[];
  storeRewrites: Record<string, number>;
}

/** 1. Rename the workspace records themselves. */
function migrateWorkspaceFiles(rollback: Rollback): {
  renamed: number;
  conflicts: number;
  swept: number;
} {
  let renamed = 0;
  let conflicts = 0;
  let swept = 0;
  if (!existsSync(WORKSPACES_DIR)) {
    log(`WARN no workspaces dir at ${WORKSPACES_DIR} — nothing to rename`);
    return { renamed, conflicts, swept };
  }
  for (const name of readdirSync(WORKSPACES_DIR)) {
    if (!name.endsWith(".json")) continue;
    const oldId = name.slice(0, -".json".length);
    if (!PRJ_ID.test(oldId)) {
      // Already-`ws-` records still need the structural sweep: one can hold a
      // `worktreeDir` pointing into a scratch dir named after a `prj-`
      // workspace. The migration bookkeeping files (migration-*.json, incl.
      // v1's rollback map) are deliberately NOT swept — they are historical
      // reverse maps and rewriting them would destroy the way back.
      if (oldId.startsWith("ws-")) swept += sweepJsonFile(`${WORKSPACES_DIR}/${name}`);
      continue;
    }
    const newId = migrateId(oldId);
    const from = `${WORKSPACES_DIR}/${name}`;
    const to = `${WORKSPACES_DIR}/${newId}.json`;
    if (existsSync(to)) {
      log(`WARN ${newId}.json already exists — leaving ${name} in place`);
      conflicts++;
      continue;
    }
    const record = readJson(from);
    if (record && typeof record === "object" && !Array.isArray(record)) {
      // Rewrite first (catches a scratch `worktreeDir`), then force the id:
      // the filename is the authority, an inner `id` that disagrees is stale.
      const { value } = rewriteDeep(record);
      const next = { ...(value as Record<string, unknown>), id: newId };
      if (!DRY) {
        writeJsonAtomic(to, next);
        rmSync(from);
      }
    } else {
      // Unparseable/odd record: still rename so the id space is consistent.
      log(`WARN ${name} is not a JSON object — renaming the file only`);
      if (!DRY) renameSync(from, to);
    }
    rollback.renamedWorkspaces.push({ from: oldId, to: newId });
    renamed++;
  }
  return { renamed, conflicts, swept };
}

/** 2 + 3a. Chat files (workspaceId/projectId) and the chats-dir registries. */
function migrateChats(rollback: Rollback): {
  files: number;
  filed: number;
  workspaceIdSet: number;
  droppedProjectId: number;
  registryFiles: number;
  registryRewrites: number;
} {
  const out = {
    files: 0,
    filed: 0,
    workspaceIdSet: 0,
    droppedProjectId: 0,
    registryFiles: 0,
    registryRewrites: 0,
  };
  if (!existsSync(CHATS_DIR)) {
    log(`WARN no chats dir at ${CHATS_DIR} — nothing to update`);
    return out;
  }
  for (const name of readdirSync(CHATS_DIR)) {
    if (!name.endsWith(".json")) continue;
    const p = `${CHATS_DIR}/${name}`;
    try {
      if (!statSync(p).isFile()) continue;
    } catch {
      continue;
    }
    const parsed = readJson(p);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) continue;
    const chat = parsed as Record<string, unknown>;
    out.files++;

    // A chat filed under a workspace carries one of the two keys. Native chats
    // carry a full record with `id`; a Slack/Linear chat has an OVERLAY file
    // here (updateSessionFile in session-cache.ts) holding only the fields
    // Open Session owns — `{projectId, workspaceId, rev}`, no `id` — because
    // the foreign agent's own session file is read-only for us. The filename
    // is the id in that case, so key on the fields, not on `id`.
    const filed = "projectId" in chat || "workspaceId" in chat;
    let dirty = false;

    if (filed) {
      out.filed++;
      const chatId = typeof chat.id === "string" ? chat.id : name.slice(0, -".json".length);
      // The single source of truth is `workspaceId`; `projectId` is the legacy
      // mirror v1 kept for the dual-read. Prefer the new key, fall back to it.
      const current = typeof chat.workspaceId === "string" ? chat.workspaceId : undefined;
      const legacy = typeof chat.projectId === "string" ? chat.projectId : undefined;
      const source = current || legacy;
      if (source) {
        const next = PRJ_ID.test(source) ? migrateId(source) : source;
        if (chat.workspaceId !== next) {
          chat.workspaceId = next;
          dirty = true;
          out.workspaceIdSet++;
        }
      }
      if ("projectId" in chat) {
        delete chat.projectId;
        dirty = true;
        out.droppedProjectId++;
        rollback.droppedProjectId.push(chatId);
      }
    }

    // Everything else (scratch `worktreeDir`, attachedRepos[].dir, the
    // chats-dir registries keyed by row key) goes through the structural
    // rewrite.
    const { value, changed } = rewriteDeep(chat);
    if (changed) {
      dirty = true;
      if (!filed) {
        out.registryFiles++;
        out.registryRewrites += changed;
        log(`  ${name}: ${changed} key/value rewrite(s)`);
      }
    }
    if (dirty && !DRY) writeJsonAtomic(p, value);
  }
  return out;
}

/** 3b. Scratch working dirs are named after the workspace that owns them. */
function migrateScratchDirs(rollback: Rollback): number {
  if (!existsSync(SCRATCH_DIR)) return 0;
  let renamed = 0;
  for (const name of readdirSync(SCRATCH_DIR)) {
    if (!PRJ_ID.test(name)) continue;
    const to = migrateId(name);
    if (existsSync(`${SCRATCH_DIR}/${to}`)) {
      log(`WARN scratch dir ${to} already exists — leaving ${name} in place`);
      continue;
    }
    log(`scratch dir ${name} → ${to}`);
    if (!DRY) renameSync(`${SCRATCH_DIR}/${name}`, `${SCRATCH_DIR}/${to}`);
    rollback.renamedScratchDirs.push({ from: name, to });
    renamed++;
  }
  return renamed;
}

// ---------------------------------------------------------------------------

function main() {
  log(`home ${HOME}`);
  const markerPath = `${WORKSPACES_DIR}/${MARKER}`;
  if (existsSync(markerPath))
    log(`marker ${MARKER} present — every step is idempotent, continuing`);

  const rollback: Rollback = {
    at: new Date().toISOString(),
    home: HOME,
    renamedWorkspaces: [],
    renamedScratchDirs: [],
    droppedProjectId: [],
    storeRewrites: {},
  };

  log("1/4 workspace records");
  const ws = migrateWorkspaceFiles(rollback);

  log("2/4 chats");
  const chats = migrateChats(rollback);
  if (chats.registryFiles)
    rollback.storeRewrites["chats-dir registries"] = chats.registryRewrites;

  log("3/4 scratch dirs + per-user stores");
  const scratch = migrateScratchDirs(rollback);
  for (const store of USER_STORES) {
    const [files, rewrites] = sweepStoreDir(`${HOME}/.opensession-${store}`);
    if (files) rollback.storeRewrites[store] = rewrites;
  }

  log("4/4 marker + rollback map");
  const storeRewrites = Object.values(rollback.storeRewrites).reduce((a, b) => a + b, 0);
  const touched =
    ws.renamed +
      ws.swept +
      chats.workspaceIdSet +
      chats.droppedProjectId +
      scratch +
      storeRewrites >
    0;
  if (!DRY) {
    if (!existsSync(WORKSPACES_DIR)) mkdirSync(WORKSPACES_DIR, { recursive: true });
    // A re-run that changed nothing must not clobber the map that records what
    // the FIRST run did — that map is the only way back. A re-run that did
    // change something (data arrived between runs) gets its own timestamped
    // map rather than overwriting its predecessor.
    if (!touched) {
      log("no changes — leaving the existing rollback map + marker untouched");
    } else {
      const preferred = `${WORKSPACES_DIR}/${ROLLBACK}`;
      const path = existsSync(preferred)
        ? `${WORKSPACES_DIR}/${ROLLBACK.replace(/\.json$/, "")}-${rollback.at.replace(/[:.]/g, "")}.json`
        : preferred;
      log(`rollback map → ${path}`);
      writeJsonAtomic(path, rollback);
    }
  }
  if (!DRY && (touched || !existsSync(markerPath))) {
    writeJsonAtomic(markerPath, {
      ranAt: rollback.at,
      workspacesRenamed: ws.renamed,
      existingWorkspacesSwept: ws.swept,
      chatFilesScanned: chats.files,
      chatsFiledUnderAWorkspace: chats.filed,
      workspaceIdSet: chats.workspaceIdSet,
      projectIdDropped: chats.droppedProjectId,
      scratchDirsRenamed: scratch,
      storeRewrites: rollback.storeRewrites,
    });
  }

  console.log("");
  log("summary");
  log(`  workspaces renamed prj-→ws- : ${ws.renamed}${ws.conflicts ? ` (${ws.conflicts} skipped: target id already exists)` : ""}`);
  log(`  existing ws- records fixed  : ${ws.swept} (stale scratch worktreeDir)`);
  log(`  chat files scanned          : ${chats.files} (${chats.filed} filed under a workspace)`);
  log(`  chats workspaceId set       : ${chats.workspaceIdSet}`);
  log(`  chats projectId dropped     : ${chats.droppedProjectId}`);
  log(`  scratch dirs renamed        : ${scratch}`);
  const stores = Object.entries(rollback.storeRewrites);
  if (!stores.length) log("  other stores                : no workspace-id keys to rewrite");
  for (const [store, n] of stores) log(`  store ${store.padEnd(22)}: ${n} key/value rewrite(s)`);
  if (DRY) log("nothing was written (--dry-run)");
}

main();
