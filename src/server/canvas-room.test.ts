import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { CANVAS_SCHEMA, canvasUserId } from "../shared/canvas-schema";
import {
	canvasRoomForTest,
	canvasSnapshotPathForTest,
	flushCanvasRooms,
	handleCanvasWsUpgrade,
	resetCanvasRoomsForTest,
	rewriteCanvasPresenceForTest,
} from "./canvas-room";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("Canvas sync room", () => {
	let root = "";
	let previousStateDir: string | undefined;

	beforeEach(() => {
		resetCanvasRoomsForTest();
		root = mkdtempSync(join(tmpdir(), "opensession-canvas-"));
		previousStateDir = process.env.OPENSESSION_STATE_DIR;
		process.env.OPENSESSION_STATE_DIR = root;
	});

	afterEach(() => {
		resetCanvasRoomsForTest();
		if (previousStateDir === undefined) delete process.env.OPENSESSION_STATE_DIR;
		else process.env.OPENSESSION_STATE_DIR = previousStateDir;
		rmSync(root, { recursive: true, force: true });
	});

	test("persists shared card geometry and restores it", async () => {
		const state = await canvasRoomForTest();
		const shape = CANVAS_SCHEMA.types.shape.create({
			id: "shape:card-test",
			type: "session-card",
			parentId: "page:page",
			index: "a1",
			x: 120,
			y: 240,
			props: { w: 480, h: 360, sessionId: "session-test" },
		} as any);
		state.storage.transaction((tx) => tx.set(shape.id, shape));
		flushCanvasRooms();

		const persisted = JSON.parse(readFileSync(canvasSnapshotPathForTest(), "utf8"));
		const stored = persisted.documents.find(
			(entry: any) => entry.state.id === "shape:card-test",
		)?.state;
		expect(stored).toMatchObject({
			x: 120,
			y: 240,
			props: { w: 480, h: 360, sessionId: "session-test" },
		});
		expect(
			persisted.documents.some((entry: any) => entry.state.typeName === "instance_presence"),
		).toBe(false);

		resetCanvasRoomsForTest();
		const restored = await canvasRoomForTest();
		const restoredShape = restored.storage
			.getSnapshot()
			.documents.find((entry) => entry.state.id === "shape:card-test")?.state;
		expect(restoredShape).toEqual(stored);
	});

	test("persists during continuous changes instead of waiting for them to stop", async () => {
		const state = await canvasRoomForTest();
		const shape = CANVAS_SCHEMA.types.shape.create({
			id: "shape:card-active",
			type: "session-card",
			parentId: "page:page",
			index: "a1",
			x: 0,
			y: 0,
			props: { w: 480, h: 360, sessionId: "session-active" },
		} as any);
		for (let x = 0; x < 6; x++) {
			state.storage.transaction((tx) =>
				tx.set(shape.id, { ...shape, x } as any),
			);
			await sleep(100);
		}
		const persisted = JSON.parse(readFileSync(canvasSnapshotPathForTest(), "utf8"));
		expect(
			persisted.documents.find((entry: any) => entry.state.id === shape.id)?.state.x,
		).toBeGreaterThanOrEqual(3);
	});

	test("stamps authenticated identity onto presence pushes", async () => {
		const message: any = {
			type: "push",
			presence: [
				"patch",
				{
					userId: ["put", canvasUserId("imposter")],
					userName: ["put", "Imposter"],
				},
			],
		};
		await rewriteCanvasPresenceForTest(message, {
			user: "Michiel",
			login: "happylinks",
		});
		expect(message.presence[1].userId).toEqual([
			"put",
			canvasUserId("happylinks"),
		]);
		expect(message.presence[1].userName).toEqual([
			"put",
			"Michiel",
		]);
	});

	test("validates the room and session before upgrading", async () => {
		let upgradedData: any;
		const server = {
			upgrade(_req: Request, options: { data: unknown }) {
				upgradedData = options.data;
				return true;
			},
		};
		const identity = { user: "Michiel", login: "happylinks" };
		const invalid = await handleCanvasWsUpgrade(
			new Request("http://localhost/canvas-ws?room=other&sessionId=test"),
			server,
			identity,
		);
		expect(invalid?.status).toBe(404);
		expect(upgradedData).toBeUndefined();

		const valid = await handleCanvasWsUpgrade(
			new Request("http://localhost/canvas-ws?room=main&sessionId=test"),
			server,
			identity,
		);
		expect(valid).toBeUndefined();
		expect(upgradedData).toMatchObject({
			canvasRoomId: "main",
			canvasSessionId: "test",
			authUser: "Michiel",
			authLogin: "happylinks",
		});
	});
});
