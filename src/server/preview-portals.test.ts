import { describe, expect, test } from "bun:test";
import { previewServerConfig } from "./preview";

describe("permission-coupled preview portals", () => {
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
});
