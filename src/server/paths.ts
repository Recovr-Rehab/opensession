/**
 * Shared on-disk paths for the chat store, with a dual-read fallback chain.
 *
 * Naming history: `~/.backstage-sessions` → `~/.backstage-chats` (see
 * scripts/migrate-workspaces.ts) → `~/.opensession-chats` (the product rename,
 * docs/rename-opensession-plan.md + scripts/migrate-opensession-state.sh).
 * This resolves the active dir once at load: prefer the newest name that
 * exists, fall back through the older ones until the migrations rename them.
 * Resolving once keeps every module (and reads/writes) on the same dir
 * whether or not a migration has run. The `bks-` id prefix stays opaque.
 *
 * Run migrations during a restart window (they rename dirs on disk); a
 * long-running process resolves this constant at boot and won't see a
 * mid-flight rename.
 */

import { homedir } from "os";
import { isLocalProfile, localProfileRoot } from "./profile";

/** The current user's home directory ($HOME wins so tests can repoint it). */
export function homeDir(): string {
  return process.env.HOME || homedir();
}

/**
 * Resolve a state path relative to the state root. A non-empty
 * OPENSESSION_STATE_DIR is an isolated namespace (dev/demo instances,
 * src/server/dev-mode.ts) — every state name resolves strictly under it, so
 * a second instance can never read or write the live instance's home-dir
 * state. Unset ⇒ $HOME. Read at call time so tests can repoint either env.
 */
export function statePath(rel: string): string {
  const root = process.env.OPENSESSION_STATE_DIR || process.env.HOME || homedir();
  return `${root}/${rel}`;
}

/** Sugar for the standard state-dir naming: `stateDir("audit")` →
 *  `~/.opensession-audit`. Works for files too (`stateDir("pins.json")`). */
export function stateDir(base: string): string {
  return statePath(`.opensession-${base}`);
}

function resolveChatsDir(): string {
  // Env override first (test/verify/conformance suites point it at a scratch
  // dir so sbxtest state files, run dirs and kill-switch checks never touch
  // the live store — set it BEFORE importing any src/server module).
  const fromEnv = process.env.OPENSESSION_CHATS_DIR;
  if (fromEnv) return fromEnv;
  // Isolated state namespace (dev/demo instances — see rename-compat
  // statePath): everything lives under OPENSESSION_STATE_DIR, fresh, with no
  // legacy fallbacks. The run-rpc unix socket derives from this dir, so the
  // isolation also keeps a second instance off the live instance's socket.
  const stateRoot = process.env.OPENSESSION_STATE_DIR;
  if (stateRoot) return `${stateRoot}/.opensession-chats`;
  if (isLocalProfile()) return `${localProfileRoot()}/sessions`;
  return stateDir("chats");
}

/** The active chat-store dir. */
export let OPENSESSION_CHATS_DIR = resolveChatsDir();

/**
 * Test seam (bun tests only): repoint the chat store AFTER this module has
 * been evaluated. ES module bindings are live, so consumers that read
 * `OPENSESSION_CHATS_DIR` at THEIR load time (e.g. sessions.ts, which the tests
 * re-import cache-busted) pick the new value up — the env override above only
 * works when it's set before the first import of this module, which a bun
 * test file can't guarantee (file execution order is not alphabetical, and
 * any earlier test file importing the server graph evaluates this module).
 * Returns the previous value so afterAll can restore it.
 */
export function __setChatsDirForTest(dir: string): string {
  const prev = OPENSESSION_CHATS_DIR;
  OPENSESSION_CHATS_DIR = dir;
  return prev;
}
