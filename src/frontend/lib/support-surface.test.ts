import { describe, expect, test } from "bun:test";
import { supportSurfaceOf, SUPPORT_SURFACE_OPTIONS } from "./support-surface";

describe("supportSurfaceOf", () => {
	test("names each pair of visibilities", () => {
		expect(supportSurfaceOf(true, true)).toBe("both");
		expect(supportSurfaceOf(true, false)).toBe("page");
		expect(supportSurfaceOf(false, true)).toBe("sidebar");
		expect(supportSurfaceOf(false, false)).toBe("off");
	});

	test("every state the two switches can reach has a name to show for it", () => {
		const named = new Set(SUPPORT_SURFACE_OPTIONS.map((o) => o.value));
		for (const tool of [true, false])
			for (const band of [true, false])
				expect(named.has(supportSurfaceOf(tool, band))).toBe(true);
	});
});
