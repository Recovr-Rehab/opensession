import { describe, expect, test } from "bun:test";
import { classifyRuntimeImpact } from "./release-impact";

const gatewayPath = "packages/core/opensession-server/src/server/routes/system.ts";
const sharedPath = "packages/core/opensession-server/src/server/runtime-generation.ts";

function closures() {
  return {
    gateway: new Set([gatewayPath, sharedPath]),
    kernel: new Set([sharedPath]),
    executor: new Set([sharedPath]),
  };
}

describe("generated release impact", () => {
  test("uses a warm gateway handoff only for gateway-exclusive imports", () => {
    expect(classifyRuntimeImpact([gatewayPath], closures())).toBe("gateway-handoff");
  });

  test("restarts the stable supervisor when its own runtime changes", () => {
    const supervisor = "packages/core/opensession-server/src/server/gateway-supervisor.ts";
    const graph = closures();
    graph.gateway.add(supervisor);
    expect(classifyRuntimeImpact([supervisor], graph)).toBe("supervisor-restart");
    expect(classifyRuntimeImpact([supervisor, sharedPath], graph)).toBe(
      "coordinated-supervisor-restart",
    );
  });

  test("coordinates shared, protocol, dependency, and unknown runtime changes", () => {
    for (const path of [sharedPath, "packages/core/protocol/src/session.ts", "bun.lock", "unknown.ts"]) {
      expect(classifyRuntimeImpact([path], closures())).toBe("coordinated");
    }
  });
});
