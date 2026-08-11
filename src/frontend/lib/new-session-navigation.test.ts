import { describe, expect, test } from "bun:test";
import { shouldOpenCreatedSession } from "./new-session-navigation";

describe("shouldOpenCreatedSession", () => {
	test("keeps direct creates navigating", () => {
		expect(shouldOpenCreatedSession(null, "/session/next", false)).toBe(true);
	});

	test("opens a palette create while its origin still owns the foreground", () => {
		expect(
			shouldOpenCreatedSession({ originPath: "/session/one" }, "/session/one", true),
		).toBe(true);
	});

	test("does not hijack a newer route or a dismissed palette", () => {
		expect(
			shouldOpenCreatedSession({ originPath: "/session/one" }, "/settings", true),
		).toBe(false);
		expect(
			shouldOpenCreatedSession({ originPath: "/session/one" }, "/session/one", false),
		).toBe(false);
	});
});
