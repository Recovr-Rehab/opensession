/** Discovery and generated Caddy configuration for sandbox ingress. */

import { configuredServer } from "../config";
import { sandboxConfig } from "./config";

export interface SandboxIngressStatus {
  configuredUrl?: string;
  proposedUrl?: string;
  source: "sandbox_config" | "caddy_webhook" | "public_ui" | "none";
  health: "ready" | "unreachable" | "not_configured";
  caddyAdminReachable: boolean;
  generatedSnippet: string;
  note?: string;
}

function normalizeOrigin(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "wss:") return undefined;
    return `https://${url.host}`;
  } catch {
    return undefined;
  }
}

export function webhookHostsFromCaddy(config: unknown): string[] {
  const found = new Set<string>();
  function walk(value: unknown, inheritedHosts: string[] = []): void {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) {
      for (const child of value) walk(child, inheritedHosts);
      return;
    }
    const object = value as Record<string, unknown>;
    let hosts = inheritedHosts;
    if (Array.isArray(object.match)) {
      const matched = object.match.flatMap((entry: any) =>
        Array.isArray(entry?.host) ? entry.host.filter((host: unknown) => typeof host === "string") : [],
      );
      if (matched.length) hosts = matched;
    }
    if (object.handler === "reverse_proxy" && Array.isArray(object.upstreams)) {
      const webhook = object.upstreams.some((upstream: any) =>
        /(^|:)3848$/.test(String(upstream?.dial || "")),
      );
      if (webhook) for (const host of hosts) found.add(host);
    }
    for (const child of Object.values(object)) walk(child, hosts);
  }
  walk(config);
  return [...found];
}

export function caddyfileImportsManagedFragment(
  caddyfile: string,
  fragment = "/etc/caddy/opensession.d/sandbox-ingress.caddy",
): boolean {
  return caddyfile
    .split(/\r?\n/)
    .map((line) => line.trim())
    .some(
      (line) =>
        line === `import ${fragment}` ||
        (fragment.startsWith("/etc/caddy/opensession.d/") &&
          line === "import /etc/caddy/opensession.d/*.caddy"),
    );
}

export function caddyIngressSnippet(origin: string): string {
  const host = new URL(origin).host;
  return `${host} {\n    handle /run-ws/* {\n        reverse_proxy 127.0.0.1:3860\n    }\n    handle /rpc-ws {\n        reverse_proxy 127.0.0.1:3860\n    }\n    handle /ingress-health {\n        reverse_proxy 127.0.0.1:3860\n    }\n    handle {\n        reverse_proxy 127.0.0.1:3848\n    }\n}`;
}

async function health(origin: string | undefined): Promise<"ready" | "unreachable" | "not_configured"> {
  if (!origin) return "not_configured";
  try {
    const response = await fetch(`${origin}/ingress-health`, {
      signal: AbortSignal.timeout(5_000),
    });
    return response.ok && (await response.text()).trim() === "ok" ? "ready" : "unreachable";
  } catch {
    return "unreachable";
  }
}

export async function sandboxIngressStatus(): Promise<SandboxIngressStatus> {
  const configured = normalizeOrigin(
    sandboxConfig().publicIngress?.publicBaseUrl || sandboxConfig().callbackBaseUrl,
  );
  let caddyAdminReachable = false;
  let caddyHosts: string[] = [];
  try {
    const response = await fetch(`${configuredServer().caddyAdmin.replace(/\/$/, "")}/config/`, {
      signal: AbortSignal.timeout(2_000),
    });
    if (response.ok) {
      caddyAdminReachable = true;
      caddyHosts = webhookHostsFromCaddy(await response.json());
    }
  } catch {}
  const caddyOrigin = caddyHosts.length === 1 ? `https://${caddyHosts[0]}` : undefined;
  const publicUi = normalizeOrigin(configuredServer().publicBaseUrl);
  const proposed = configured || caddyOrigin || publicUi;
  const source: SandboxIngressStatus["source"] = configured
    ? "sandbox_config"
    : caddyOrigin
      ? "caddy_webhook"
      : publicUi
        ? "public_ui"
        : "none";
  return {
    ...(configured ? { configuredUrl: configured } : {}),
    ...(proposed ? { proposedUrl: proposed } : {}),
    source,
    health: await health(configured),
    caddyAdminReachable,
    generatedSnippet: caddyIngressSnippet(proposed || "https://ingress.example.com"),
    ...(caddyHosts.length > 1
      ? { note: "More than one Caddy host routes to the webhook listener; choose the public origin explicitly." }
      : !configured && caddyOrigin
        ? { note: "An existing public webhook origin was found. Confirm it before Open Session uses it for sandbox callbacks." }
        : !configured
          ? { note: "Enter a public HTTPS origin or add the generated routes to Caddy." }
          : {}),
  };
}
