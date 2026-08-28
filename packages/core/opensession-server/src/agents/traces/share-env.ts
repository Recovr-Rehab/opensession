import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { tracesApiBase } from "./config";

const ENV_KEEP = [
  "PATH",
  "HOME",
  "USER",
  "TMPDIR",
  "TMP",
  "TEMP",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "XDG_RUNTIME_DIR",
] as const;

/** Isolated child env: token via TRACES_CLI_AUTH_TOKEN (same precedence as --key,
 *  so a host `traces login` cannot steal authorship), never on argv. */
export function tracesShareEnv(deviceKey: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const key of ENV_KEEP) {
    const value = process.env[key];
    if (value) env[key] = value;
  }
  env.HOME = mkdtempSync(join(tmpdir(), "opensession-traces-"));
  env.TRACES_CLI_AUTH_TOKEN = deviceKey;
  env.TRACES_HTTP_URL = tracesApiBase();
  env.TRACES_API_BASE = tracesApiBase();
  return env;
}
