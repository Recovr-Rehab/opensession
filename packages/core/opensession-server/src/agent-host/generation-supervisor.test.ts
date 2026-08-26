import { describe, expect, test } from "bun:test";
import {
  AgentHostGenerationSupervisor,
  type AgentHostAdmissionStorage,
  type AgentHostGenerationIdentity,
  type AgentHostGenerationManifest,
  type AgentHostSystemdController,
  type PersistedAdmission,
} from "./generation-supervisor";

const digest = (character: string) => character.repeat(64);

class Clock {
  constructor(public value = 1_000) {}
  nowMs() {
    return this.value;
  }
}

class Storage implements AgentHostAdmissionStorage {
  value: unknown = { version: 1, revision: 0, active: null };
  async read() {
    return structuredClone(this.value);
  }
  async compareAndSwap(expectedRevision: number, next: PersistedAdmission) {
    const current = this.value as PersistedAdmission;
    if (current.revision !== expectedRevision) return false;
    this.value = structuredClone(next);
    return true;
  }
}

class Controller implements AgentHostSystemdController {
  starts: AgentHostGenerationManifest[] = [];
  stops: AgentHostGenerationIdentity[] = [];
  async startGeneration(manifest: AgentHostGenerationManifest) {
    this.starts.push(manifest);
  }
  async stopGeneration(identity: AgentHostGenerationIdentity) {
    this.stops.push(identity);
  }
}

function manifest(
  generation: number,
  overrides: Partial<AgentHostGenerationManifest> = {},
): AgentHostGenerationManifest {
  return {
    hostId: "agent-host",
    generation,
    incarnation: `incarnation-${generation}`,
    releaseDigest: digest(String(generation % 10)),
    protocolDigest: digest("a"),
    keyringDigest: digest("b"),
    recoveryLedgerId: `ledger-${generation}`,
    bornAtMs: 1_000,
    deadlineMs: 10_000,
    ...overrides,
  };
}

async function ready(
  supervisor: AgentHostGenerationSupervisor,
  value: AgentHostGenerationManifest,
) {
  await supervisor.stage(value);
  supervisor.markEligible(value);
}

describe("AgentHostGenerationSupervisor", () => {
  test("is import-inert and validates immutable identity, digests, and <=24h deadline", async () => {
    const clock = new Clock();
    const storage = new Storage();
    const controller = new Controller();
    const supervisor = new AgentHostGenerationSupervisor(
      clock,
      storage,
      controller,
    );
    expect(controller.starts).toEqual([]);
    expect(await storage.read()).toEqual({
      version: 1,
      revision: 0,
      active: null,
    });

    await expect(
      supervisor.stage(manifest(1, { releaseDigest: "bad" })),
    ).rejects.toThrow("Invalid Agent Host generation manifest");
    await expect(
      supervisor.stage(
        manifest(1, { deadlineMs: 1_000 + 24 * 60 * 60 * 1_000 + 1 }),
      ),
    ).rejects.toThrow("Invalid Agent Host generation manifest");

    const source = manifest(1);
    await supervisor.stage(source);
    (source as { incarnation: string }).incarnation = "mutated";
    expect(supervisor.snapshot({ ...manifest(1) })?.incarnation).toBe(
      "incarnation-1",
    );
    await expect(
      supervisor.stage(manifest(1, { incarnation: "another-incarnation" })),
    ).rejects.toThrow("incarnation conflict");
    await expect(
      supervisor.stage(manifest(2, { recoveryLedgerId: "ledger-1" })),
    ).rejects.toThrow("already has a writer");
  });

  test("atomically promotes one active generation and pins existing turns while blue drains", async () => {
    const supervisor = new AgentHostGenerationSupervisor(
      new Clock(),
      new Storage(),
      new Controller(),
    );
    const blue = manifest(1);
    const green = manifest(2);
    await ready(supervisor, blue);
    await ready(supervisor, green);
    await supervisor.recoverAdmission();

    expect((await supervisor.promote(blue)).state).toBe("active");
    expect(supervisor.admitNewTurn("turn-blue").generation).toBe(1);
    expect((await supervisor.promote(green)).state).toBe("active");
    expect(supervisor.snapshot(blue)?.state).toBe("draining");
    expect(supervisor.admitNewTurn("turn-green").generation).toBe(2);
    expect(supervisor.targetForExistingTurn("turn-blue", blue).generation).toBe(
      1,
    );
    expect(() => supervisor.targetForExistingTurn("turn-blue", green)).toThrow(
      "Stale",
    );
    expect(
      supervisor
        .deletionBroadcastTargets()
        .map((entry) => entry.recoveryLedgerId),
    ).toEqual(["ledger-1", "ledger-2"]);
  });

  test("fences stale incarnations and expired generations", async () => {
    const clock = new Clock();
    const supervisor = new AgentHostGenerationSupervisor(
      clock,
      new Storage(),
      new Controller(),
    );
    const blue = manifest(1, { deadlineMs: 1_100 });
    await ready(supervisor, blue);
    await supervisor.recoverAdmission();
    await supervisor.promote(blue);
    supervisor.admitNewTurn("turn");

    expect(() =>
      supervisor.targetForExistingTurn("turn", {
        ...blue,
        incarnation: "stale-incarnation",
      }),
    ).toThrow("Stale");
    clock.value = 1_100;
    expect(() => supervisor.admitNewTurn("later")).toThrow(
      "admission is closed",
    );
    expect(() => supervisor.targetForExistingTurn("turn", blue)).toThrow(
      "Expired",
    );
    expect(supervisor.snapshot(blue)?.state).toBe("expired");
    expect(supervisor.deletionBroadcastTargets()).toEqual([]);
  });

  test("allows rollback only to a healthy compatible draining generation under deadline", async () => {
    const clock = new Clock();
    const supervisor = new AgentHostGenerationSupervisor(
      clock,
      new Storage(),
      new Controller(),
    );
    const blue = manifest(1);
    const green = manifest(2);
    const incompatible = manifest(3, { protocolDigest: digest("c") });
    await ready(supervisor, blue);
    await ready(supervisor, green);
    await ready(supervisor, incompatible);
    await supervisor.recoverAdmission();
    await supervisor.promote(blue);
    await supervisor.promote(green);
    expect((await supervisor.promote(blue, { rollback: true })).state).toBe(
      "active",
    );
    await supervisor.promote(incompatible);
    await expect(supervisor.promote(blue, { rollback: true })).rejects.toThrow(
      "Incompatible",
    );
    clock.value = blue.deadlineMs;
    await expect(supervisor.promote(blue, { rollback: true })).rejects.toThrow(
      "Expired",
    );
  });

  test("recovers exact persisted admission and fails closed on corrupt, missing, or stale state", async () => {
    const storage = new Storage();
    const controller = new Controller();
    const clock = new Clock();
    const first = new AgentHostGenerationSupervisor(clock, storage, controller);
    const blue = manifest(1);
    await ready(first, blue);
    await first.recoverAdmission();
    await first.promote(blue);

    const restarted = new AgentHostGenerationSupervisor(
      clock,
      storage,
      controller,
    );
    await ready(restarted, blue);
    expect((await restarted.recoverAdmission())?.incarnation).toBe(
      blue.incarnation,
    );
    expect(restarted.admitNewTurn("after-restart").generation).toBe(1);

    const changedRelease = new AgentHostGenerationSupervisor(
      clock,
      storage,
      controller,
    );
    await ready(changedRelease, manifest(1, { releaseDigest: digest("d") }));
    await expect(changedRelease.recoverAdmission()).rejects.toThrow(
      "unavailable",
    );

    const stale = new AgentHostGenerationSupervisor(clock, storage, controller);
    await ready(stale, manifest(1, { incarnation: "replacement-incarnation" }));
    await expect(stale.recoverAdmission()).rejects.toThrow("unavailable");
    expect(() => stale.admitNewTurn("closed")).toThrow("admission is closed");

    storage.value = {
      version: 1,
      revision: 2,
      active: { hostId: "agent-host" },
    };
    const corrupt = new AgentHostGenerationSupervisor(
      clock,
      storage,
      controller,
    );
    await ready(corrupt, blue);
    await expect(corrupt.recoverAdmission()).rejects.toThrow(
      "Invalid persisted",
    );
    expect(() => corrupt.admitNewTurn("still-closed")).toThrow(
      "admission is closed",
    );
  });

  test("storage CAS chooses one winner when supervisors race promotion", async () => {
    const storage = new Storage();
    const clock = new Clock();
    const left = new AgentHostGenerationSupervisor(
      clock,
      storage,
      new Controller(),
    );
    const right = new AgentHostGenerationSupervisor(
      clock,
      storage,
      new Controller(),
    );
    const blue = manifest(1);
    const green = manifest(2);
    await ready(left, blue);
    await ready(right, green);
    await Promise.all([left.recoverAdmission(), right.recoverAdmission()]);

    const results = await Promise.allSettled([
      left.promote(blue),
      right.promote(green),
    ]);
    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    expect(
      results.filter((result) => result.status === "rejected"),
    ).toHaveLength(1);
    expect((storage.value as PersistedAdmission).revision).toBe(1);
    expect([1, 2]).toContain(
      (storage.value as PersistedAdmission).active!.generation,
    );
  });

  test("retirement invokes only the injected controller and preserves pinned ledger ownership", async () => {
    const controller = new Controller();
    const supervisor = new AgentHostGenerationSupervisor(
      new Clock(),
      new Storage(),
      controller,
    );
    const blue = manifest(1);
    const green = manifest(2);
    await ready(supervisor, blue);
    await ready(supervisor, green);
    await supervisor.recoverAdmission();
    await supervisor.promote(blue);
    supervisor.admitNewTurn("owned");
    await supervisor.promote(green);
    await expect(supervisor.retire(blue)).rejects.toThrow("owned");
    expect(supervisor.releaseTurn("owned", blue)).toBe(true);
    await supervisor.retire(blue);
    expect(controller.stops).toEqual([blue]);
  });
});
