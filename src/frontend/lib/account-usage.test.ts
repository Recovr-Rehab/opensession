import { describe, expect, test } from "bun:test";
import { bindingLimit, claudeLimits, liveUtilization } from "./account-usage";

const NOW = Date.parse("2026-08-15T12:00:00Z");
const inHours = (h: number) => new Date(NOW + h * 3_600_000).toISOString();

describe("liveUtilization", () => {
	test("reads a window that has not reset yet at face value", () => {
		expect(liveUtilization({ label: "7d", utilization: 92, resetsAt: inHours(96) }, NOW)).toBe(92);
	});

	test("counts a window whose reset has passed as empty", () => {
		// The server's picker does the same (currentUtilization); without it a
		// just-reset account reads 100% until the next poll.
		expect(liveUtilization({ label: "5h", utilization: 100, resetsAt: inHours(-1) }, NOW)).toBe(0);
	});

	test("keeps an unknown utilization unknown", () => {
		expect(liveUtilization({ label: "5h", utilization: null, resetsAt: null }, NOW)).toBeNull();
	});
});

describe("bindingLimit", () => {
	test("picks the fullest window and reports which one it is", () => {
		const binding = bindingLimit(
			[
				{ label: "5h", utilization: 4, resetsAt: inHours(3) },
				{ label: "7d", utilization: 92, resetsAt: inHours(96) },
				{ label: "Fable", utilization: 89, resetsAt: inHours(96), scoped: true },
			],
			NOW,
		);
		expect(binding?.label).toBe("7d");
		expect(binding?.utilization).toBe(92);
		expect(binding?.resetsAt).toBe(inHours(96));
	});

	test("a spent per-model cap wins a tie, because that is what sidelines the account", () => {
		const binding = bindingLimit(
			[
				{ label: "7d", utilization: 100, resetsAt: inHours(24) },
				{ label: "Fable", utilization: 100, resetsAt: inHours(24), scoped: true },
			],
			NOW,
		);
		expect(binding?.label).toBe("Fable");
	});

	test("surfaces a transient window when it is the one being hit", () => {
		const binding = bindingLimit(
			[
				{ label: "5h", utilization: 98, resetsAt: inHours(2) },
				{ label: "7d", utilization: 10, resetsAt: inHours(96) },
			],
			NOW,
		);
		expect(binding?.label).toBe("5h");
		expect(binding?.utilization).toBe(98);
	});

	test("ignores a stale window even when its stored number is the highest", () => {
		const binding = bindingLimit(
			[
				{ label: "5h", utilization: 100, resetsAt: inHours(-1) },
				{ label: "7d", utilization: 40, resetsAt: inHours(96) },
			],
			NOW,
		);
		expect(binding?.label).toBe("7d");
	});

	test("skips windows with no number rather than reading them as empty", () => {
		const binding = bindingLimit(
			[
				{ label: "5h", utilization: null, resetsAt: null },
				{ label: "7d", utilization: 3, resetsAt: inHours(96) },
			],
			NOW,
		);
		expect(binding?.label).toBe("7d");
	});

	test("has no binding limit when the account reports no numbers at all", () => {
		expect(
			bindingLimit(
				[
					{ label: "5h", utilization: null, resetsAt: null },
					{ label: "7d", utilization: null, resetsAt: null },
				],
				NOW,
			),
		).toBeNull();
	});

	test("has no binding limit for an empty list", () => {
		expect(bindingLimit([], NOW)).toBeNull();
	});
});

describe("claudeLimits", () => {
	test("flattens both windows and every per-model cap, marking the caps scoped", () => {
		expect(
			claudeLimits({
				fiveHour: { utilization: 4, resetsAt: inHours(3) },
				sevenDay: { utilization: 92, resetsAt: inHours(96) },
				scopedLimits: [{ label: "Fable", utilization: 89, resetsAt: inHours(96) }],
			}),
		).toEqual([
			{ label: "5h", utilization: 4, resetsAt: inHours(3) },
			{ label: "7d", utilization: 92, resetsAt: inHours(96) },
			{ label: "Fable", utilization: 89, resetsAt: inHours(96), scoped: true },
		]);
	});

	test("keeps the windows an account omits, so they read as unknown not zero", () => {
		const limits = claudeLimits({ fiveHour: null, sevenDay: null });
		expect(limits.map((w) => w.label)).toEqual(["5h", "7d"]);
		expect(bindingLimit(limits, NOW)).toBeNull();
	});

	test("has nothing to show for an account with no usage", () => {
		expect(claudeLimits(null)).toEqual([]);
	});
});
