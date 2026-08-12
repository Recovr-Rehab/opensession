import { describe, expect, test } from "bun:test";
import { runnerLaunchdPlist, runnerSystemdUnit } from "./connect";

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
});
