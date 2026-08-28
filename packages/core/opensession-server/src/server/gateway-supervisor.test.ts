import { describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  realpathSync,
  symlinkSync,
  writeFileSync,
} from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  GatewaySupervisor,
  type ManagedGateway,
  promoteGatewayCurrent,
  spawnGateway,
  validateGatewayRelease,
} from "./gateway-supervisor";

function controlledGateway(pid: number, releaseRoot: string, standby = false) {
  let finish!: (code: number) => void;
  let preload!: () => void;
  const events: string[] = [];
  const gateway: ManagedGateway = {
    pid,
    releaseRoot,
    exited: new Promise<number>((resolve) => {
      finish = resolve;
    }),
    kill(signal = 15) {
      events.push(`kill:${signal}`);
    },
    ...(standby
      ? {
          preloaded: new Promise<void>((resolve) => {
            preload = resolve;
          }),
          activate(nonce: string) {
            events.push(`activate:${nonce}`);
          },
        }
      : {}),
  };
  return { gateway, events, finish, preload };
}

describe("gateway supervisor", () => {
  test("activates a preloaded candidate only after observing the old exit", async () => {
    const old = controlledGateway(1, "/releases/old");
    const candidate = controlledGateway(2, "/releases/new", true);
    const order: string[] = [];
    const supervisor = new GatewaySupervisor(old.gateway, {
      spawn() {
        order.push("spawn-standby");
        return candidate.gateway;
      },
      async waitReady() {
        order.push("ready");
      },
      validateRelease(root) {
        return root;
      },
      promoteCurrent(root) {
        order.push(`promote:${root}`);
      },
    });

    const handoff = supervisor.handoff({
      type: "handoff",
      releaseRoot: "/releases/new",
      sha: "a".repeat(40),
    });
    await Promise.resolve();
    expect(order).toEqual(["spawn-standby"]);
    expect(old.events).toEqual([]);

    candidate.preload();
    await Bun.sleep(0);
    expect(old.events).toEqual(["kill:15"]);
    expect(candidate.events).toEqual([]);

    order.push("old-exited");
    old.finish(0);
    const result = await handoff;
    expect(result.ok).toBe(true);
    expect(candidate.events[0]?.startsWith("activate:")).toBe(true);
    expect(order).toEqual([
      "spawn-standby",
      "old-exited",
      "promote:/releases/new",
      "ready",
    ]);
    expect(supervisor.activeGateway()).toBe(candidate.gateway);
  });

  test("restores pointer and previous release when an activated candidate fails", async () => {
    const old = controlledGateway(1, "/releases/old");
    const candidate = controlledGateway(2, "/releases/new", true);
    const rollback = controlledGateway(3, "/releases/old");
    candidate.gateway.kill = (signal = 15) => {
      candidate.events.push(`kill:${signal}`);
      candidate.finish(1);
    };
    const promotions: string[] = [];
    const supervisor = new GatewaySupervisor(old.gateway, {
      spawn(_root, role) {
        return role === "standby" ? candidate.gateway : rollback.gateway;
      },
      async waitReady(gateway) {
        if (gateway === candidate.gateway) throw new Error("candidate boot failed");
      },
      validateRelease: (root) => root,
      promoteCurrent(root) {
        promotions.push(root);
      },
    });
    const handoff = supervisor.handoff({
      type: "handoff",
      releaseRoot: "/releases/new",
      sha: "d".repeat(40),
    });
    candidate.preload();
    await Bun.sleep(0);
    old.finish(0);
    const result = await handoff;
    expect(result.ok).toBe(false);
    expect(result.message).toContain("previous gateway restored");
    expect(promotions).toEqual(["/releases/new", "/releases/old"]);
    expect(supervisor.activeGateway()).toBe(rollback.gateway);
  });

  test("keeps the old gateway active when candidate preload fails", async () => {
    const old = controlledGateway(1, "/releases/old");
    let fail!: (error: Error) => void;
    const candidate = controlledGateway(2, "/releases/new", true);
    candidate.gateway.preloaded = new Promise<void>((_, reject) => {
      fail = reject;
    });
    candidate.gateway.exited = Promise.resolve(1);
    const supervisor = new GatewaySupervisor(old.gateway, {
      spawn: () => candidate.gateway,
      waitReady: async () => {},
      validateRelease: (root) => root,
      promoteCurrent() {},
    });
    const handoff = supervisor.handoff({
      type: "handoff",
      releaseRoot: "/releases/new",
      sha: "b".repeat(40),
    });
    fail(new Error("bad import"));
    const result = await handoff;
    expect(result.ok).toBe(false);
    expect(result.message).toContain("before cut-over");
    expect(old.events).toEqual([]);
    expect(supervisor.activeGateway()).toBe(old.gateway);
  });

  test("a real standby process cannot produce effects before IPC activation", async () => {
    const root = mkdtempSync(join(tmpdir(), "gateway-standby-"));
    const marker = join(root, "effect.txt");
    const activationModule = join(import.meta.dir, "gateway-activation.ts");
    const entry = join(root, "candidate.ts");
    writeFileSync(entry, [
      `import { waitForGatewayActivationIfStandby } from ${JSON.stringify(activationModule)};`,
      `import { writeFileSync } from "fs";`,
      `await waitForGatewayActivationIfStandby();`,
      `writeFileSync(${JSON.stringify(marker)}, "activated\\n");`,
      `await new Promise(() => {});`,
    ].join("\n"));

    const candidate = spawnGateway(root, "standby", "integration-nonce", entry);
    await candidate.preloaded!;
    expect(existsSync(marker)).toBe(false);
    candidate.activate!("integration-nonce");
    for (let attempt = 0; attempt < 50 && !existsSync(marker); attempt += 1) {
      await Bun.sleep(10);
    }
    expect(existsSync(marker)).toBe(true);
    candidate.kill(9);
    await candidate.exited;
  });

  test("atomically promotes the runtime pointer inside the handoff transaction", () => {
    const state = mkdtempSync(join(tmpdir(), "gateway-pointer-"));
    const old = join(state, "old");
    const next = join(state, "next");
    mkdirSync(old);
    mkdirSync(next);
    symlinkSync(old, join(state, "current"));
    promoteGatewayCurrent(next, state);
    expect(realpathSync(join(state, "current"))).toBe(realpathSync(next));
  });

  test("validates immutable release ancestry and prepared frontend", () => {
    const root = mkdtempSync(join(tmpdir(), "gateway-release-"));
    const releases = join(root, "releases");
    const sha = "c".repeat(40);
    const release = join(releases, sha);
    mkdirSync(join(release, ".frontend-dist"), { recursive: true });
    writeFileSync(join(release, ".opensession-release"), `${sha}\n`);
    writeFileSync(join(release, ".frontend-dist", ".bundle-meta.json"), "{}\n");
    expect(validateGatewayRelease(release, sha, releases)).toBe(realpathSync(release));
    expect(() => validateGatewayRelease(root, sha, releases)).toThrow("outside");
    expect(() => validateGatewayRelease(release, "bad", releases)).toThrow("invalid release sha");
  });
});
