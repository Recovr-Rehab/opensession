/**
 * The Dial's oracle for the codex-direct engine.
 *
 * codex 0.144.5's app-server has no client-side dynamic tool registration, so
 * an oracle cannot be an SDK-native tool the way pi's is (see the v0 gaps in
 * codex-direct-adapter.ts). What codex DOES accept is MCP servers, and this
 * repo already runs in-process MCP servers over a stdio proxy backed by the
 * run-rpc socket — so the oracle is a one-tool in-process MCP server mounted
 * through exactly that path (codex-direct-mcp.ts's `inProcessMcp` arm). The
 * model sees it as `mcp__opensession-oracle__oracle`, codex's own naming for a
 * qualified MCP tool.
 *
 * Containment — this server is deliberately the narrowest possible surface,
 * and is held to the same bar as the two documented exceptions in
 * docs/security-model.md (papercuts, selfImprove): nothing sensitive is
 * readable through it, it mutates no state, and it is not a control surface.
 *  - ONE tool, whose only input is a question string.
 *  - It answers through `opencodeOneShot`, which is tool-less by construction
 *    (`tools: {"*": false}` plus deny-all permissions) — the oracle cannot
 *    read a file, run a command, or reach any MCP server. It is a pure text
 *    transform on a model we already hold accounts for.
 *  - It fails soft: a null one-shot (bridge off, dry pool, timeout) returns
 *    advice to carry on rather than failing the tool call, so a missing oracle
 *    never takes a turn down.
 *  - It is wired in ONLY on dial presets, and only for runs that have a
 *    unified session id (the run-rpc proxy resolves servers per session).
 */

import { z } from "zod";
import { createSdkMcpServer, tool, type InProcessMcpServer } from "../inprocess-mcp";
import { DIAL_ORACLE_AGENTS } from "../models";

/** MCP server name; the model sees `mcp__<server>__<tool>`. */
export const CODEX_DIRECT_ORACLE_SERVER = "opensession-oracle";
export const CODEX_DIRECT_ORACLE_TOOL = "oracle";
/** Fully-qualified tool name as codex exposes it to the model. */
export const CODEX_DIRECT_ORACLE_TOOL_ID = `mcp__${CODEX_DIRECT_ORACLE_SERVER}__${CODEX_DIRECT_ORACLE_TOOL}`;

/** Same read-only framing pi's oracle tool uses, so the two engines' oracles
 *  answer in the same register. */
const ORACLE_SYSTEM =
  "You are a read-only senior engineering advisor. Give a concise, concrete second opinion. " +
  "Do not claim to inspect files or run tools. State assumptions, tradeoffs, and recommended next steps.";

const UNAVAILABLE =
  "The Dial oracle was unavailable for this question; continue using your own judgment.";

function text(value: string) {
  return { content: [{ type: "text" as const, text: value }] };
}

/**
 * One advisory question, answered on the dial preset's oracle model.
 *
 * `oracleAgent` is expected to be the SAME-BRIDGE resolved agent
 * (`sameBridgeDialOracle`) — see codex-direct-presets.ts.
 */
export function createCodexDirectOracleServer(opts: {
  oracleAgent: string;
  /** Run user, so the one-shot picks their account first, as full runs do. */
  user?: string;
}): InProcessMcpServer {
  const oracle = DIAL_ORACLE_AGENTS[opts.oracleAgent];
  return createSdkMcpServer({
    name: CODEX_DIRECT_ORACLE_SERVER,
    version: "1.0.0",
    tools: [
      tool(
        CODEX_DIRECT_ORACLE_TOOL,
        `Consult ${oracle?.label || opts.oracleAgent} for a read-only senior-engineering second ` +
          "opinion. Use it for hard plans, significant reviews, architecture tradeoffs, or " +
          "stubborn debugging, not routine searches or edits. The oracle sees none of your " +
          "conversation and cannot read files or run commands, so put the relevant context, " +
          "file paths, constraints and options in the question itself.",
        {
          prompt: z
            .string()
            .describe(
              "Precise question with the relevant context, file paths, constraints, and options under consideration"
            ),
        },
        async ({ prompt }: { prompt: string }) => {
          const question = String(prompt ?? "").trim();
          if (!question) return text("The oracle needs a question.");
          if (!oracle) {
            return text(`The Dial oracle "${opts.oracleAgent}" is not configured. ${UNAVAILABLE}`);
          }
          // Dynamic: opencode-oneshot pulls in the whole opencode runner, and
          // a codex-direct turn must not pay that import unless it asks.
          const { opencodeOneShot } = await import("../opencode-oneshot");
          let answer: string | null = null;
          try {
            answer = await opencodeOneShot(question, {
              model: oracle.model,
              effort: oracle.variant,
              user: opts.user,
              label: "codex-dial-oracle",
              system: ORACLE_SYSTEM,
            });
          } catch (e) {
            console.warn("[codex-direct] oracle one-shot failed:", e);
          }
          return text(answer || UNAVAILABLE);
        }
      ),
    ],
  });
}
