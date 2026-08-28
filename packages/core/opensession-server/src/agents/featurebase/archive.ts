/**
 * Archive Open Session sessions when their Featurebase ticket or post is done.
 * Two paths, same as Plain: the Featurebase webhook (status/close events) and
 * a periodic sweep if a webhook is missed.
 */
import { executeSessionProjection } from "../../server/session-projection-executor";
import { writeJsonAtomic } from "../../server/shared/atomic-write";
import { existsSync, readdirSync, readFileSync } from "fs";
import { OPENSESSION_SESSIONS_DIR } from "../../server/paths";
import { invalidateSessionsCache } from "../../server/session-cache";
import type { ExternalRef, NativeSessionFile } from "../../server/types";
import { getPost, getTicket, isTerminalStatusType } from "./api";

type Candidate = { path: string; data: NativeSessionFile };

function matchesRef(
  refs: ExternalRef[] | undefined,
  kind: string,
  id: string,
): boolean {
  return (refs || []).some((ref) => ref.kind === kind && ref.id === id);
}

function activeLinkedSessions(): Candidate[] {
  if (!existsSync(OPENSESSION_SESSIONS_DIR)) return [];
  const out: Candidate[] = [];
  for (const file of readdirSync(OPENSESSION_SESSIONS_DIR)) {
    if (!file.endsWith(".json")) continue;
    const path = `${OPENSESSION_SESSIONS_DIR}/${file}`;
    try {
      const data = JSON.parse(readFileSync(path, "utf-8")) as NativeSessionFile;
      if (!data.archived && data.externalRefs?.length) out.push({ path, data });
    } catch {}
  }
  return out;
}

export async function archiveSessionsForFeaturebaseRef(
  kind: string,
  id: string,
): Promise<number> {
  let archived = 0;
  for (const { path, data } of activeLinkedSessions()) {
    if (!matchesRef(data.externalRefs, kind, id)) continue;
    try {
      await executeSessionProjection(data.id, "featurebase_archive_set", () =>
        writeJsonAtomic(path, {
          ...data,
          archived: true,
          archivedAt: new Date().toISOString(),
          archivedReason: "featurebase",
        }),
      );
      archived++;
    } catch (error) {
      console.warn(
        `[featurebase-archive] Could not archive session ${data.id}:`,
        error,
      );
    }
  }
  if (archived > 0) invalidateSessionsCache();
  return archived;
}

async function refIsTerminal(kind: string, id: string): Promise<boolean> {
  try {
    if (kind === "featurebase-ticket") {
      const ticket = await getTicket(id);
      return !!ticket && isTerminalStatusType(ticket.status.type);
    }
    if (kind === "featurebase-post") {
      const post = await getPost(id);
      return !!post && isTerminalStatusType(post.status.type);
    }
  } catch {
    return false;
  }
  return false;
}

let sweepInterval: ReturnType<typeof setInterval> | null = null;

export function startFeaturebaseArchiveSweep(onChange?: () => void): void {
  if (sweepInterval) return;

  const sweep = async () => {
    const refs = new Map<string, { kind: string; id: string }>();
    for (const { data } of activeLinkedSessions()) {
      for (const ref of data.externalRefs || []) {
        if (
          ref.kind === "featurebase-ticket" ||
          ref.kind === "featurebase-post"
        ) {
          refs.set(`${ref.kind}:${ref.id}`, { kind: ref.kind, id: ref.id });
        }
      }
    }
    let archived = 0;
    for (const ref of [...refs.values()].slice(0, 40)) {
      if (await refIsTerminal(ref.kind, ref.id)) {
        archived += await archiveSessionsForFeaturebaseRef(ref.kind, ref.id);
      }
    }
    if (archived > 0) {
      console.log(
        `[featurebase-archive] Archived ${archived} session(s) for done tickets/posts`,
      );
      onChange?.();
    }
  };

  const runSweep = () => {
    void sweep().catch((error) =>
      console.error("[featurebase-archive] Sweep failed:", error),
    );
  };

  sweepInterval = setInterval(runSweep, 15 * 60 * 1000);
  setTimeout(runSweep, 60 * 1000);
  console.log("[featurebase-archive] Sweep started (15m interval)");
}

export function stopFeaturebaseArchiveSweep(): void {
  if (!sweepInterval) return;
  clearInterval(sweepInterval);
  sweepInterval = null;
}
