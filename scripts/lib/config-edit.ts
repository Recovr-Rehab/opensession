/**
 * Surgical edits to an existing `~/.opensession/config.json` — the counterpart
 * to onboard's full rewrite, shared by the commands that change one thing
 * (`bind`, `team`, `repos`). Every write goes through a `.bak-<n>` backup and
 * keeps 0600: the config carries the team identity table, not just ports.
 */

import { chmodSync, copyFileSync, existsSync } from "fs";
import { CONFIG_PATH } from "./paths";

/** Back up rather than clobber, so a re-run can never lose a working config. */
export function backup(path: string): string | undefined {
  if (!existsSync(path)) return undefined;
  let n = 1;
  while (existsSync(`${path}.bak-${n}`)) n++;
  const dest = `${path}.bak-${n}`;
  copyFileSync(path, dest);
  return dest;
}

/**
 * This box's tailnet address, if it is on one.
 *
 * Worth asking Tailscale rather than inferring from the interface list: it is
 * the only thing that knows whether the daemon is actually up and logged in,
 * and a stale 100.x address on a logged-out box is a bind that never works.
 */
export function tailnetIp(): string | undefined {
  try {
    const proc = Bun.spawnSync(["tailscale", "ip", "-4"]);
    if (proc.exitCode !== 0) return undefined;
    return proc.stdout.toString().trim().split("\n")[0]?.trim() || undefined;
  } catch {
    return undefined;
  }
}

export async function readConfig(): Promise<Record<string, any> | undefined> {
  if (!existsSync(CONFIG_PATH)) return undefined;
  return JSON.parse(await Bun.file(CONFIG_PATH).text());
}

/** Write config.json (backed up, 0600); returns the backup path if one was made. */
export async function writeConfig(config: Record<string, unknown>): Promise<string | undefined> {
  const backedUp = backup(CONFIG_PATH);
  await Bun.write(CONFIG_PATH, JSON.stringify(config, null, 2) + "\n");
  chmodSync(CONFIG_PATH, 0o600);
  return backedUp;
}
