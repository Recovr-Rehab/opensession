/**
 * `opensession-health` — read this instance's own host metrics.
 *
 * One tool, no arguments, no writes. It returns exactly the `system` block of
 * /api/health (system-stats.ts), so the health monitor reads the same numbers
 * a human reads in the browser.
 *
 * Why a tool and not a fetch. The monitor is an unattended automation, and an
 * automation genuinely cannot reach its own host over HTTP: web-fetch.ts
 * refuses loopback and private addresses on every hop by design, because its
 * caller is a model reading untrusted text, and no engine gives an unattended
 * ask run a shell to curl with. Before this existed the monitor's only path
 * was the OpenCode engine's webfetch tool, so moving automations to Pi
 * (aeb73d59f) blinded it while its runs kept recording `ok`.
 *
 * Held to the automation in-process bar, same as opensession-turn and
 * opensession-papercuts: it reads aggregate host counters and nothing else.
 * No path, url or command is accepted, so untrusted text cannot steer it, and
 * there is nothing here to escalate with. Never grow this server past that.
 */

import { createSdkMcpServer } from "./inprocess-mcp";
import { tool } from "./inprocess-mcp";
import { systemStats } from "./system-stats";

export function createHealthMcpServer() {
	const tools = [
		tool(
			"read_host_metrics",
			"Read this instance's host metrics: disk usage on /, memory and swap, load averages against core count, counts of the process fleets that have leaked before (opencode servers, MCP proxies, headless Chrome, dev stacks, git operations), and cgroup memory accounting. Returns the same numbers as the health endpoint's `system` block. Use it for a health check instead of trying to fetch the server over HTTP, which is refused for loopback addresses.",
			{},
			async () => ({
				content: [
					{
						type: "text" as const,
						text: JSON.stringify(
							{ ok: true, uptimeSeconds: Math.round(process.uptime()), system: systemStats() },
							null,
							2,
						),
					},
				],
			}),
		),
	];
	return createSdkMcpServer({ name: "opensession-health", version: "1.0.0", tools });
}
