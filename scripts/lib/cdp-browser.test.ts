import { describe, expect, test } from "bun:test";
import { boundedCdpSystemdArgs } from "./cdp-browser";

describe("bounded CDP browser", () => {
	test("caps memory, swap, tasks, CPU, and lifetime for the whole browser cgroup", () => {
		expect(boundedCdpSystemdArgs()).toEqual([
			"--property=MemoryHigh=2G",
			"--property=MemoryMax=4G",
			"--property=MemorySwapMax=512M",
			"--property=TasksMax=256",
			"--property=CPUQuota=300%",
			"--property=RuntimeMaxSec=2h",
			"--property=OOMPolicy=stop",
			"--property=KillMode=control-group",
		]);
	});
});
