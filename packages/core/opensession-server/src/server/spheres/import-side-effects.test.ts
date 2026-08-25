import { expect, test } from "bun:test";
import { scanModuleSideEffects } from "../../../../../../scripts/check-module-side-effects";

const MODULES = [
  "packages/core/opensession-server/src/server/spheres/enrollment.ts",
  "packages/core/opensession-server/src/server/spheres/lifecycle.ts",
  "packages/core/opensession-server/src/server/spheres/manager.ts",
  "packages/core/opensession-server/src/server/spheres/provider.ts",
  "packages/core/opensession-server/src/server/spheres/registry.ts",
  "packages/core/opensession-server/src/server/spheres/state.ts",
];

test("Sphere lifecycle modules are import-inert", async () => {
  const scan = await scanModuleSideEffects(MODULES);
  expect(scan.failed).toEqual([]);
  expect(scan.hits).toEqual([]);
  expect(scan.scanned).toBe(MODULES.length);
});
