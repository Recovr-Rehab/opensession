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

	test("centres toast receipts above the desktop composer", () => {
		expect(TOAST_NOTICE_LANE).toContain("inset-x-0");
		expect(TOAST_NOTICE_LANE).toContain("bottom-[124px]");
	});

	test("keeps phone receipts below the top bar and tabs", () => {
		expect(TOAST_NOTICE_LANE).toContain(
			"phone:top-[calc(var(--header-h)+8px)]",
		);
		expect(TOAST_NOTICE_LANE).toContain("phone:bottom-auto");
		expect(TOAST_NOTICE_LANE).toContain(
			"phone:[body:has(.session-tab-view)_&]:top-[calc(var(--header-h)+54px)]",
		);
		expect(TOAST_NOTICE_LANE).toContain(
			"phone:[body:has(.session-tab-reorder~.session-tab-reorder)_&]:top-[calc(var(--header-h)+54px)]",
		);
	});

	test("keeps durable desktop prompts in a separate shelf", () => {
		expect(PERSISTENT_NOTICE_SHELF).toContain("bottom-2");
		expect(PERSISTENT_NOTICE_SHELF).toContain("left-2");
		expect(PERSISTENT_NOTICE_SHELF).not.toContain("phone:");
	});
});
