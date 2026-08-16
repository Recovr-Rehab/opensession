import {
	createUserId,
	createTLSchema,
	defaultShapeSchemas,
	type TLRecord,
} from "@tldraw/tlschema";
import { T } from "@tldraw/validate";

export const CANVAS_ROOM_ID = "main";

export function canvasUserId(identity: string) {
	return createUserId(identity.trim().toLowerCase());
}

/** The same document schema must be used by the browser store and sync room. */
export const CANVAS_SCHEMA = createTLSchema({
	shapes: {
		...defaultShapeSchemas,
		"session-card": {
			props: {
				w: T.number,
				h: T.number,
				sessionId: T.string,
			},
		},
	},
});

export type CanvasRecord = TLRecord;
