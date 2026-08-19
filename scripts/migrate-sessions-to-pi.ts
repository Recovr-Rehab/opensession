#!/usr/bin/env bun
/**
 * Fleet migration of Open Session session records onto Pi.
 *
 * Dry-run by default. Pass --execute to write, --include-archived to include
 * archived sessions, and --verbose to print every row. The migration preserves
 * each concrete model tier where Pi can serve it, records modelHistory, keeps
 * lastActivity unchanged, and leaves in-flight runs alone for a later retry.
 */
import { readdirSync, readFileSync } from "fs";
import { OPENSESSION_SESSIONS_DIR } from "../packages/core/opensession-server/src/server/paths";
import {
  getDefaultModel,
  toPiModel,
} from "../packages/core/opensession-server/src/server/models";
import {
  migrateSessionEngine,
  sessionHasJournaledRun,
} from "../packages/core/opensession-server/src/server/migrate-engine";
import type { NativeSessionFile } from "../packages/core/opensession-server/src/server/types";

const argv = process.argv.slice(2);
const execute = argv.includes("--execute");
const includeArchived = argv.includes("--include-archived");
const verbose = argv.includes("--verbose");
const filterIndex = argv.indexOf("--filter");
const filter = filterIndex >= 0 ? argv[filterIndex + 1]?.toLowerCase() : undefined;

const skipFiles = new Set([
  "active-runs.json",
  "active-worktrees.json",
  "active-at-shutdown.json",
  "archive-registry.json",
  "message-queue.json",
  "prompt-queues.json",
  "worktree-channels.json",
]);

type Row = {
  id: string;
  title: string;
  from: string;
  to?: string;
  archived: boolean;
  skip?: string;
};

const rows: Row[] = [];
for (const file of readdirSync(OPENSESSION_SESSIONS_DIR)) {
  if (!file.endsWith(".json") || skipFiles.has(file)) continue;
  let data: NativeSessionFile;
  try {
    data = JSON.parse(
      readFileSync(`${OPENSESSION_SESSIONS_DIR}/${file}`, "utf8")
    );
  } catch {
    continue;
  }
  if (!data?.id) continue;
  const haystack = `${data.id} ${data.title || ""} ${data.branch || ""}`.toLowerCase();
  if (filter && !haystack.includes(filter)) continue;

  const row: Row = {
    id: data.id,
    title: (data.title || data.branch || "").slice(0, 60),
    from: data.model || "(default)",
    archived: !!data.archived,
  };
  if (data.model?.startsWith("pi/")) row.skip = "already Pi";
  else if (data.archived && !includeArchived) row.skip = "archived";
  else if (sessionHasJournaledRun(data.id, data)) row.skip = "active run";
  else {
    row.to = toPiModel(data.model || getDefaultModel());
    if (!row.to) row.skip = "no Pi mapping";
  }
  rows.push(row);
}

const candidates = rows.filter((row) => row.to && !row.skip);
const skipped = rows.filter((row) => row.skip);
const skipCounts = Object.fromEntries(
  [...new Set(skipped.map((row) => row.skip!))]
    .sort()
    .map((reason) => [reason, skipped.filter((row) => row.skip === reason).length])
);
const mappingCounts = Object.entries(
  candidates.reduce<Record<string, number>>((counts, row) => {
    const key = `${row.from} -> ${row.to}`;
    counts[key] = (counts[key] || 0) + 1;
    return counts;
  }, {})
).sort((a, b) => b[1] - a[1]);

console.log(
  JSON.stringify(
    {
      store: OPENSESSION_SESSIONS_DIR,
      execute,
      includeArchived,
      candidates: candidates.length,
      skipped: skipCounts,
      mappings: Object.fromEntries(mappingCounts),
    },
    null,
    2
  )
);
if (verbose) {
  for (const row of rows) {
    console.log(
      `${row.id}\t${row.from}\t${row.to || "-"}\t${row.skip || "migrate"}\t${row.title}`
    );
  }
}
if (!execute) process.exit(0);

let migrated = 0;
const failures: Array<{ id: string; error: string }> = [];
for (const row of candidates) {
  const result = migrateSessionEngine(
    row.id,
    row.to!,
    "migrate-sessions-to-pi",
    { preserveActivity: true }
  );
  if (result.ok) migrated++;
  else failures.push({ id: row.id, error: result.error });
}
console.log(JSON.stringify({ migrated, failures }, null, 2));
if (failures.length) process.exitCode = 1;
