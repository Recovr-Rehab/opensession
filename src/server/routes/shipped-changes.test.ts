import { describe, expect, test } from "bun:test";
import { shippedScreenshotWorkerOpts } from "./shipped-changes";

describe("shipped change screenshot worker", () => {
	test("runs as a hidden child without reporting into the parent chat", () => {
		const options = shippedScreenshotWorkerOpts("session-1", "Kent");

		expect(options.forkFrom).toEqual({ sourceId: "session-1" });
		expect(options.parentSessionId).toBe("session-1");
		expect(options.spawnedBy).toBe("session-1");
		expect(options.reportBack).toBe(false);
		expect(options.user).toBe("Kent");
		expect(options.prompt).toContain("background proof work");
		expect(options.prompt).not.toContain("send_to_session");
	});
});
