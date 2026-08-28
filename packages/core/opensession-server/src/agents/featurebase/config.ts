import { configuredIntegration } from "../../server/config";

const DEFAULT_API_BASE = "https://do.featurebase.app";
const DEFAULT_API_VERSION = "2026-01-01.nova";

function trimString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function featurebaseApiKey(): string {
  return process.env.FEATUREBASE_API_KEY || "";
}

export function featurebaseWebhookSecret(): string {
  return process.env.FEATUREBASE_WEBHOOK_SECRET || "";
}

export function featurebaseApiBase(): string {
  const fromEnv = trimString(process.env.FEATUREBASE_API_BASE);
  if (fromEnv) return fromEnv.replace(/\/$/, "");
  const fromConfig = trimString(configuredIntegration("featurebase").apiBase);
  return (fromConfig || DEFAULT_API_BASE).replace(/\/$/, "");
}

export function featurebaseApiVersion(): string {
  const fromEnv = trimString(process.env.FEATUREBASE_API_VERSION);
  if (fromEnv) return fromEnv;
  const fromConfig = trimString(configuredIntegration("featurebase").apiVersion);
  return fromConfig || DEFAULT_API_VERSION;
}

/** Public Featurebase portal origin, used for deep links when the API omits a URL. */
export function featurebaseOrgUrl(): string | null {
  const fromEnv = trimString(process.env.FEATUREBASE_ORG_URL);
  if (fromEnv) return fromEnv.replace(/\/$/, "");
  const fromConfig = trimString(configuredIntegration("featurebase").orgUrl);
  return fromConfig ? fromConfig.replace(/\/$/, "") : null;
}

/** Admin that Open Session impersonates for human-gated replies and notes. */
export function featurebaseAdminId(): string | null {
  const fromEnv = trimString(process.env.FEATUREBASE_ADMIN_ID);
  if (fromEnv) return fromEnv;
  return trimString(configuredIntegration("featurebase").adminId);
}

export function featurebaseMentionHandle(): string | null {
  const fromEnv = trimString(process.env.FEATUREBASE_MENTION_HANDLE);
  const configured = fromEnv || trimString(configuredIntegration("featurebase").mentionHandle);
  return configured ? configured.replace(/^@/, "") : null;
}
