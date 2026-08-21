import { expect, test } from "bun:test";
import {
	ARCHIVED_ROW,
	ARCHIVED_ROW_ACTION,
	ARCHIVED_SWIPE_ACTION,
	ARCHIVED_SWIPE_ROW,
} from "./archived-classes";

test("archived phone rows reveal Restore instead of reserving a button", () => {
	expect(ARCHIVED_ROW_ACTION).toContain("phone:hidden");
	expect(ARCHIVED_ROW).toContain("phone:pr-3");
	expect(ARCHIVED_ROW).not.toContain("phone:pr-[54px]");
	expect(ARCHIVED_SWIPE_ROW).toContain("[--swipe-action-w:0px]");
	expect(ARCHIVED_SWIPE_ACTION).toContain("data-[open]:opacity-100");
	expect(ARCHIVED_SWIPE_ACTION).toContain("phone:flex");
});
