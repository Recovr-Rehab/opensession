import { describe, expect, test } from "bun:test";
import {
	PERSISTENT_NOTICE_SHELF,
	TOAST_NOTICE_LANE,
	TRANSIENT_NOTICE_LANE,
} from "./notification-classes";

describe("notification lanes", () => {
	test("keeps live status clear of the reading column", () => {
		expect(TRANSIENT_NOTICE_LANE).toContain("right-4");
		expect(TRANSIENT_NOTICE_LANE).toContain(
			"top-[calc(var(--desktop-header-h)+8px)]",
		);
		expect(TRANSIENT_NOTICE_LANE).toContain("phone:inset-x-0");
		expect(TRANSIENT_NOTICE_LANE).toContain(
			"phone:top-[calc(var(--header-h)+8px)]",
		);
		// The desktop `right-4` outranks `inset-x-0` in the compiled sheet, so the
		// phone lane has to reset the right edge itself or the pill sits flush left.
		expect(TRANSIENT_NOTICE_LANE).toContain("phone:right-0");
		expect(TRANSIENT_NOTICE_LANE).not.toContain("phone:right-auto");
		expect(TRANSIENT_NOTICE_LANE).not.toContain("bottom-");
	});

	test("centres toast receipts above the composer", () => {
		expect(TOAST_NOTICE_LANE).toContain("inset-x-0");
		expect(TOAST_NOTICE_LANE).toContain("bottom-[124px]");
		expect(TOAST_NOTICE_LANE).toContain(
			"phone:bottom-[calc(max(16px,env(safe-area-inset-bottom,0px))+132px)]",
		);
		expect(TOAST_NOTICE_LANE).not.toContain("top-");
	});

	test("keeps durable desktop prompts in a separate shelf", () => {
		expect(PERSISTENT_NOTICE_SHELF).toContain("bottom-2");
		expect(PERSISTENT_NOTICE_SHELF).toContain("left-2");
		expect(PERSISTENT_NOTICE_SHELF).not.toContain("phone:");
	});
});
