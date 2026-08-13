import { describe, expect, test } from "bun:test";
import { sessionBelongsToOnboardingUser } from "./onboarding";

const base = {
	automation: undefined,
	createdBy: null,
	createdByLogin: undefined,
	desk: undefined,
	startedBy: null,
};

describe("teammate onboarding ownership", () => {
	test("prefers a verified GitHub login", () => {
		expect(
			sessionBelongsToOnboardingUser(
				{ ...base, createdByLogin: "HAPPYLINKS", startedBy: "Someone else" },
				{ login: "happylinks", name: "Michiel Westerbeek" },
			),
		).toBe(true);
		expect(
			sessionBelongsToOnboardingUser(
				{ ...base, createdBy: "Michiel", createdByLogin: "someone-else" },
				{ login: "happylinks", name: "Michiel Westerbeek" },
			),
		).toBe(false);
	});

	test("recognizes full and first-name legacy attribution", () => {
		expect(
			sessionBelongsToOnboardingUser(
				{ ...base, startedBy: "Michiel Westerbeek" },
				{ name: "Michiel Westerbeek" },
			),
		).toBe(true);
		expect(
			sessionBelongsToOnboardingUser(
				{ ...base, createdBy: "Michiel" },
				{ name: "Michiel Westerbeek" },
			),
		).toBe(true);
	});

	test("does not use ambiguous first-name attribution for verified identities", () => {
		expect(
			sessionBelongsToOnboardingUser(
				{ ...base, createdBy: "Alex" },
				{ login: "alex-two", name: "Alex Rivera" },
			),
		).toBe(false);
	});

	test("does not count Desk or automation sessions", () => {
		expect(
			sessionBelongsToOnboardingUser(
				{ ...base, desk: true, startedBy: "Michiel" },
				{ name: "Michiel" },
			),
		).toBe(false);
		expect(
			sessionBelongsToOnboardingUser(
				{ ...base, automation: "Daily", startedBy: "Michiel" },
				{ name: "Michiel" },
			),
		).toBe(false);
	});
});
