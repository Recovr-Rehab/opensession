import {afterEach, describe, expect, test} from "bun:test";
import {mkdtempSync, rmSync, writeFileSync} from "fs";
import {tmpdir} from "os";
import {join} from "path";
import {bootstrapRemoteSandbox, type RemoteDriver} from "./bootstrap";

const originalConfig = process.env.OPENSESSION_SANDBOX_CONFIG;
const scratch: string[] = [];

afterEach(() => {
  if (originalConfig === undefined) delete process.env.OPENSESSION_SANDBOX_CONFIG;
  else process.env.OPENSESSION_SANDBOX_CONFIG = originalConfig;
  for (const path of scratch.splice(0)) rmSync(path, {recursive: true, force: true});
});

describe("remote runner bootstrap", () => {
  test("creates the user bin directory before linking the workload identity client", async () => {
    const root = mkdtempSync(join(tmpdir(), "opensession-bootstrap-install-"));
    scratch.push(root);
    const config = join(root, "sandbox.json");
    writeFileSync(config, "{}");
    process.env.OPENSESSION_SANDBOX_CONFIG = config;

    const commands: string[] = [];
    const driver: RemoteDriver = {
      async exec(command) {
        commands.push(command);
        if (command.startsWith("cat ")) return {exitCode: 1, stdout: "", stderr: ""};
        if (command.includes("test -f /home/ubuntu/projects/opensession/package.json")) {
          return {exitCode: 0, stdout: "", stderr: ""};
        }
        return {exitCode: 0, stdout: "", stderr: ""};
      },
      async execBackground() {},
      async writeFile() {},
      async ensureStarted() {},
    };

    await bootstrapRemoteSandbox(driver, "test");

    const install = commands.find((command) => command.includes(".local/bin/opensession"));
    expect(install).toStartWith("mkdir -p /home/ubuntu/.local/bin && ");
  });
});
