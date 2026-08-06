/**
 * Desk voice mode — GPT Realtime as a temporary conversational engine for the
 * standing Desk session (src/server/desk.ts). The browser talks WebRTC directly
 * to OpenAI with an ephemeral secret minted here; tool calls and transcripts
 * relay back over authenticated HTTP routes (routes/desk-voice.ts). The Desk
 * session stays the durable identity: voice turns are mirrored into its
 * transcript as they finalize, and a handoff note (consumed by run-session.ts
 * on the next text turn) bridges them into the text engine's context — the
 * transcript file and the engine's own conversation state are separate stores,
 * so without the handoff the next text turn would be amnesiac about the call.
 *
 * The tool surface is a deliberately narrow facade over SessionControl and
 * todos — never the MCP inventory. The server-side session config (not the
 * client) fixes the tool list, so a client can't expand what OpenAI may call.
 */

import {
	chmodSync,
	existsSync,
	mkdirSync,
	readFileSync,
	rmSync,
} from "node:fs";
import { stateDir } from "./paths";
import { writeJsonAtomic } from "./shared/atomic-write";
import { ensureDeskSession } from "./desk";
import { getSessionControl } from "./session-control";
import { transcriptStore } from "./transcript-store";
import { addTodo, listTodos, updateTodo } from "./todos";
import type { TranscriptEntry } from "./types";

const DIR = stateDir("desk");
const KEY_PATH = `${DIR}/voice.json`;
const HANDOFF_DIR = `${DIR}/voice-handoff`;

/** Realtime model for Desk voice calls. */
const DESK_VOICE_MODEL = "gpt-realtime";

// ---------------------------------------------------------------------------
// API key store — instance-wide, set from Settings → Desk voice. Same contract
// as the model-provider key store: 0600 file, only ever returned masked.

interface VoiceKeyFile {
	openaiApiKey?: string;
}

function readKeyFile(): VoiceKeyFile {
	try {
		if (existsSync(KEY_PATH))
			return JSON.parse(readFileSync(KEY_PATH, "utf-8")) as VoiceKeyFile;
	} catch (e) {
		console.error("[desk-voice] failed to read key file:", e);
	}
	return {};
}

export function voiceKeyConfigured(): boolean {
	return !!readKeyFile().openaiApiKey;
}

export function voiceKeyMasked(): string | undefined {
	const key = readKeyFile().openaiApiKey;
	if (!key) return undefined;
	return `sk-…${key.slice(-4)}`;
}

/** Empty string clears the key. */
export function setVoiceKey(apiKey: string): void {
	mkdirSync(DIR, { recursive: true });
	const trimmed = apiKey.trim();
	writeJsonAtomic(KEY_PATH, trimmed ? { openaiApiKey: trimmed } : {});
	try {
		chmodSync(KEY_PATH, 0o600);
	} catch {}
}

// ---------------------------------------------------------------------------
// Ephemeral secret mint — the OpenAI API key never reaches the browser.

const VOICE_INSTRUCTIONS = `You are the user's Desk — their standing concierge for the Open Session workspace — currently on a voice call. You are the same Desk they type to; this call is one conversation with that Desk, not a separate assistant.

Voice discipline:
- Spoken register: short, natural sentences. One or two per reply. No markdown, no lists, no IDs read aloud unless asked — refer to sessions by title.
- You are an orchestrator, not the worker. For anything beyond a quick answer or a list edit, start a scoped worker session (start_session) and say you did.
- Use the tools for anything about real state — sessions, todos — never guess or invent. If a tool fails, say so plainly.
- Capture todos the moment the user mentions wanting or needing to do something. Never drop a todo unprompted.
- Before steering or starting sessions, a one-line confirmation of what you're about to do is enough; don't over-confirm reads.`;

const VOICE_TOOLS = [
	{
		type: "function",
		name: "list_current_work",
		description:
			"List the user's sessions: what's running, waiting for input, queued, or recently active. Call this before answering any 'what's happening' question.",
		parameters: { type: "object", properties: {}, required: [] },
	},
	{
		type: "function",
		name: "inspect_session",
		description:
			"Look at one session: its state and the tail of its transcript.",
		parameters: {
			type: "object",
			properties: {
				session_id: { type: "string", description: "The session id" },
			},
			required: ["session_id"],
		},
	},
	{
		type: "function",
		name: "start_session",
		description:
			"Start a new work session with an opening prompt. Use mode 'code' when it should edit files or open a PR, 'ask' for read-only investigation.",
		parameters: {
			type: "object",
			properties: {
				prompt: {
					type: "string",
					description:
						"Self-contained opening prompt: scope, constraints, what to report back.",
				},
				repo: {
					type: "string",
					description: "Registered repo id (omit for the default)",
				},
				mode: { type: "string", enum: ["ask", "code"] },
			},
			required: ["prompt"],
		},
	},
	{
		type: "function",
		name: "steer_session",
		description:
			"Send a message into an existing session — steering a running one or starting its next turn.",
		parameters: {
			type: "object",
			properties: {
				session_id: { type: "string" },
				message: { type: "string" },
			},
			required: ["session_id", "message"],
		},
	},
	{
		type: "function",
		name: "list_todos",
		description: "The user's open todo list.",
		parameters: { type: "object", properties: {}, required: [] },
	},
	{
		type: "function",
		name: "add_todo",
		description: "Add a todo to the user's list.",
		parameters: {
			type: "object",
			properties: { text: { type: "string" } },
			required: ["text"],
		},
	},
	{
		type: "function",
		name: "complete_todo",
		description: "Mark a todo done by id (from list_todos).",
		parameters: {
			type: "object",
			properties: { id: { type: "string" } },
			required: ["id"],
		},
	},
];

function truncate(s: string, n: number): string {
	return s.length > n ? `${s.slice(0, n)}…` : s;
}

/** Recent Desk text-mode conversation, inlined so the voice engine picks the
 *  conversation up mid-thread instead of starting blank. */
function recentDeskContext(sessionId: string): string {
	try {
		const tail = getSessionControl().transcriptTail(sessionId, 12);
		const lines = tail
			.filter((e) => (e.type === "user" || e.type === "assistant") && e.content)
			.map(
				(e) =>
					`${e.type === "user" ? "User" : "Desk"}: ${truncate(e.content.replace(/\s+/g, " "), 300)}`,
			);
		if (!lines.length) return "";
		return `\n\nRecent Desk conversation (text mode, continue from it):\n${lines.join("\n")}`;
	} catch {
		return "";
	}
}

export async function mintVoiceSecret(user: string): Promise<{
	clientSecret: string;
	expiresAt: number;
	model: string;
	sessionId: string;
}> {
	const key = readKeyFile().openaiApiKey;
	if (!key)
		throw new Error(
			"No OpenAI API key configured for Desk voice — set one in Settings → Desk voice.",
		);
	const { sessionId } = ensureDeskSession(user);
	const res = await fetch("https://api.openai.com/v1/realtime/client_secrets", {
		method: "POST",
		headers: {
			Authorization: `Bearer ${key}`,
			"Content-Type": "application/json",
		},
		body: JSON.stringify({
			expires_after: { anchor: "created_at", seconds: 600 },
			session: {
				type: "realtime",
				model: DESK_VOICE_MODEL,
				instructions: VOICE_INSTRUCTIONS + recentDeskContext(sessionId),
				tools: VOICE_TOOLS,
				tool_choice: "auto",
				audio: {
					input: { transcription: { model: "gpt-4o-mini-transcribe" } },
					output: { voice: "marin" },
				},
			},
		}),
	});
	if (!res.ok) {
		const text = await res.text().catch(() => "");
		throw new Error(
			`OpenAI rejected the voice session (${res.status}): ${truncate(text, 300)}`,
		);
	}
	const data = (await res.json()) as { value?: string; expires_at?: number };
	if (!data.value) throw new Error("OpenAI returned no client secret");
	return {
		clientSecret: data.value,
		expiresAt: data.expires_at ?? 0,
		model: DESK_VOICE_MODEL,
		sessionId,
	};
}

// ---------------------------------------------------------------------------
// Tool facade — executes as the verified user, same underlying operations as
// the Desk's interactive tools. Results are compact: they get spoken, not read.

export async function executeVoiceTool(
	user: string,
	name: string,
	args: Record<string, unknown>,
): Promise<unknown> {
	const control = getSessionControl();
	const desk = ensureDeskSession(user);
	switch (name) {
		case "list_current_work": {
			const dayAgo = Date.now() - 24 * 60 * 60 * 1000;
			const sessions = control
				.listSessions()
				.filter(
					(s) =>
						!s.desk &&
						s.state !== "archived" &&
						(s.state !== "idle" ||
							(s.lastActivity && Date.parse(s.lastActivity) > dayAgo)),
				)
				.slice(0, 15)
				.map((s) => ({
					id: s.id,
					title: s.title || "(untitled)",
					state: s.state,
					repo: s.repo,
					lastActivity: s.lastActivity,
				}));
			return { sessions };
		}
		case "inspect_session": {
			const id = String(args.session_id ?? "");
			const s = control.getSession(id);
			if (!s) return { error: `no session ${id}` };
			return {
				id: s.id,
				title: s.title,
				state: s.state,
				repo: s.repo,
				branch: s.branch,
				pendingQuestion: s.pendingQuestion,
				recent: control.transcriptTail(id, 10).map((e) => ({
					type: e.type,
					tool: e.toolName,
					content: truncate((e.content || "").replace(/\s+/g, " "), 300),
				})),
			};
		}
		case "start_session": {
			const prompt = String(args.prompt ?? "").trim();
			if (!prompt) return { error: "start_session needs a prompt" };
			const mode = args.mode === "code" ? "code" : "ask";
			const { id } = await control.createSession({
				prompt,
				repo: typeof args.repo === "string" ? args.repo : undefined,
				mode,
				user,
				parentSessionId: desk.sessionId,
			});
			return { id, started: true, mode };
		}
		case "steer_session": {
			const id = String(args.session_id ?? "");
			const message = String(args.message ?? "").trim();
			if (!id || !message)
				return { error: "steer_session needs session_id and message" };
			return await control.deliverToSession(id, message, user);
		}
		case "list_todos":
			return {
				todos: listTodos({ user }).map((t) => ({
					id: t.id,
					text: t.text,
					due: t.due,
				})),
			};
		case "add_todo": {
			const text = String(args.text ?? "").trim();
			if (!text) return { error: "add_todo needs text" };
			const todo = addTodo({
				user,
				text,
				source: { kind: "manual", by: user },
			});
			return { id: todo.id, added: todo.text };
		}
		case "complete_todo": {
			const todo = updateTodo(String(args.id ?? ""), { status: "done" }, user);
			return { id: todo.id, done: todo.text };
		}
		default:
			return { error: `unknown tool ${name}` };
	}
}

// ---------------------------------------------------------------------------
// Transcript mirroring + handoff buffer. Mirrored entries land in the Desk's
// transcript store (which broadcasts to overlay watchers live); the handoff
// buffer is the separate copy the NEXT TEXT TURN's engine context needs,
// consumed by takeVoiceHandoff() in run-session.ts. Entries upsert by id so a
// re-sent final refines in place instead of duplicating.

interface HandoffEntry {
	id: string;
	role: "user" | "assistant" | "action";
	text: string;
}

function handoffPath(sessionId: string): string {
	return `${HANDOFF_DIR}/${sessionId.replace(/[^A-Za-z0-9_-]/g, "_")}.json`;
}

function appendHandoff(sessionId: string, entries: HandoffEntry[]): void {
	try {
		mkdirSync(HANDOFF_DIR, { recursive: true });
		const path = handoffPath(sessionId);
		let existing: HandoffEntry[] = [];
		try {
			if (existsSync(path))
				existing = JSON.parse(readFileSync(path, "utf-8")) as HandoffEntry[];
		} catch {}
		for (const e of entries) {
			const i = existing.findIndex((x) => x.id === e.id);
			if (i >= 0) existing[i] = e;
			else existing.push(e);
		}
		writeJsonAtomic(path, existing.slice(-80));
	} catch (e) {
		console.error("[desk-voice] failed to buffer handoff:", e);
	}
}

/** Consume the pending voice handoff for a session (one-shot), formatted as a
 *  context note for the next text turn. Undefined when no voice turns landed. */
export function takeVoiceHandoff(sessionId: string): string | undefined {
	const path = handoffPath(sessionId);
	let entries: HandoffEntry[] = [];
	try {
		if (!existsSync(path)) return undefined;
		entries = JSON.parse(readFileSync(path, "utf-8")) as HandoffEntry[];
		rmSync(path, { force: true });
	} catch {
		return undefined;
	}
	if (!entries.length) return undefined;
	const lines = entries.map((e) =>
		e.role === "action"
			? `Action: ${e.text}`
			: `${e.role === "user" ? "User" : "Desk"} (voice): ${e.text}`,
	);
	return `## Voice conversation handoff\nWhile in voice mode, you (the Desk) had this spoken conversation via GPT Realtime. It is already in the visible transcript — don't repeat or re-answer it; continue with full awareness of what was said and done:\n\n${lines.join("\n")}`;
}

export function mirrorVoiceEntries(
	user: string,
	entries: { id: string; role: "user" | "assistant"; text: string }[],
): void {
	if (!entries.length) return;
	const { sessionId } = ensureDeskSession(user);
	const now = new Date().toISOString();
	const tes: TranscriptEntry[] = entries.map((e) => ({
		id: e.id,
		type: e.role,
		content: e.text,
		timestamp: now,
	}));
	transcriptStore().appendTranscriptEvents(sessionId, tes);
	appendHandoff(
		sessionId,
		entries.map((e) => ({
			id: e.id,
			role: e.role,
			text: truncate(e.text, 1000),
		})),
	);
}

export function mirrorVoiceToolCall(
	user: string,
	callId: string,
	name: string,
	args: Record<string, unknown>,
	result: unknown,
): void {
	const { sessionId } = ensureDeskSession(user);
	const now = new Date().toISOString();
	transcriptStore().appendTranscriptEvents(sessionId, [
		{
			id: `voice-tu-${callId}`,
			type: "tool_use",
			toolName: name,
			content: JSON.stringify(args),
			timestamp: now,
		},
		{
			id: `voice-tr-${callId}`,
			type: "tool_result",
			toolName: name,
			content: truncate(JSON.stringify(result) ?? "", 2000),
			timestamp: now,
		},
	]);
	appendHandoff(sessionId, [
		{
			id: `voice-act-${callId}`,
			role: "action",
			text: `${name}(${truncate(JSON.stringify(args), 200)}) → ${truncate(JSON.stringify(result) ?? "", 300)}`,
		},
	]);
}
