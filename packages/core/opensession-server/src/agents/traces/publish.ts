/**
 * Publish an Open Session Pi transcript to traces.com as the session owner.
 */
import { existsSync, readdirSync, readFileSync, rmSync, statSync } from "fs";
import { join } from "path";
import { executeSessionProjection } from "../../server/session-projection-executor";
import { writeJsonAtomic } from "../../server/shared/atomic-write";
import { OPENSESSION_SESSIONS_DIR } from "../../server/paths";
import { PI_STATE_DIR } from "../../server/pi-runner";
import { invalidateSessionsCache } from "../../server/session-cache";
import type { NativeSessionFile } from "../../server/types";
import { tracesBin, tracesEnabled, tracesNamespaceSlug } from "./config";
import { markTracesAccountStale, tracesCredentialForLogin } from "./auth";
import { publisherLogin, shouldPublishSession } from "./policy";
import { tracesShareEnv } from "./share-env";

function sanitizeId(id: string): string {
  return id.replace(/[^A-Za-z0-9._-]/g, "_");
}

function readSession(id: string): NativeSessionFile | null {
  const path = `${OPENSESSION_SESSIONS_DIR}/${id}.json`;
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as NativeSessionFile;
  } catch {
    return null;
  }
}

function latestPiJsonl(osSessionId: string): string | null {
  const dir = `${PI_STATE_DIR}/sessions/${sanitizeId(osSessionId)}`;
  if (!existsSync(dir)) return null;
  let best: { path: string; mtime: number } | null = null;
  for (const name of readdirSync(dir)) {
    if (!name.endsWith(".jsonl")) continue;
    const path = join(dir, name);
    try {
      const mtime = statSync(path).mtimeMs;
      if (!best || mtime > best.mtime) best = { path, mtime };
    } catch {}
  }
  return best?.path ?? null;
}

const inflight = new Map<string, Promise<unknown>>();

export async function shareOpenSessionTrace(
  osSessionId: string,
  journalKind?: string,
): Promise<{ ok: boolean; skipped?: string; url?: string; error?: string }> {
  if (!tracesEnabled()) return { ok: true, skipped: "traces-disabled" };
  const session = readSession(osSessionId);
  if (!session) return { ok: false, skipped: "missing-session" };
  if (!shouldPublishSession(session, journalKind)) {
    return { ok: true, skipped: "not-human-interactive" };
  }
  const login = publisherLogin(session);
  if (!login) return { ok: true, skipped: "no-linked-identity" };
  const cred = tracesCredentialForLogin(login);
  if (!cred) return { ok: true, skipped: "traces-not-connected" };
  const sourcePath = latestPiJsonl(osSessionId);
  if (!sourcePath) return { ok: true, skipped: "no-pi-transcript" };

  const target = tracesNamespaceSlug() || cred.namespaceSlug;
  const args = [
    "share",
    ...(target ? [`@${target.replace(/^@/, "")}`] : []),
    "--source-path",
    sourcePath,
    "--agent",
    "pi",
    "--visibility",
    "private",
    "--json",
  ];
  const env = tracesShareEnv(cred.deviceKey);
  const scratchHome = env.HOME;
  try {
    const proc = Bun.spawn([tracesBin(), ...args], {
      stdout: "pipe",
      stderr: "pipe",
      env,
    });
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    if (exitCode !== 0) {
      const detail =
        (stderr || stdout).trim().slice(0, 500) ||
        `traces share exited ${exitCode}`;
      if (/401|AUTH_REQUIRED|not logged in|unauthorized/i.test(detail)) {
        markTracesAccountStale(login);
      }
      console.warn(`[traces] share failed for ${osSessionId}: ${detail}`);
      return { ok: false, error: detail };
    }
    let parsed: {
      data?: { sharedUrl?: string; traceId?: string };
      sharedUrl?: string;
      traceId?: string;
    } = {};
    try {
      parsed = JSON.parse(stdout);
    } catch {
      return { ok: false, error: "traces share returned non-JSON" };
    }
    const url = parsed.data?.sharedUrl || parsed.sharedUrl;
    const traceId = parsed.data?.traceId || parsed.traceId;
    if (!url && !traceId)
      return { ok: false, error: "traces share returned no url" };
    await recordShareRef(
      osSessionId,
      traceId || osSessionId,
      url || `https://traces.com/s/${traceId}`,
    );
    return { ok: true, url: url || undefined };
  } finally {
    try {
      rmSync(scratchHome, { recursive: true, force: true });
    } catch {}
  }
}

async function recordShareRef(
  sessionId: string,
  traceId: string,
  url: string,
): Promise<void> {
  const path = `${OPENSESSION_SESSIONS_DIR}/${sessionId}.json`;
  try {
    await executeSessionProjection(sessionId, "session_file_updated", () => {
      const data = JSON.parse(readFileSync(path, "utf-8")) as NativeSessionFile;
      const refs = data.externalRefs || [];
      const next = refs.some(
        (ref) => ref.kind === "traces-trace" && ref.id === traceId,
      )
        ? refs.map((ref) =>
            ref.kind === "traces-trace" && ref.id === traceId
              ? { ...ref, url }
              : ref,
          )
        : [
            ...refs,
            {
              kind: "traces-trace" as const,
              id: traceId,
              url,
              title: data.title,
            },
          ];
      writeJsonAtomic(path, { ...data, externalRefs: next });
    });
    invalidateSessionsCache();
  } catch (error) {
    console.warn(
      `[traces] could not record share ref for ${sessionId}:`,
      error,
    );
  }
}

export function scheduleShareOpenSessionTrace(
  osSessionId: string,
  journalKind?: string,
): void {
  const previous = inflight.get(osSessionId) || Promise.resolve();
  const next = previous
    .then(() => shareOpenSessionTrace(osSessionId, journalKind))
    .catch((error) =>
      console.warn(`[traces] share threw for ${osSessionId}:`, error),
    )
    .finally(() => {
      if (inflight.get(osSessionId) === next) inflight.delete(osSessionId);
    });
  inflight.set(osSessionId, next);
}
