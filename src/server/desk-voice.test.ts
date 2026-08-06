import { describe, expect, test } from "bun:test";
import {
	buildVoiceSessionConfig,
	DESK_VOICE_TURN_DETECTION,
} from "./desk-voice";

describe("Desk voice Realtime session", () => {
	test("uses low-eagerness semantic VAD instead of default endpointing", () => {
		expect(DESK_VOICE_TURN_DETECTION).toEqual({
			type: "semantic_vad",
			eagerness: "low",
			create_response: true,
			interrupt_response: true,
		});
		expect(buildVoiceSessionConfig("missing-test-session").audio.input.turn_detection)
			.toBe(DESK_VOICE_TURN_DETECTION);
	});
});
