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

const GITHUB_DELIVERIES_DIR = statePath(".opensession-github");
const GITHUB_DELIVERIES_STORE = join(GITHUB_DELIVERIES_DIR, "deliveries.json");
const GITHUB_DELIVERY_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_GITHUB_DELIVERIES = 500;
const githubDeliveryExpiry: Map<string, number> = ((globalThis as any).__githubDeliveryExpiry ??=
  new Map<string, number>());

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
    mkdirSync(GITHUB_DELIVERIES_DIR, { recursive: true });
    writeJsonAtomic(GITHUB_DELIVERIES_STORE, [...githubDeliveryExpiry], false);
  } catch (e) {
    console.error("[github] Failed to persist GitHub deliveries:", e);
  }
}

/** Restore replay protection after a full process restart. Call from the GitHub
 *  agent's startup, before the webhook server can hand it a delivery. */
export function loadGithubDeliveries(): void {
  githubDeliveryExpiry.clear();
  try {
    if (existsSync(GITHUB_DELIVERIES_STORE)) {
      const entries = JSON.parse(readFileSync(GITHUB_DELIVERIES_STORE, "utf-8")) as [string, number][];
      const now = Date.now();
      for (const [id, expiresAt] of entries) {
        if (typeof id === "string" && Number.isFinite(expiresAt) && expiresAt > now) {
          githubDeliveryExpiry.set(id, expiresAt);
        }
      }
      pruneGithubDeliveries(now);
      persistGithubDeliveries();
    }
  } catch (e) {
    console.error("[github] Failed to load GitHub deliveries:", e);
  }
}

/** True if this signed GitHub delivery was already accepted within its TTL. */
export function isGithubDeliveryProcessed(id: string): boolean {
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
  githubDeliveryExpiry.set(id, Date.now() + GITHUB_DELIVERY_TTL_MS);
  pruneGithubDeliveries();
  persistGithubDeliveries();
}
