import { configuredIntegration } from "../../server/config";
import { isEnabled } from "../../server/integrations/load";
import { findIntegration } from "../../server/integrations/registry";
import { hostname } from "os";

const DEFAULT_API_BASE = "https://actions.traces.com";

function trimString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function httpsOrigin(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return null;
    return value.replace(/\/$/, "");
  } catch {
    return null;
  }
}

export function tracesEnabled(): boolean {
  const spec = findIntegration("traces");
  return spec ? isEnabled(spec) : false;
}

export function tracesApiBase(): string {
  return (
    httpsOrigin(trimString(process.env.TRACES_API_BASE)) ||
    httpsOrigin(trimString(configuredIntegration("traces")?.apiBase)) ||
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
