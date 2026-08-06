import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// State-namespace isolation MUST happen before the first src/server import
// (paths.ts and friends resolve at module load), so engine-status is pulled in
// dynamically below rather than with a static import. Without this the test
// would read the live instance's default model and account pools and assert
// against whatever this box happens to be running.
const SCRATCH = mkdtempSync(join(tmpdir(), "engine-status-"));
const ENGINE_CONFIG = join(SCRATCH, "opencode.json");
process.env.OPENSESSION_STATE_DIR = SCRATCH;
process.env.OPENSESSION_CHATS_DIR = SCRATCH;
process.env.OPENSESSION_OPENCODE_CONFIG = ENGINE_CONFIG;
process.env.OPENSESSION_CLAUDE_ACCOUNTS_PATH = join(SCRATCH, "claude-accounts.json");

const { engineStatus } = await import("./engine-status");
const { __setCodexAccountsPathForTest } = await import("./codex-accounts");
__setCodexAccountsPathForTest(join(SCRATCH, "codex-accounts.json"));

/** Re-point the engine config at `cfg` (null = the file doesn't exist, which
 *  is the fresh-install state) and read the status. Both are read per call. */
function statusWith(cfg: object | null) {
  if (cfg) writeFileSync(ENGINE_CONFIG, JSON.stringify(cfg));
  else rmSync(ENGINE_CONFIG, { force: true });
  return engineStatus();
}

describe("engineStatus", () => {
  test("a fresh install (no engine config) is not ready, and is one click from fixed", () => {
    const s = statusWith(null);
    expect(s.ready).toBe(false);
    expect(s.bridgeEnabled).toBe(false);
    // The blocker must be the switch, not the empty account pool: enabling is a
    // button, and an operator who adds accounts first still can't run a turn.
    expect(s.blocker).toMatch(/switched off/i);
    expect(s.fixableInApp).toBe(true);
  });

  test("enabled with an empty pool blames the pool, and is not a button", () => {
    const s = statusWith({ enabled: true });
    expect(s.ready).toBe(false);
    expect(s.bridgeEnabled).toBe(true);
    expect(s.blocker).toMatch(/account/i);
    expect(s.fixableInApp).toBe(false);
  });

  test("`enabled: false` is respected, not treated as absent", () => {
    expect(statusWith({ enabled: false }).bridgeEnabled).toBe(false);
  });

  test("every not-ready status carries both a blocker and a fix", () => {
    for (const cfg of [null, { enabled: true }, { enabled: false }]) {
      const s = statusWith(cfg);
      if (s.ready) continue;
      expect(s.blocker?.length).toBeGreaterThan(0);
      expect(s.fix?.length).toBeGreaterThan(0);
    }
  });
});
