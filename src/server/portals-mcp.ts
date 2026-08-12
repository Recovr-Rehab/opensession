/** Interactive session Portal MCP. Portals expose only processes in this session workspace. */

import { z } from "zod";
import { createSdkMcpServer, tool } from "./inprocess-mcp";
import { getPreviewStatus } from "./preview";
import { listPortalServices, restartPortalService, setPortalPath, startPortalService, stopPortalService } from "./portal-supervisor";

export interface PortalsMcpContext {
	sessionId: string;
	worktreeDir: () => string | undefined;
	setDefaultPath: (path: string | null) => void;
}

function result(value: string) { return { content: [{ type: "text" as const, text: value }] }; }
function workspace(ctx: PortalsMcpContext): string | Error {
	const dir = ctx.worktreeDir();
	return dir ? dir : new Error("This session has no workspace for a Portal.");
}

export function createPortalsMcpServer(ctx: PortalsMcpContext) {
	return createSdkMcpServer({
		name: "opensession-portals", version: "1.0.0", tools: [
			tool("start_portal", "Start a supervised HTTP or WebSocket service in this session workspace. Open Session allocates a port when omitted, sets PORT and PORTAL_URL, waits for it to listen, and returns its authenticated Portal URL. Never use an upstream URL: Portals expose only this session's process.", {
				name: z.string(), command: z.string(), port: z.number().int().optional(), description: z.string().optional(),
			}, async (args: { name: string; command: string; port?: number; description?: string }) => {
				const dir = workspace(ctx); if (dir instanceof Error) return result(dir.message);
				try {
					const portal = await startPortalService({ sessionId: ctx.sessionId, worktreeDir: dir, ...args });
					const status = await getPreviewStatus(dir);
					const service = status.services.find((candidate) => candidate.key === portal.key);
					return result(`${portal.name} is ready at ${service?.previewUrl ?? portal.url}.`);
				} catch (error) { return result(`Could not start Portal: ${(error as Error).message}`); }
			}),
			tool("list_portals", "List this session's registered Portals and their readiness. Use this after starting a service before telling the user it is ready.", {}, async () => {
				const dir = workspace(ctx); if (dir instanceof Error) return result(dir.message);
				const portals = await listPortalServices(dir);
				if (!portals.length) return result("No Portals are registered. Use start_portal for a live app or service.");
				const status = await getPreviewStatus(dir);
				return result(portals.map((portal) => {
					const service = status.services.find((candidate) => candidate.key === portal.key);
					return `${portal.name}\nstate: ${portal.state}\nport: ${portal.port}\nurl: ${service?.previewUrl ?? "not ready"}${portal.description ? `\ndescription: ${portal.description}` : ""}`;
				}).join("\n\n"));
			}),
			tool("stop_portal", "Stop one supervised Portal in this session. It never affects services in another session.", { name: z.string() }, async ({ name }: { name: string }) => {
				const dir = workspace(ctx); if (dir instanceof Error) return result(dir.message);
				try { await stopPortalService({ sessionId: ctx.sessionId, worktreeDir: dir, name }); return result(`Stopped ${name}.`); }
				catch (error) { return result(`Could not stop Portal: ${(error as Error).message}`); }
			}),
			tool("restart_portal", "Restart one supervised Portal using its registered command and port.", { name: z.string() }, async ({ name }: { name: string }) => {
				const dir = workspace(ctx); if (dir instanceof Error) return result(dir.message);
				try {
					const portal = await restartPortalService({ sessionId: ctx.sessionId, worktreeDir: dir, name });
					const status = await getPreviewStatus(dir);
					return result(`${portal.name} restarted at ${status.services.find((candidate) => candidate.key === portal.key)?.previewUrl ?? portal.url}.`);
				} catch (error) { return result(`Could not restart Portal: ${(error as Error).message}`); }
			}),
			tool("set_portal_path", "Set the root-relative route a Portal should open by default. Omit name to set the session's default testing route.", { name: z.string().optional(), path: z.string() }, async ({ name, path }: { name?: string; path: string }) => {
				const dir = workspace(ctx); if (dir instanceof Error) return result(dir.message);
				try {
					if (name) setPortalPath(dir, path, name);
					else ctx.setDefaultPath(path.trim() === "" ? null : path);
					return result(name ? `Set ${name}'s default route to ${path || "/"}.` : `Set this session's default route to ${path || "/"}.`);
				} catch (error) { return result(`Could not set Portal path: ${(error as Error).message}`); }
			}),
		],
	});
}
