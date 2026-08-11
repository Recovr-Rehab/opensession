import { describe, expect, test } from "bun:test";
import { portalRouteAuthorized, previewServerConfig } from "./preview";

describe("permission-coupled preview portals", () => {
	test("fails closed when Caddy retained a route the restarted server has not rediscovered", () => {
		expect(portalRouteAuthorized(29999)).toBe(false);
	});
	test("authenticates before proxying to the service", () => {
		const config = previewServerConfig(
			22001,
			"10.200.64.2:3300",
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
		expect(handles[1].upstreams).toEqual([{ dial: "10.200.64.2:3300" }]);
	});

	test("wraps provider-hosted HTTPS services in the same authenticated portal", () => {
		const config = previewServerConfig(
			22002,
			"https://sandbox-provider.example:443",
			"preview.example.test",
		) as any;
		const proxy = config.routes[0].handle[0].routes[0].handle[1];
		expect(proxy.upstreams).toEqual([
			{ dial: "sandbox-provider.example:443" },
		]);
		expect(proxy.transport).toEqual({ protocol: "http", tls: {} });
		expect(proxy.headers.request.set.Host).toEqual([
			"sandbox-provider.example",
		]);
	});

	test("keeps private-provider preview credentials server-side", () => {
		const config = previewServerConfig(
			22003,
			"https://sandbox-provider.example",
			"preview.example.test",
			{
				"X-Daytona-Preview-Token": "private-token",
				"X-Daytona-Skip-Preview-Warning": "true",
			},
		) as any;
		const proxy = config.routes[0].handle[0].routes[0].handle[1];
		expect(proxy.headers.request.set).toEqual({
			"X-Daytona-Preview-Token": ["private-token"],
			"X-Daytona-Skip-Preview-Warning": ["true"],
			Host: ["sandbox-provider.example"],
		});
	});

	test("keeps provider query credentials in the server-side proxy route", () => {
		const config = previewServerConfig(
			22004,
			"https://box-preview.on.ascii.dev?_token=private-token",
			"preview.example.test",
		) as any;
		const proxy = config.routes[0].handle[0].routes[0].handle[1];
		expect(proxy.upstreams).toEqual([{ dial: "box-preview.on.ascii.dev:443" }]);
		expect(proxy.rewrite).toEqual({
			uri: "?{http.request.uri.query}&_token=private-token",
		});
	});
});
