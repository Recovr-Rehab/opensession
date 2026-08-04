import { createRoot } from "react-dom/client";
import type { TranscriptEntry, UnifiedSession } from "../src/frontend/lib/types";

const now = "2026-08-04T12:00:00.000Z";
const activeSessionId = "bks-demo-presence";

const sessions: UnifiedSession[] = [
	{
		id: activeSessionId,
		claudeSessionId: "demo-presence",
		source: "backstage",
		branch: "michael/workspace-presence",
		worktreeDir: "/workspace/opensession",
		startedBy: "Michiel",
		title: "Add multiplayer workspace presence",
		lastActivity: now,
		createdAt: "2026-08-04T10:18:00.000Z",
		isRunning: false,
		transcriptPath: "/demo/transcript.jsonl",
		mode: "code",
		repo: "opensession",
		projectId: "project-presence",
		model: "openai/gpt-5.6-sol",
		effort: "high",
		usage: {
			costUsd: 0.6,
			inputTokens: 18420,
			outputTokens: 3290,
			cacheReadTokens: 12600,
			cacheCreationTokens: 0,
			contextTokens: 23110,
			contextWindow: 200000,
			turns: 4,
			updatedAt: now,
		},
	},
	{
		id: "bks-demo-checkout",
		claudeSessionId: "demo-checkout",
		source: "backstage",
		branch: "michael/checkout-recovery",
		worktreeDir: "/workspace/checkout",
		startedBy: "Michiel",
		title: "Review checkout recovery",
		lastActivity: "2026-08-04T11:44:00.000Z",
		createdAt: "2026-08-04T09:20:00.000Z",
		isRunning: true,
		runStartedAt: "2026-08-04T11:54:22.000Z",
		transcriptPath: "/demo/checkout.jsonl",
		mode: "code",
		repo: "opensession",
		projectId: "project-checkout",
		model: "anthropic/claude-opus-5",
	},
	{
		id: "bks-demo-mobile",
		claudeSessionId: "demo-mobile",
		source: "backstage",
		branch: "michael/mobile-navigation",
		worktreeDir: "/workspace/mobile",
		startedBy: "Kent",
		title: "Improve mobile navigation",
		lastActivity: "2026-08-04T11:20:00.000Z",
		createdAt: "2026-08-04T08:45:00.000Z",
		isRunning: false,
		transcriptPath: "/demo/mobile.jsonl",
		mode: "code",
		repo: "opensession",
		projectId: "project-mobile",
		model: "anthropic/claude-sonnet-5",
		waitingForInput: true,
	},
	{
		id: "bks-demo-shortcuts",
		claudeSessionId: "demo-shortcuts",
		source: "backstage",
		branch: "michael/keyboard-shortcuts",
		worktreeDir: "/workspace/shortcuts",
		startedBy: "Jaap",
		title: "Ship keyboard shortcuts",
		lastActivity: "2026-08-04T10:55:00.000Z",
		createdAt: "2026-08-04T07:30:00.000Z",
		isRunning: false,
		transcriptPath: "/demo/shortcuts.jsonl",
		mode: "code",
		repo: "opensession",
		projectId: "project-shortcuts",
		model: "openai/gpt-5.6-terra",
		prUrl: "https://github.com/tellahq/opensession/pull/1842",
		prState: "OPEN",
		prNumber: 1842,
		prTitle: "Ship keyboard shortcuts",
		prChecks: { total: 8, passed: 8, failed: 0, pending: 0 },
		prReviewDecision: "APPROVED",
	},
];

const transcripts: Record<string, TranscriptEntry[]> = {
	[activeSessionId]: [
		{
			id: "entry-1",
			type: "user",
			content:
				"Add multiplayer presence to project workspaces. Have a focused agent cover the tests, then open a pull request.",
			timestamp: "2026-08-04T10:18:00.000Z",
			seq: 1,
			changeSeq: 1,
		},
		{
			id: "entry-2",
			type: "assistant",
			content:
				"I found the existing presence channel and workspace header. I’m wiring those together while a focused worker adds coverage.",
			timestamp: "2026-08-04T10:18:12.000Z",
			model: "openai/gpt-5.6-sol",
			seq: 2,
			changeSeq: 2,
		},
		{
			id: "entry-3",
			type: "tool_use",
			content: "",
			timestamp: "2026-08-04T10:18:18.000Z",
			toolName: "functions.task",
			toolInput: {
				description: "Add presence coverage",
				prompt: "Add focused tests for workspace presence.",
				subagent_type: "worker",
			},
			toolUseId: "tool-1",
			seq: 3,
			changeSeq: 3,
		},
		{
			id: "entry-4",
			type: "tool_result",
			content: "Presence tests added. 16 tests pass.",
			timestamp: "2026-08-04T10:21:06.000Z",
			toolName: "functions.task",
			toolUseId: "tool-1",
			agentId: "agent-demo-tests",
			seq: 4,
			changeSeq: 4,
		},
		{
			id: "entry-5",
			type: "assistant",
			content:
				"Presence now appears in every shared workspace. The focused tests pass and pull request #1842 is ready for review.",
			timestamp: "2026-08-04T10:23:40.000Z",
			model: "openai/gpt-5.6-sol",
			seq: 5,
			changeSeq: 5,
		},
	],
};

for (const session of sessions.slice(1)) {
	transcripts[session.id] = [
		{
			id: `${session.id}-1`,
			type: "user",
			content: `Take ownership of “${session.title}” and leave the work ready for review.`,
			timestamp: session.createdAt,
			seq: 1,
			changeSeq: 1,
		},
		{
			id: `${session.id}-2`,
			type: "assistant",
			content:
				"I’ve mapped the relevant code paths and started the focused implementation. The current state is visible in the workspace panel.",
			timestamp: session.lastActivity,
			model: session.model,
			seq: 2,
			changeSeq: 2,
		},
	];
}

const projects = sessions.map((session, index) => ({
	id: session.projectId!,
	name: session.title.replace(/^(Add|Review|Improve|Ship) /, ""),
	repo: "opensession",
	createdBy: session.startedBy || "Michiel",
	createdAt: session.createdAt,
	order: index,
}));

const json = (body: unknown, init: ResponseInit = {}) =>
	new Response(JSON.stringify(body), {
		status: 200,
		headers: { "Content-Type": "application/json", ...init.headers },
		...init,
	});

const responseFor = (url: URL, method: string): Response => {
	const path = url.pathname.replace(/^\/(opensession|backstage)/, "");
	if (path === "/api/sessions") return json(sessions, { headers: { ETag: '"demo-v1"' } });
	if (path === "/api/auth/status")
		return json({ required: false, authenticated: true, local: true, name: "Michiel Westerbeek" });
	if (path === "/api/people")
		return json({
			people: [
				{ name: "Michiel", fullName: "Michiel Westerbeek" },
				{ name: "Kent", fullName: "Kent de Bruin" },
				{ name: "Jaap", fullName: "Jaap van der Meer" },
			],
		});
	if (path === "/api/projects") return json({ projects });
	if (path === "/api/repos")
		return json({
			repos: [
				{
					id: "opensession",
					label: "OpenSession",
					ghRepo: "tellahq/opensession",
					defaultBranch: "main",
					sharedCheckout: true,
					default: true,
				},
			],
		});
	if (path === "/api/models")
		return json({
			default: "openai/gpt-5.6-sol",
			models: [
				{
					id: "openai/gpt-5.6-sol",
					provider: "opencode",
					label: "GPT-5.6 Sol",
					aliases: [],
					efforts: ["medium", "high"],
				},
				{
					id: "anthropic/claude-opus-5",
					provider: "opencode",
					label: "Claude Opus 5",
					aliases: [],
					efforts: ["high"],
				},
			],
		});
	if (path === "/api/open-prs") return json({ prs: [] });
	if (path === "/api/feeds") return json({ feeds: [] });
	if (path === "/api/chat/session-activity") return json({ channels: [] });
	if (path === "/api/chat/messages") return json({ messages: [] });
	if (path === "/api/todos") return json({ todos: [] });
	if (path === "/api/pins") return json({ pins: [activeSessionId] });
	if (path === "/api/ui-prefs") return json({ prefs: {} });
	if (path === "/api/lanes") return json({ lanes: {} });
	if (path === "/api/reads") return json({ reads: {} });
	if (path === "/api/claude-accounts" || path === "/api/codex-accounts")
		return json({ accounts: [] });
	if (/^\/api\/sessions\/[^/]+\/assets$/.test(path))
		return json({ dir: "/demo/assets", files: [] });
	if (/^\/api\/sessions\/[^/]+\/reports$/.test(path)) return json({ reports: [] });
	if (/^\/api\/sessions\/[^/]+\/workflows$/.test(path)) return json({ runs: [] });
	if (/^\/api\/sessions\/[^/]+\/subagents$/.test(path))
		return json({ subagents: [], sessionRunning: false });
	if (method !== "GET") return json({ ok: true });
	return json({ error: `No demo fixture for ${path}` }, { status: 404 });
};

(window as typeof window & { fetch: typeof fetch }).fetch = (async (input, init) => {
	const raw = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
	const url = new URL(raw, location.href);
	if (url.origin !== location.origin || !url.pathname.includes("/api/")) {
		throw new Error(`The product preview blocked a network request to ${url.href}`);
	}
	return responseFor(url, init?.method || (input instanceof Request ? input.method : "GET"));
}) as typeof fetch;

class DemoWebSocket extends EventTarget {
	static readonly CONNECTING = 0;
	static readonly OPEN = 1;
	static readonly CLOSING = 2;
	static readonly CLOSED = 3;
	readonly CONNECTING = 0;
	readonly OPEN = 1;
	readonly CLOSING = 2;
	readonly CLOSED = 3;
	readyState = DemoWebSocket.CONNECTING;
	onopen: ((event: Event) => void) | null = null;
	onmessage: ((event: MessageEvent) => void) | null = null;
	onclose: ((event: CloseEvent) => void) | null = null;
	onerror: ((event: Event) => void) | null = null;

	constructor(_url: string | URL) {
		super();
		queueMicrotask(() => {
			this.readyState = DemoWebSocket.OPEN;
			this.onopen?.(new Event("open"));
		});
	}

	private emit(body: unknown, delay = 0) {
		window.setTimeout(() => {
			this.onmessage?.(new MessageEvent("message", { data: JSON.stringify(body) }));
		}, delay);
	}

	send(data: string) {
		const message = JSON.parse(data);
		if (message.type === "ping") {
			this.emit({ type: "pong" });
			return;
		}
		if (message.type === "watch") {
			const entries = transcripts[message.sessionId] || [];
			this.emit({
				type: "transcript_init",
				sessionId: message.sessionId,
				entries,
				truncated: false,
				v2: true,
				firstSeq: entries[0]?.seq || 0,
				lastSeq: entries.at(-1)?.seq || 0,
				lastChangeSeq: entries.at(-1)?.changeSeq || 0,
			});
			this.emit({ type: "presence", sessionId: message.sessionId, viewers: ["Kent", "Jaap"] }, 80);
			return;
		}
		if (message.type === "prompt") {
			const timestamp = new Date().toISOString();
			const userEntry: TranscriptEntry = {
				id: `demo-user-${Date.now()}`,
				type: "user",
				content: message.content,
				timestamp,
			};
			const assistantEntry: TranscriptEntry = {
				id: `demo-assistant-${Date.now()}`,
				type: "assistant",
				content:
					"This is a deterministic product preview, so the real coding agent is not contacted. In OpenSession, this prompt would start a live run here.",
				timestamp,
				model: "openai/gpt-5.6-sol",
			};
			this.emit({ type: "transcript_append", sessionId: message.sessionId, entries: [userEntry] });
			this.emit({ type: "session_status", sessionId: message.sessionId, isRunning: true }, 60);
			this.emit({ type: "stream_start", sessionId: message.sessionId, by: "Michiel" }, 120);
			this.emit({ type: "stream_text", sessionId: message.sessionId, text: assistantEntry.content }, 260);
			this.emit({ type: "transcript_append", sessionId: message.sessionId, entries: [assistantEntry] }, 900);
			this.emit({ type: "stream_done", sessionId: message.sessionId }, 920);
			this.emit({ type: "session_status", sessionId: message.sessionId, isRunning: false }, 940);
		}
	}

	close() {
		this.readyState = DemoWebSocket.CLOSED;
		this.onclose?.(new CloseEvent("close", { code: 1000 }));
	}
}

Object.defineProperty(window, "WebSocket", { value: DemoWebSocket, configurable: true });
class DemoEventSource extends EventTarget {
	static readonly CONNECTING = 0;
	static readonly OPEN = 1;
	static readonly CLOSED = 2;
	readonly CONNECTING = 0;
	readonly OPEN = 1;
	readonly CLOSED = 2;
	readonly readyState = DemoEventSource.OPEN;
	onopen: ((event: Event) => void) | null = null;
	onmessage: ((event: MessageEvent) => void) | null = null;
	onerror: ((event: Event) => void) | null = null;

	constructor(_url: string | URL) {
		super();
	}

	close() {}
}
Object.defineProperty(window, "EventSource", {
	value: DemoEventSource,
	configurable: true,
});
Object.assign(window, {
	__OPENSESSION_DEMO__: true,
	__OPENSESSION_INSTANCE__: {
		productName: "OpenSession",
		productMark: "OS",
		personaName: "Michael",
		defaultRepoId: "opensession",
	},
});
localStorage.setItem("opensession-user", "Michiel");
localStorage.setItem("opensession-last-session", activeSessionId);
localStorage.setItem("opensession-panel-open", "false");
localStorage.setItem("opensession-sidebar-collapsed", "0");

const [{ App }, { TooltipProvider }] = await Promise.all([
	import("../src/frontend/App"),
	import("../src/frontend/ui/tooltip"),
]);

createRoot(document.getElementById("root")!).render(
	<TooltipProvider>
		<App serviceWorker={false} />
	</TooltipProvider>,
);
