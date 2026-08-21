import { describe, expect, test } from "bun:test";
import {
	PERSISTENT_NOTICE_SHELF,
	TRANSIENT_NOTICE_LANE,
} from "./notification-classes";

describe("notification lanes", () => {
	test("keeps transient feedback clear of the reading column", () => {
		expect(TRANSIENT_NOTICE_LANE).toContain("right-4");
		expect(TRANSIENT_NOTICE_LANE).toContain(
			"top-[calc(var(--desktop-header-h)+8px)]",
		);
		expect(TRANSIENT_NOTICE_LANE).toContain("phone:inset-x-0");
		expect(TRANSIENT_NOTICE_LANE).toContain(
			"phone:top-[calc(var(--header-h)+8px)]",
		);
		expect(TRANSIENT_NOTICE_LANE).not.toContain("bottom-");
	});

	test("keeps durable desktop prompts in a separate shelf", () => {
		expect(PERSISTENT_NOTICE_SHELF).toContain("bottom-2");
		expect(PERSISTENT_NOTICE_SHELF).toContain("left-2");
		expect(PERSISTENT_NOTICE_SHELF).not.toContain("phone:");
	});
});
