import { configuredIntegration } from "../../server/config";
import { hostname } from "os";

const DEFAULT_API_BASE = "https://actions.traces.com";

function trimString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function tracesApiBase(): string {
  return (
    trimString(process.env.TRACES_API_BASE) ||
    trimString(configuredIntegration("traces")?.apiBase) ||
    DEFAULT_API_BASE
  );
}

/** Org slug to publish into, without @. Empty means the connected user's active namespace. */
export function tracesNamespaceSlug(): string | null {
  const raw =
    trimString(process.env.TRACES_NAMESPACE_SLUG) ||
    trimString(configuredIntegration("traces")?.namespaceSlug);
  return raw ? raw.replace(/^@/, "") : null;
}

export function tracesBin(): string {
  return trimString(process.env.TRACES_BIN) || "traces";
}

export function tracesDeviceName(): string {
  try {
    return `Open Session (${hostname()})`;
  } catch {
    return "Open Session";
  }
}
