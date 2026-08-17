import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { TeamMember } from "./config";
import { __setIdentitiesForTest } from "./shared/user-mappings";
import { analyticsPersonName } from "./analytics";

const TEAM: TeamMember[] = [
	{
		name: "Alice Example",
		email: "alice@example.com",
		aliases: ["alice"],
		github: "alice-login",
	},
];

describe("Analytics person attribution", () => {
	let restore: (() => void) | undefined;

	beforeAll(() => {
		restore = __setIdentitiesForTest(TEAM);
	});

	afterAll(() => restore?.());

	test("merges a teammate's short name, full name, and verified login", () => {
		expect(analyticsPersonName("Alice")).toBe("Alice");
		expect(analyticsPersonName("Alice Example")).toBe("Alice");
		expect(analyticsPersonName("Old display label", "alice-login")).toBe("Alice");
	});

	test("preserves labels outside the configured roster", () => {
		expect(analyticsPersonName("Other")).toBe("Other");
	});
});
