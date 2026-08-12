import { describe, expect, test } from "bun:test";
import { parseRunnerPortalRegistry, runnerLaunchdPlist, runnerSystemdUnit, serializeRunnerPortalRegistry } from "./connect";

describe("Runner service definitions", () => {
	test("launchd reconnects through the CLI without embedding a credential", () => {
		const plist = runnerLaunchdPlist("/opt/opensession/cli", "/opt/bun/bin/bun");
		expect(plist).toContain("runner</string><string>run");
		expect(plist).toContain("KeepAlive");
		expect(plist).not.toContain("runner.json");
	});

	test("systemd uses a user service with restart semantics", () => {
		const unit = runnerSystemdUnit("/opt/opensession/cli", "/opt/bun/bin/bun");
		expect(unit).toContain("ExecStart=/opt/bun/bin/bun /opt/opensession/cli runner run");
		expect(unit).toContain("Restart=always");
		expect(unit).not.toContain("Token=");
	});

	test("keeps Runner Portal metadata and ports in the shared workspace registry", () => {
		const record = { name: "api", key: "ignored", command: "bun run dev", port: 4300, state: "awake" as const };
		const text = serializeRunnerPortalRegistry("WEBAPP_PORT=3000\n# retain this\n", [record]);
		expect(text).toContain("WEBAPP_PORT=3000");
		expect(text).toContain("PORTAL_API_PORT=4300");
		expect(parseRunnerPortalRegistry(text)).toEqual([{ ...record, key: "PORTAL_API_PORT" }]);
	});
});
