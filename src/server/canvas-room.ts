/**
 * One durable tldraw sync room for the instance-wide Canvas. Document records
 * (including every card's x/y/w/h) are persisted atomically; tldraw keeps
 * cursors, selections and other presence in a separate ephemeral lane.
 *
 * Importing this module is side-effect free. The room and its persistence
 * timer are created lazily on the first Canvas WebSocket connection.
 */
import type {
	InMemorySyncStorage,
	RoomSnapshot,
	TLSocketRoom,
} from "@tldraw/sync-core";
import type { ServerWebSocket } from "bun";
import { existsSync, readFileSync } from "fs";
import type { CanvasRecord } from "../shared/canvas-schema";
import { stateDir } from "./paths";
import { writeJsonAtomic } from "./shared/atomic-write";
import type { WSClientData } from "./ws-hub";

const g = globalThis as any;
const PERSIST_DELAY_MS = 500;
const CANVAS_ROOM_ID = "main";
const PUT_OPERATION = "put";
const PATCH_OPERATION = "patch";

interface CanvasSessionMeta {
	user: string | null;
	login: string | null;
}

interface CanvasRoomState {
	room: TLSocketRoom<CanvasRecord, CanvasSessionMeta>;
	storage: InMemorySyncStorage<CanvasRecord>;
	dirty: boolean;
	persistTimer: ReturnType<typeof setTimeout> | null;
	unlisten: () => void;
}

const rooms: Map<string, CanvasRoomState> = (g.__canvasSyncRooms ??= new Map());

interface CanvasRuntime {
	core: typeof import("@tldraw/sync-core");
	schema: typeof import("../shared/canvas-schema");
}

async function ensureRuntime(): Promise<CanvasRuntime> {
	if (!g.__canvasSyncRuntime) {
		g.__canvasSyncRuntime = Promise.all([
			import("@tldraw/sync-core"),
			import("../shared/canvas-schema"),
		]).then(([core, schema]) => ({ core, schema }));
	}
	return g.__canvasSyncRuntime;
}

function runtime(): CanvasRuntime {
	const loaded = g.__canvasSyncRuntimeValue as CanvasRuntime | undefined;
	if (!loaded) throw new Error("Canvas sync runtime was not prepared before upgrade");
	return loaded;
}

function snapshotPath(roomId = CANVAS_ROOM_ID): string {
	return `${stateDir("canvas")}/${roomId}.json`;
}

function emptySnapshot(): RoomSnapshot {
	return {
		...structuredClone(runtime().core.DEFAULT_INITIAL_SNAPSHOT),
		schema: runtime().schema.CANVAS_SCHEMA.serialize(),
	};
}

function loadSnapshot(roomId: string): RoomSnapshot {
	const path = snapshotPath(roomId);
	if (!existsSync(path)) return emptySnapshot();
	try {
		const value = JSON.parse(readFileSync(path, "utf8")) as RoomSnapshot;
		if (!Array.isArray(value.documents) || typeof value.documentClock !== "number") {
			throw new Error("invalid room snapshot");
		}
		return value;
	} catch (error) {
		console.error(`[canvas] failed to load ${path}; starting empty:`, error);
		return emptySnapshot();
	}
}

function persist(state: CanvasRoomState): void {
	if (state.persistTimer) clearTimeout(state.persistTimer);
	state.persistTimer = null;
	if (!state.dirty) return;
	try {
		writeJsonAtomic(snapshotPath(), state.storage.getSnapshot(), false, 0o600);
		state.dirty = false;
	} catch (error) {
		console.error("[canvas] failed to persist room; retrying:", error);
		state.persistTimer = setTimeout(() => persist(state), PERSIST_DELAY_MS);
	}
}

function schedulePersist(state: CanvasRoomState): void {
	state.dirty = true;
	if (state.persistTimer) return;
	state.persistTimer = setTimeout(() => persist(state), PERSIST_DELAY_MS);
}

function getRoom(): CanvasRoomState {
	const existing = rooms.get(CANVAS_ROOM_ID);
	if (existing) return existing;

	const { InMemorySyncStorage, TLSocketRoom } = runtime().core;
	let storage: InMemorySyncStorage<CanvasRecord>;
	try {
		storage = new InMemorySyncStorage<CanvasRecord>({
			snapshot: loadSnapshot(CANVAS_ROOM_ID),
		});
	} catch (error) {
		console.error("[canvas] stored room is incompatible; starting empty:", error);
		storage = new InMemorySyncStorage<CanvasRecord>({ snapshot: emptySnapshot() });
	}
	const state = {} as CanvasRoomState;
	const room = new TLSocketRoom<CanvasRecord, CanvasSessionMeta>({
		storage,
		schema: runtime().schema.CANVAS_SCHEMA,
		log: {
			warn: (...args) => console.warn("[canvas]", ...args),
			error: (...args) => console.error("[canvas]", ...args),
		},
		onAfterReceiveMessage: (args: any) => {
			rewriteVerifiedPresence(args.message, args.meta);
		},
	});
	Object.assign(state, {
		room,
		storage,
		dirty: false,
		persistTimer: null,
		unlisten: storage.onChange(() => schedulePersist(state)),
	});
	rooms.set(CANVAS_ROOM_ID, state);
	return state;
}

function rewriteVerifiedPresence(message: any, meta: CanvasSessionMeta): void {
	if (!meta.user || message?.type !== "push" || !message.presence) return;
	const userId = runtime().schema.canvasUserId(meta.login || meta.user);
	const [operation, value] = message.presence;
	if (operation === PUT_OPERATION) {
		message.presence = [
			operation,
			{ ...value, userId, userName: meta.user },
		];
	} else if (operation === PATCH_OPERATION) {
		message.presence = [
			operation,
			{
				...value,
				userId: [PUT_OPERATION, userId],
				userName: [PUT_OPERATION, meta.user],
			},
		];
	}
}

interface UpgradableServer {
	upgrade(req: Request, opts: { data: WSClientData }): boolean;
}

/** Upgrade the authenticated, same-origin /canvas-ws request. */
async function handleUpgrade(
	req: Request,
	server: UpgradableServer,
	identity: { user: string | null; login: string | null },
): Promise<Response | undefined> {
	g.__canvasSyncRuntimeValue = await ensureRuntime();
	const url = new URL(req.url);
	const roomId = url.searchParams.get("room") || CANVAS_ROOM_ID;
	const sessionId = url.searchParams.get("sessionId") || "";
	if (roomId !== CANVAS_ROOM_ID) return new Response("Canvas room not found", { status: 404 });
	if (!sessionId || sessionId.length > 160 || /\s/.test(sessionId)) {
		return new Response("Invalid Canvas session", { status: 400 });
	}
	const upgraded = server.upgrade(req, {
		data: {
			watchingSessionId: null,
			user: identity.user,
			authUser: identity.user,
			authLogin: identity.login,
			canvasRoomId: roomId,
			canvasSessionId: sessionId,
		},
	});
	return upgraded ? undefined : new Response("WebSocket upgrade failed", { status: 400 });
}

function wsOpen(ws: ServerWebSocket<WSClientData>): boolean {
	if (!ws.data.canvasSessionId) return false;
	getRoom().room.handleSocketConnect({
		sessionId: ws.data.canvasSessionId,
		socket: ws,
		meta: {
			user: ws.data.authUser || ws.data.user || null,
			login: ws.data.authLogin || null,
		},
	});
	return true;
}

function wsMessage(ws: ServerWebSocket<WSClientData>, message: string | Buffer): boolean {
	if (!ws.data.canvasSessionId) return false;
	getRoom().room.handleSocketMessage(ws.data.canvasSessionId, message as any);
	return true;
}

function wsClose(ws: ServerWebSocket<WSClientData>): boolean {
	if (!ws.data.canvasSessionId) return false;
	getRoom().room.handleSocketClose(ws.data.canvasSessionId);
	return true;
}

function flushRooms(): void {
	for (const state of rooms.values()) {
		// A storage change notifies on a microtask. Shutdown can arrive before that
		// callback marks the room dirty, so an explicit flush always snapshots.
		state.dirty = true;
		persist(state);
	}
}

const impl = { handleUpgrade, wsOpen, wsMessage, wsClose, flushRooms };
g.__canvasRoomImpl = impl;
type Impl = typeof impl;
const live = (): Impl => (g.__canvasRoomImpl as Impl) ?? impl;

export function handleCanvasWsUpgrade(
	req: Request,
	server: UpgradableServer,
	identity: { user: string | null; login: string | null },
): Promise<Response | undefined> {
	return live().handleUpgrade(req, server, identity);
}

export function canvasWsOpen(ws: ServerWebSocket<WSClientData>): boolean {
	return live().wsOpen(ws);
}

export function canvasWsMessage(
	ws: ServerWebSocket<WSClientData>,
	message: string | Buffer,
): boolean {
	return live().wsMessage(ws, message);
}

export function canvasWsClose(ws: ServerWebSocket<WSClientData>): boolean {
	return live().wsClose(ws);
}

export function flushCanvasRooms(): void {
	live().flushRooms();
}

/** Test seams: no live room is created until the first call. */
export function canvasSnapshotPathForTest(): string {
	return snapshotPath();
}


export async function canvasRoomForTest(): Promise<CanvasRoomState> {
	g.__canvasSyncRuntimeValue = await ensureRuntime();
	return getRoom();
}

export function resetCanvasRoomsForTest(): void {
	for (const state of rooms.values()) {
		if (state.persistTimer) clearTimeout(state.persistTimer);
		state.unlisten();
		state.room.close();
	}
	rooms.clear();
}

export async function rewriteCanvasPresenceForTest(
	message: any,
	meta: CanvasSessionMeta,
): Promise<void> {
	g.__canvasSyncRuntimeValue = await ensureRuntime();
	rewriteVerifiedPresence(message, meta);
}
