/**
 * Archive Open Session sessions when their Featurebase ticket or post is done.
 */
import { executeSessionProjection } from "../../server/session-projection-executor";
import { writeJsonAtomic } from "../../server/shared/atomic-write";
import { existsSync, readdirSync, readFileSync } from "fs";
import { OPENSESSION_SESSIONS_DIR } from "../../server/paths";
import { invalidateSessionsCache } from "../../server/session-cache";
import type { ExternalRef, NativeSessionFile } from "../../server/types";

type Candidate = { path: string; data: NativeSessionFile };

function matchesRef(refs: ExternalRef[] | undefined, kind: string, id: string): boolean {
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
          archivedReason: "auto",
        }),
      );
      archived++;
    } catch (error) {
      console.warn(`[featurebase-archive] Could not archive session ${data.id}:`, error);
    }
  }
  if (archived > 0) invalidateSessionsCache();
  return archived;
}

