import { expect, test } from "bun:test";
import { auditCounts } from "./ui-audit";

/**
 * The ratchet. Each count may fall freely and never rise: a new raw `<button>`
 * or a new `text-[13px]` fails here rather than being noticed a year later on
 * a screen that reads subtly unlike the rest of the app.
 *
 * Failing this is not a request to edit the budget upward. Use the primitive
 * the message names, or — if the case genuinely needs something the system
 * does not have — add the variant to `src/frontend/ui/` and land it there.
 */
test("design-system drift stays under budget", () => {
	for (const { id, count, budget } of auditCounts()) {
		expect(
			count,
			`${id}: ${count} exceeds ${budget}. See bun scripts/ui-audit.ts --files ${id}`,
		).toBeLessThanOrEqual(budget);
	}
});

test("budgets are ratcheted down when the count falls", () => {
	const slack = auditCounts().filter(({ count, budget }) => count < budget);
	expect(
		slack.map((s) => `${s.id} ${s.count} < ${s.budget}`),
		"run bun scripts/ui-audit.ts --save to bank the progress",
	).toEqual([]);
});
