/**
 * GitHub webhook delivery replay protection.
 *
 * Owned by the GitHub agent, which serves `/github/webhook`, so a GitHub-only
 * install restores the store at startup even when the Slack agent is disabled.
 * GitHub signs the request body but has no timestamp tolerance, so delivery ids
 * are kept long enough to reject automatic and manual redeliveries, including
 * after a restart, while bounding both the file and the memory used for defense.
 */

import { existsSync, mkdirSync, readFileSync } from "fs";
import { join } from "path";
import { writeJsonAtomic } from "../../server/shared/atomic-write";
import { statePath } from "../../server/paths";

function githubDeliveriesDir(): string {
  return statePath(".opensession-github");
}

function githubDeliveriesStore(): string {
  return join(githubDeliveriesDir(), "deliveries.json");
}

function legacyGithubDeliveriesStore(): string {
  return statePath(".slack-sessions/github-deliveries.json");
}
const GITHUB_DELIVERY_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_GITHUB_DELIVERIES = 500;
const githubDeliveryExpiry: Map<string, number> = ((globalThis as any).__githubDeliveryExpiry ??=
  new Map<string, number>());

/**
 * The webhook server binds early in boot, long before the GitHub agent's
 * startup runs, so a redelivery that lands in that window would otherwise be
 * checked against an empty map and reprocessed. The read and write paths
 * restore the on-disk store on first touch instead, so replay protection is in
 * place from the first delivery regardless of boot ordering. Kept on globalThis
 * so a hot reload does not force a redundant reload of the shared map.
 */
function ensureGithubDeliveriesLoaded(): void {
  if ((globalThis as any).__githubDeliveriesLoaded !== true) loadGithubDeliveries();
}

function pruneGithubDeliveries(now = Date.now()): void {
  for (const [id, expiresAt] of githubDeliveryExpiry) {
    if (expiresAt <= now) githubDeliveryExpiry.delete(id);
  }
  // Map iteration is insertion ordered, so evict the oldest delivery first.
  while (githubDeliveryExpiry.size > MAX_GITHUB_DELIVERIES) {
    const oldest = githubDeliveryExpiry.keys().next().value;
    if (oldest === undefined) break;
    githubDeliveryExpiry.delete(oldest);
  }
}

function persistGithubDeliveries(): void {
  try {
    const dir = githubDeliveriesDir();
    mkdirSync(dir, { recursive: true });
    writeJsonAtomic(join(dir, "deliveries.json"), [...githubDeliveryExpiry], false);
  } catch (e) {
    console.error("[github] Failed to persist GitHub deliveries:", e);
  }
}

/** Restore replay protection from disk into the in-memory map after a restart.
 *  Called eagerly from the GitHub agent's startup and lazily on the first
 *  delivery access, whichever comes first. */
export function loadGithubDeliveries(): void {
  githubDeliveryExpiry.clear();
  try {
    const store = githubDeliveriesStore();
    const legacyStore = legacyGithubDeliveriesStore();
    const source = existsSync(store)
      ? store
      : existsSync(legacyStore)
        ? legacyStore
        : null;
    if (source) {
      const entries = JSON.parse(readFileSync(source, "utf-8")) as [string, number][];
      const now = Date.now();
      for (const [id, expiresAt] of entries) {
        if (typeof id === "string" && Number.isFinite(expiresAt) && expiresAt > now) {
          githubDeliveryExpiry.set(id, expiresAt);
        }
      }
      pruneGithubDeliveries(now);
      // Writing the new store makes a legacy read a one-time migration. The old
      // file is left untouched so upgrading never mutates Slack-owned state.
      persistGithubDeliveries();
    }
  } catch (e) {
    console.error("[github] Failed to load GitHub deliveries:", e);
  }
  (globalThis as any).__githubDeliveriesLoaded = true;
}

/** True if this signed GitHub delivery was already accepted within its TTL. */
export function isGithubDeliveryProcessed(id: string): boolean {
  ensureGithubDeliveriesLoaded();
  const expiresAt = githubDeliveryExpiry.get(id);
  if (expiresAt === undefined) return false;
  if (expiresAt <= Date.now()) {
    githubDeliveryExpiry.delete(id);
    persistGithubDeliveries();
    return false;
  }
  return true;
}

/** Record a signed GitHub delivery before dispatching its side effects. */
export function markGithubDeliveryProcessed(id: string): void {
  ensureGithubDeliveriesLoaded();
  githubDeliveryExpiry.set(id, Date.now() + GITHUB_DELIVERY_TTL_MS);
  pruneGithubDeliveries();
  persistGithubDeliveries();
}
