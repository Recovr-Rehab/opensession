import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

// deliveries.ts resolves its store dir from statePath at import, so redirect
// the state dir first — the same trick slack/state.test.ts uses.
const scratch = mkdtempSync(join(tmpdir(), "opensession-gh-deliveries-"));
const previousStateDir = process.env.OPENSESSION_STATE_DIR;
process.env.OPENSESSION_STATE_DIR = scratch;

const { loadGithubDeliveries, isGithubDeliveryProcessed, markGithubDeliveryProcessed } =
  await import("./deliveries");
const { writeJsonAtomic } = await import("../../server/shared/atomic-write");
const { statePath } = await import("../../server/paths");

const STORE_DIR = statePath(".opensession-github");
const STORE = join(STORE_DIR, "deliveries.json");

afterAll(() => {
  if (previousStateDir === undefined) delete process.env.OPENSESSION_STATE_DIR;
  else process.env.OPENSESSION_STATE_DIR = previousStateDir;
  rmSync(scratch, { recursive: true, force: true });
});

describe("GitHub delivery replay protection", () => {
  test("restores accepted delivery ids after a restart (GitHub-only startup)", () => {
    const deliveryId = "github-delivery-persists";
    markGithubDeliveryProcessed(deliveryId);
    expect(isGithubDeliveryProcessed(deliveryId)).toBe(true);

    // loadGithubDeliveries clears the in-memory map first, mirroring a restart.
    // This is exactly what GithubAgent.startup calls, independent of Slack.
    loadGithubDeliveries();
    expect(isGithubDeliveryProcessed(deliveryId)).toBe(true);
  });

  test("drops expired delivery ids when restoring the persistent store", () => {
    mkdirSync(STORE_DIR, { recursive: true });
    writeJsonAtomic(STORE, [["expired-delivery", 0]], false);
    loadGithubDeliveries();
    expect(isGithubDeliveryProcessed("expired-delivery")).toBe(false);
  });

  test("checks the persisted store on first access, before any explicit restore (boot window)", () => {
    // The webhook server binds before GithubAgent.startup runs its eager load,
    // so a redelivery can land while the in-memory map is still empty. Persist
    // an id, then reset to that unloaded boot state and read WITHOUT calling
    // loadGithubDeliveries: the read path must restore lazily on first touch.
    mkdirSync(STORE_DIR, { recursive: true });
    writeJsonAtomic(STORE, [["boot-window-delivery", Date.now() + 60_000]], false);
    (globalThis as any).__githubDeliveryExpiry.clear();
    (globalThis as any).__githubDeliveriesLoaded = false;

    expect(isGithubDeliveryProcessed("boot-window-delivery")).toBe(true);
  });
});
