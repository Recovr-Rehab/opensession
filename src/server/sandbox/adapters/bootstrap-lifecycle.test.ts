import { describe, expect, test } from "bun:test";
import {
	runRemoteLifecycleHook,
	type RemoteDriver,
} from "./bootstrap";

function driver(results: Array<{ exitCode: number; stdout?: string; stderr?: string }>) {
	const commands: Array<{ command: string; opts?: any }> = [];
	const value: RemoteDriver = {
		exec: async (command, opts) => {
			commands.push({ command, opts });
			const result = results.shift() || { exitCode: 0 };
			return { stdout: "", stderr: "", ...result };
		},
		execBackground: async () => {},
		writeFile: async () => {},
		ensureStarted: async () => {},
	};
	return { value, commands };
}

describe("remote repo lifecycle", () => {
	test("setup is skipped after its durable stamp", async () => {
		const d = driver([{ exitCode: 0, stdout: "stamped\n" }]);
		expect(
			await runRemoteLifecycleHook(d.value, "/work/repo", "setup", "fresh"),
		).toMatchObject({ ran: false });
		expect(d.commands).toHaveLength(1);
	});

	test("runs executable setup once with a bounded log outside the repo", async () => {
		const d = driver([
			{ exitCode: 0, stdout: "present\n" },
			{ exitCode: 0 },
			{ exitCode: 0 },
		]);
		const result = await runRemoteLifecycleHook(
			d.value,
			"/work/repo",
			"setup",
			"fresh",
		);
		expect(result.ran).toBe(true);
		expect(result.log).toContain("/.opensession/lifecycle/");
		expect(d.commands[2]!.command).toContain("OPENSESSION_BOOT_MODE=fresh");
		expect(d.commands[2]!.command).toContain("touch");
		expect(d.commands[2]!.opts.timeoutMs).toBe(20 * 60_000);
	});

	test("resume runs every wake and fails loudly", async () => {
		const d = driver([
			{ exitCode: 0, stdout: "present\n" },
			{ exitCode: 0 },
			{ exitCode: 7 },
		]);
		await expect(
			runRemoteLifecycleHook(d.value, "/work/repo", "resume", "resume"),
		).rejects.toThrow(".agents/resume failed with exit 7");
		expect(d.commands[2]!.command).not.toContain("setup.done");
	});

	test("refuses a present non-executable hook", async () => {
		const d = driver([
			{ exitCode: 0, stdout: "present\n" },
			{ exitCode: 1 },
		]);
		await expect(
			runRemoteLifecycleHook(d.value, "/work/repo", "resume", "resume"),
		).rejects.toThrow("not executable");
	});
});
