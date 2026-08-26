import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { handleAuthRoutes } from "./auth";
import type { RouteContext } from "./context";

const savedConfig = process.env.OPENSESSION_CONFIG;
const dirs: string[] = [];

afterEach(() => {
  if (savedConfig === undefined) delete process.env.OPENSESSION_CONFIG;
  else process.env.OPENSESSION_CONFIG = savedConfig;
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

test("auth status names the server before sign-in", async () => {
  const dir = mkdtempSync(join(tmpdir(), "opensession-auth-status-"));
  dirs.push(dir);
  const config = join(dir, "config.json");
  writeFileSync(config, JSON.stringify({ organization: { name: "Acme" } }));
  process.env.OPENSESSION_CONFIG = config;

  const url = new URL("http://localhost/api/auth/status");
  const context: RouteContext = {
    req: new Request(url),
    url,
    path: url.pathname,
    publicPrefix: "",
    authUser: null,
  };
  const response = await handleAuthRoutes(context);

  expect(response?.status).toBe(200);
  expect(await response?.json()).toMatchObject({
    authenticated: false,
    organizationName: "Acme",
  });
});
