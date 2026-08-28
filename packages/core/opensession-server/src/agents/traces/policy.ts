import { baseJournalKind, INTERACTIVE_KINDS, isUnattendedKind } from "../../server/run-policy";
import type { NativeSessionFile } from "../../server/types";

export function shouldPublishSession(session: NativeSessionFile, journalKind?: string): boolean {
  if (session.automation) return false;
  const kind = baseJournalKind(journalKind);
  if (kind && isUnattendedKind(kind)) return false;
  if (kind && !INTERACTIVE_KINDS.has(kind)) return false;
  return true;
}
