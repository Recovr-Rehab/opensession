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

async function run(): Promise<void> {
	while (true) {
		await new Promise<void>((resolve) => {
			let socket: WebSocket;
			try { socket = new WebSocket(endpoint, { headers: { authorization: `Bearer ${token}` } } as any); } catch { setTimeout(resolve, 1000); return; }
			socket.addEventListener("message", (event) => { try { void respond(socket, JSON.parse(String(event.data))); } catch {} });
			socket.addEventListener("close", () => setTimeout(resolve, 1000), { once: true });
			socket.addEventListener("error", () => { try { socket.close(); } catch {} });
		});
	}
}
void run();
