import { useMemo } from "react";
import { useSync } from "@tldraw/sync";
import {
	UserRecordType,
	computed,
	inlineBase64AssetStore,
	type TLUserStore,
} from "tldraw";
import {
	CANVAS_ROOM_ID,
	CANVAS_SCHEMA,
	canvasUserId,
} from "../../shared/canvas-schema";
import type { Person } from "./people";
import { canvasIdentityColor } from "./canvas-card-identity";

export function canvasSyncUrl(): string {
	const protocol = location.protocol === "https:" ? "wss:" : "ws:";
	const url = new URL(`${protocol}//${location.host}/canvas-ws`);
	url.searchParams.set("room", CANVAS_ROOM_ID);
	return url.toString();
}

function useCanvasUserStore(user: string, people: Person[]): TLUserStore {
	const person = people.find(
		(candidate) => candidate.name.toLowerCase() === user.toLowerCase(),
	);
	const login = person?.github?.trim() || "";
	const key = (login || user || "anonymous").toLowerCase();
	return useMemo(() => {
		const record = UserRecordType.create({
			id: canvasUserId(key),
			name: person?.name || user || "Anonymous",
			color: canvasIdentityColor(key),
			imageUrl: login ? `https://github.com/${login}.png?size=96` : "",
		});
		return {
			currentUser: computed("canvas current user", () => record),
		};
	}, [key, login, person?.name, user]);
}

export function useCanvasStore(user: string, people: Person[]) {
	const users = useCanvasUserStore(user, people);
	return useSync({
		uri: canvasSyncUrl(),
		assets: inlineBase64AssetStore,
		users,
		schema: CANVAS_SCHEMA,
	});
}
