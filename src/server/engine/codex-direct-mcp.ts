/**
 * MCP wiring for the codex-direct engine.
 *
 * Codex has NO per-call permission hook (no `canUseTool`), so a denied tool
 * cannot be refused at call time — it has to be absent from the catalog. The
 * only lever codex gives us is `mcp_servers.<name>.disabled_tools`, which is
 * what the deleted codex-runner used and what this module rebuilds on top of
 * the modern, shared plumbing.
 *
 * Three consequences of that lever, all load-bearing:
 *  1. It is PER-MCP-SERVER. Codex's built-ins (shell, apply_patch, web search)
 *     cannot be stripped this way, so built-in containment is expressed
 *     through the sandbox policy instead (read-only in ask mode) — see
 *     codex-direct-adapter.ts.
 *  2. There are no wildcard forms, so `opencodeDeniedToolIds`'s broad
 *     `*_<tool>` / bare-`<tool>` expansion has nowhere to land. Names are
 *     resolved to exact `(server, tool)` pairs off the RAW deniedTools ∪
 *     confirmTools keys — not off `policy.disables`, whose `<server>_<tool>`
 *     shape is OpenCode's naming, not codex's. A denied name that does not
 *     parse as `mcp__<server>__<tool>` is reported as unenforceable rather
 *     than silently dropped.
 *  3. It is config-level, so a codex process cannot be shared across runs with
 *     different allowlists. codex-direct is per-session by construction.
 *
 * Server resolution goes through `filterMcpServers` — the same helper the
 * other engines use, so the per-run allowlist AND the per-user `allowedUsers`
 * gate are enforced identically (automation runs pass no user, so restricted
 * servers are invisible to them: fail-closed).
 *
 * Transport support, and where it stops: codex speaks stdio and streamable
 * HTTP, and for HTTP it accepts only a `bearer_token_env_var`, not arbitrary
 * headers. So an OAuth-granted server rides the mcp-relay URL (which needs no
 * headers at all — the relay re-resolves a fresh token per request), a plain
 * bearer header is translated into a per-server env var, and any other header
 * scheme is SKIPPED with a reason the runner surfaces as a runner_notice.
 * Silently mounting a server without its auth would look like a broken tool.
 */

import { BUN_BIN, MCP_PROXY_ENTRY, rpcSocketPath } from "../run-rpc-protocol";
import { OPENSESSION_SESSIONS_DIR } from "../paths";
import { filterMcpServers, type McpScope } from "../runner-shared";
import { mcpSharedGrantHeader, mcpUserGrantHeader } from "../mcp-oauth";
import { mcpRelayUrl, mintMcpRelayToken } from "../mcp-relay";

/** Codex's own default MCP tool timeout is 60s, which killed long-running
 *  connector tools (Tinybird queries, screenshot capture) on the legacy
 *  runner. Same 600s the deleted codex-runner settled on. */
const TOOL_TIMEOUT_SEC = 600;

/** The opensession-* proxies front blocking asks (ask_human mode=block,
 *  ask_user), which legitimately wait on a human up to run-rpc's 30-minute
 *  per-call ceiling. Sit above the whole chain, as opencode-policy does. */
const PROXY_TOOL_TIMEOUT_SEC = 33 * 60;

export interface CodexMcpEntry {
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  bearer_token_env_var?: string;
  tool_timeout_sec?: number;
  startup_timeout_sec?: number;
  disabled_tools?: string[];
}

export interface CodexMcpBuild {
  /** `mcp_servers` table for the codex config. */
  servers: Record<string, CodexMcpEntry>;
  /** Env vars the subprocess needs so `bearer_token_env_var` resolves. These
   *  are the MCP servers' OWN credentials — never Open Session tokens. */
  env: Record<string, string>;
  /** Servers left out, with why — surfaced to the run as a notice. */
  skipped: Array<{ name: string; reason: string }>;
  /** Denied/confirm tool names that could not be expressed as
   *  `(server, tool)` pairs, so codex cannot strip them. */
  unenforceable: string[];
}

/** Bucket `mcp__<server>__<tool>` names per server. The `[^_]+(?:_[^_]+)*?`
 *  server group is the legacy runner's pattern: server names contain
 *  underscores, so the split has to be lazy up to the `__` separator. */
export function disabledToolsByServer(names: string[]): {
  byServer: Record<string, string[]>;
  unenforceable: string[];
} {
  const byServer: Record<string, string[]> = {};
  const unenforceable: string[] = [];
  for (const name of names) {
    const m = name.match(/^mcp__([^_]+(?:_[^_]+)*?)__(.+)$/);
    if (!m) {
      unenforceable.push(name);
      continue;
    }
    const [, server, tool] = m;
    (byServer[server] ??= []).push(tool);
  }
  return { byServer, unenforceable };
}

/** Env var name carrying one server's bearer token. Namespaced so it cannot
 *  collide with anything meaningful in the child's minimal env. */
export function bearerEnvVarFor(server: string): string {
  return `CODEX_MCP_BEARER_${server.replace(/[^A-Za-z0-9]/g, "_").toUpperCase()}`;
}

function bearerFromHeaders(
  headers: Record<string, string> | undefined
): { token: string } | { unsupported: string } | null {
  const entries = Object.entries(headers || {});
  if (!entries.length) return null;
  if (entries.length > 1) {
    return { unsupported: `it needs ${entries.length} custom HTTP headers` };
  }
  const [key, value] = entries[0];
  if (key.toLowerCase() !== "authorization") {
    return { unsupported: `it needs a custom "${key}" header` };
  }
  const m = String(value).match(/^Bearer\s+(.+)$/i);
  if (!m) return { unsupported: "its Authorization header is not a bearer token" };
  return { token: m[1] };
}

/**
 * Build the `mcp_servers` config for one run.
 *
 * `deniedToolNames` are the RAW keys of deniedTools ∪ confirmTools (see the
 * module header for why not `policy.disables`).
 */
export function buildCodexMcpConfig(opts: {
  scope: McpScope;
  user?: string;
  /** OAuth grant identities in priority order (session creator first). */
  grantUsers?: Array<string | undefined>;
  deniedToolNames?: string[];
  /** In-process opensession-* servers — interactive runs only. The caller
   *  decides eligibility; this module never synthesizes them. */
  inProcessMcp?: Record<string, unknown>;
  rpcToken?: string;
}): CodexMcpBuild {
  const { byServer, unenforceable } = disabledToolsByServer(opts.deniedToolNames || []);
  const servers: Record<string, CodexMcpEntry> = {};
  const env: Record<string, string> = {};
  const skipped: Array<{ name: string; reason: string }> = [];

  const filtered = filterMcpServers(opts.scope, opts.user, opts.grantUsers) as Record<string, any>;
  for (const [name, cfg] of Object.entries(filtered)) {
    const disabled = byServer[name]?.length ? { disabled_tools: byServer[name] } : {};
    if (cfg.type === "http" || cfg.type === "sse" || cfg.url) {
      const candidates = (opts.grantUsers ?? [opts.user]).filter((u): u is string => !!u);
      const hasGrant =
        candidates.some((u) => mcpUserGrantHeader(name, u)) || !!mcpSharedGrantHeader(name);
      if (hasGrant) {
        // The relay carries auth per request, so no headers are needed at all.
        const token = mintMcpRelayToken(name, candidates);
        servers[name] = {
          url: mcpRelayUrl(name, token),
          tool_timeout_sec: TOOL_TIMEOUT_SEC,
          ...disabled,
        };
        continue;
      }
      const bearer = bearerFromHeaders(cfg.headers as Record<string, string> | undefined);
      if (bearer && "unsupported" in bearer) {
        skipped.push({
          name,
          reason: `${bearer.unsupported}, and codex accepts only a bearer token on HTTP MCP servers`,
        });
        continue;
      }
      const entry: CodexMcpEntry = {
        url: String(cfg.url),
        tool_timeout_sec: TOOL_TIMEOUT_SEC,
        ...disabled,
      };
      if (bearer) {
        const varName = bearerEnvVarFor(name);
        env[varName] = bearer.token;
        entry.bearer_token_env_var = varName;
      }
      servers[name] = entry;
      continue;
    }
    if (cfg.command) {
      servers[name] = {
        command: String(cfg.command),
        ...(Array.isArray(cfg.args) && cfg.args.length ? { args: cfg.args as string[] } : {}),
        ...(cfg.env ? { env: cfg.env as Record<string, string> } : {}),
        tool_timeout_sec: TOOL_TIMEOUT_SEC,
        ...disabled,
      };
      continue;
    }
    skipped.push({ name, reason: "it has neither a command nor a url" });
  }

  // In-process opensession-* servers, as stdio proxies over the run-rpc
  // socket — the pattern mcp-proxy.ts documents, in codex's config shape.
  const inProcess = Object.keys(opts.inProcessMcp || {});
  if (inProcess.length && opts.rpcToken) {
    const catalog = inProcess.slice().sort().join(",");
    for (const name of inProcess) {
      servers[name] = {
        // --smol: the proxy is a pure stdio↔RPC pipe and there is one per
        // server per run; Bun's low-memory heap profile roughly halves RSS.
        command: BUN_BIN,
        args: ["--smol", "run", MCP_PROXY_ENTRY],
        env: {
          OPENSESSION_RPC_SOCKET: rpcSocketPath(OPENSESSION_SESSIONS_DIR),
          OPENSESSION_RPC_TOKEN: opts.rpcToken,
          OPENSESSION_MCP_SERVER: name,
          OPENSESSION_MCP_CATALOG: catalog,
        },
        tool_timeout_sec: PROXY_TOOL_TIMEOUT_SEC,
        ...(byServer[name]?.length ? { disabled_tools: byServer[name] } : {}),
      };
    }
  } else if (inProcess.length && !opts.rpcToken) {
    for (const name of inProcess) {
      skipped.push({ name, reason: "no run-rpc token was minted for this run" });
    }
  }

  return { servers, env, skipped, unenforceable };
}
