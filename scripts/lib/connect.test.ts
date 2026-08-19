import { describe, expect, test } from "bun:test";
import { parseRunnerPortalRegistry, runnerLaunchdPlist, runnerScheduledTaskXml, runnerSystemdUnit, serializeRunnerPortalRegistry, windowsRunnerEnvironment } from "./connect";

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

	test("the Windows scheduled task reconnects hidden without embedding a credential", () => {
		const xml = runnerScheduledTaskXml("C:\\Users\\o'brien\\.opensession\\src\\scripts\\cli.ts", "C:\\Users\\o'brien\\.bun\\bin\\bun.exe", "OFFICE\\owner");
		expect(xml).toContain("runner run");
		expect(xml).toContain("-WindowStyle Hidden");
		expect(xml).toContain("<UserId>OFFICE\\owner</UserId>");
		expect(xml).toContain("<RestartOnFailure>");
		expect(xml).toContain("<ExecutionTimeLimit>PT0S</ExecutionTimeLimit>");
		expect(xml).toContain("<RunLevel>LeastPrivilege</RunLevel>");
		// A quote in the profile path must not break the PowerShell action.
		expect(xml).toContain("o''brien");
		expect(xml).not.toContain("runner.json");
	});

	test("the Windows runner environment keeps system essentials and drops secrets", () => {
		const env = windowsRunnerEnvironment({
			Path: "C:\\Windows\\system32",
			PATHEXT: ".COM;.EXE;.BAT;.CMD",
			SystemRoot: "C:\\Windows",
			USERPROFILE: "C:\\Users\\o",
			"ProgramFiles(x86)": "C:\\Program Files (x86)",
			OPENAI_API_KEY: "sk-secret",
			GITHUB_TOKEN: "ghp_secret",
			HOME: "/home/x",
		});
		expect(env.Path).toBe("C:\\Windows\\system32");
		expect(env.SystemRoot).toBe("C:\\Windows");
		expect(env["ProgramFiles(x86)"]).toBe("C:\\Program Files (x86)");
		expect(env.OPENAI_API_KEY).toBeUndefined();
		expect(env.GITHUB_TOKEN).toBeUndefined();
		expect(env.HOME).toBeUndefined();
	});

	test("keeps Runner Portal metadata and ports in the shared workspace registry", () => {
		const record = { name: "api", key: "ignored", command: "bun run dev", port: 4300, state: "awake" as const };
		const text = serializeRunnerPortalRegistry("WEBAPP_PORT=3000\n# retain this\n", [record]);
		expect(text).toContain("WEBAPP_PORT=3000");
		expect(text).toContain("PORTAL_API_PORT=4300");
		expect(parseRunnerPortalRegistry(text)).toEqual([{ ...record, key: "PORTAL_API_PORT" }]);
	});
});
