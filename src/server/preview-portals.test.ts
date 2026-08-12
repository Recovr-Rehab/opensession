import { describe, expect, test } from "bun:test";
import {
	portalRouteAuthorized,
	previewServerConfig,
	writeSandboxPreviewAwsCredentials,
} from "./preview";
import type { Sandbox } from "./sandbox/provider";

describe("permission-coupled preview portals", () => {
	test("fails closed when Caddy retained a route the restarted server has not rediscovered", () => {
		expect(portalRouteAuthorized(29999)).toBe(false);
	});
	test("authenticates before proxying to the service", () => {
		const config = previewServerConfig(
			22001,
			"127.0.0.1:23001",
			"preview.example.test",
		) as any;
		expect(config.listen).toEqual([":22001"]);
		const handles = config.routes[0].handle[0].routes[0].handle;
		expect(handles[0].rewrite).toEqual({
			method: "GET",
			uri: "/api/portal-auth/22001",
		});
		expect(handles[0].upstreams[0].dial).toMatch(/^127\.0\.0\.1:\d+$/);
		expect(handles[0].handle_response[0].match.status_code).toEqual([2]);
		expect(handles[1].upstreams).toEqual([{ dial: "127.0.0.1:23001" }]);
	});

	test("refuses provider or private-network upstreams in Caddy", () => {
		expect(() => previewServerConfig(22002, "https://sandbox-provider.example:443", "preview.example.test")).toThrow("loopback relay");
		expect(() => previewServerConfig(22003, "10.200.64.2:3300", "preview.example.test")).toThrow("loopback relay");
	});

	test("vends named AWS profiles without putting secrets in the command", async () => {
		const calls: Array<{
			cmd: string[];
			env?: Record<string, string>;
		}> = [];
		const sandbox = {
			id: "sandbox-test",
			exec: async (cmd: string[], opts?: { env?: Record<string, string> }) => {
				calls.push({ cmd, env: opts?.env });
				return { exitCode: 0, stdout: "", stderr: "" };
			},
		} as unknown as Sandbox;
		const secret = "secret-that-must-not-reach-command-text";
		const env = await writeSandboxPreviewAwsCredentials(
			sandbox,
			{
				AWS_ACCESS_KEY_ID: "test-key",
				AWS_SECRET_ACCESS_KEY: secret,
				AWS_SESSION_TOKEN: "test-token",
				AWS_REGION: "us-east-2",
			},
			"tella-dev",
		);

		expect(calls).toHaveLength(1);
		expect(calls[0].cmd.join(" ")).not.toContain(secret);
		expect(calls[0].env?.AWS_SECRET_ACCESS_KEY).toBe(secret);
		expect(calls[0].env?.OPENSESSION_AWS_PROFILE).toBe("tella-dev");
		expect(env.AWS_SHARED_CREDENTIALS_FILE).toBe(
			"/tmp/opensession-preview-aws/credentials",
		);
		expect(env.AWS_CONFIG_FILE).toBe("/tmp/opensession-preview-aws/config");
	});
});
