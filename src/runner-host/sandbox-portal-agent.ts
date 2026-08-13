/**
 * Outbound-only HTTP relay for one supervised Sandbox Portal. It has no
 * provider URL or network destination beyond Open Session and localhost.
 */
const endpoint = process.env.OPENSESSION_SANDBOX_PORTAL_WS_URL || "";
const token = process.env.OPENSESSION_SANDBOX_PORTAL_TOKEN || "";
const port = Number(process.env.OPENSESSION_SANDBOX_PORTAL_PORT);
if (!endpoint || !token || !Number.isInteger(port)) process.exit(2);

const HOP = new Set(["connection", "host", "content-length", "transfer-encoding", "upgrade", "keep-alive", "proxy-authenticate", "proxy-authorization", "te", "trailer"]);
const headersFrom = (value: unknown) => {
	const headers = new Headers();
	if (value && typeof value === "object" && !Array.isArray(value)) for (const [name, item] of Object.entries(value as Record<string, unknown>)) if (!HOP.has(name.toLowerCase()) && typeof item === "string" && item.length <= 8192) headers.set(name, item);
	return headers;
};

async function respond(socket: WebSocket, msg: any): Promise<void> {
	const id = typeof msg.id === "string" ? msg.id : "";
	const path = typeof msg.path === "string" ? msg.path : "";
	const method = typeof msg.method === "string" ? msg.method.toUpperCase() : "GET";
	if (!id || !path.startsWith("/") || path.startsWith("//") || !/^[A-Z]{3,10}$/.test(method)) return;
	try {
		const body = typeof msg.body === "string" ? Buffer.from(msg.body, "base64") : undefined;
		if (body && body.byteLength > 5 * 1024 * 1024) throw new Error("request too large");
		const response = await fetch(`http://127.0.0.1:${port}${path}`, { method, headers: headersFrom(msg.headers), body: body && method !== "GET" && method !== "HEAD" ? body : undefined, redirect: "manual", signal: AbortSignal.timeout(30_000) });
		const bytes = new Uint8Array(await response.arrayBuffer());
		if (bytes.byteLength > 10 * 1024 * 1024) throw new Error("response too large");
		const headers: Record<string, string> = {};
		for (const [name, value] of response.headers) if (!HOP.has(name.toLowerCase())) headers[name] = value;
		socket.send(JSON.stringify({ t: "http_result", id, status: response.status, headers, body: Buffer.from(bytes).toString("base64") }));
	} catch {
		socket.send(JSON.stringify({ t: "http_result", id, status: 502, headers: {} }));
	}
}

function openWebSocket(socket: WebSocket, sockets: Map<string, WebSocket>, msg: any): void {
	const id = typeof msg.id === "string" ? msg.id : "";
	const path = typeof msg.path === "string" ? msg.path : "";
	if (!id || !path.startsWith("/") || path.startsWith("//")) return;
	try {
		const local = new WebSocket(`ws://127.0.0.1:${port}${path}`, { headers: headersFrom(msg.headers) } as any);
		sockets.set(id, local);
		local.addEventListener("message", (event: any) => {
			try { socket.send(JSON.stringify({ t: "ws_event", id, binary: typeof event.data !== "string", data: typeof event.data === "string" ? event.data : Buffer.from(event.data).toString("base64") })); } catch {}
		});
		const closed = () => { sockets.delete(id); try { socket.send(JSON.stringify({ t: "ws_closed", id })); } catch {} };
		local.addEventListener("close", closed); local.addEventListener("error", closed);
	} catch { try { socket.send(JSON.stringify({ t: "ws_closed", id })); } catch {} }
}

async function run(): Promise<void> {
	while (true) {
		await new Promise<void>((resolve) => {
			const sockets = new Map<string, WebSocket>();
			let socket: WebSocket;
			try { socket = new WebSocket(endpoint, { headers: { authorization: `Bearer ${token}` } } as any); } catch { setTimeout(resolve, 1000); return; }
			socket.addEventListener("message", (event) => { try { const message = JSON.parse(String(event.data)); if (message.t === "http") void respond(socket, message); else if (message.t === "ws_open") openWebSocket(socket, sockets, message); else if (message.t === "ws_send") { const local = sockets.get(String(message.id)); if (local) local.send(message.binary === true && typeof message.data === "string" ? Buffer.from(message.data, "base64") : String(message.data ?? "")); } else if (message.t === "ws_close") { try { sockets.get(String(message.id))?.close(); } catch {} sockets.delete(String(message.id)); } } catch {} });
			socket.addEventListener("close", () => { for (const local of sockets.values()) try { local.close(); } catch {} setTimeout(resolve, 1000); }, { once: true });
			socket.addEventListener("error", () => { try { socket.close(); } catch {} });
		});
	}
}
void run();
