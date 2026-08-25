import { describe, expect, test } from "bun:test";
import {
	configuredAppDomain,
	configuredIngressDrafts,
	customCaddyConfig,
	customDnsRecords,
	ingressHostname,
	privateAppCaddyConfig,
	privateAppDnsRecord,
} from "./ingress-ui";
import type { PublicIngressSettings } from "./api/ingress";

const settings = {
	publicBaseUrl: "https://old.example.test",
	exposure: "custom",
	app: {
		publicBaseUrl: "https://os.example.test",
		hostname: "os.example.test",
		tailnetIpv4: "100.64.0.10",
	},
	server: { ipv4: ["203.0.113.10"], ipv6: ["2001:db8::10"] },
	tailscale: { suggestedUrl: "https://server.example.ts.net" },
} as PublicIngressSettings;

describe("public ingress form", () => {
	test("keeps one draft per exposure method", () => {
		expect(configuredIngressDrafts(settings)).toEqual({
			tailscale: "https://server.example.ts.net",
			cloudflare: "",
			custom: "old.example.test",
		});
	});

	test("builds private app DNS and Caddy instructions on the tailnet", () => {
		expect(configuredAppDomain(settings)).toBe("os.example.test");
		expect(privateAppDnsRecord(settings, "team.example.test")).toBe(
			"A team.example.test 100.64.0.10",
		);
		const caddy = privateAppCaddyConfig(settings, "team.example.test");
		expect(caddy).toContain("team.example.test {");
		expect(caddy).toContain("bind 100.64.0.10");
		expect(caddy).toContain("reverse_proxy 127.0.0.1:3850");
	});

	test("accepts a bare custom domain for public DNS and Caddy instructions", () => {
		expect(ingressHostname("new.example.test")).toBe("new.example.test");
		expect(customDnsRecords(settings, "new.example.test")).toEqual([
			"A new.example.test 203.0.113.10",
			"AAAA new.example.test 2001:db8::10",
		]);
		expect(customCaddyConfig("new.example.test")).toContain("new.example.test {");
	});
});
