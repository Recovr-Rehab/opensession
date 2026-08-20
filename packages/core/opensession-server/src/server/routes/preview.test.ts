import { describe, expect, test } from "bun:test";
import { unavailableSandboxPreviewStatus } from "./preview";

describe("preview routing while a sandbox is unavailable", () => {
	test("keeps a preparing sandbox off the host preview path", () => {
		expect(
			unavailableSandboxPreviewStatus({
				sandbox: { provider: "daytona", lifecycle: "preparing" },
			}),
		).toMatchObject({
			running: false,
			starting: true,
			bootable: false,
			sandboxLifecycle: "preparing",
		});
	});

	test("does not represent a missing awake sandbox as host-bootable", () => {
		expect(
			unavailableSandboxPreviewStatus({
				sandbox: {
					provider: "box",
					sandboxId: "bx_missing",
					lifecycle: "awake",
				},
			}),
		).toMatchObject({ running: false, starting: false, bootable: false });
	});

	test("leaves non-sandbox sessions on the host preview path", () => {
		expect(unavailableSandboxPreviewStatus({})).toBeNull();
	});
});
