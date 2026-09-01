import { describe, expect, test } from "bun:test";
import {
  BOX_RUNTIME_HOME_COMMAND,
  boxCommandPlaneUnavailable,
  boxComposeShell,
  boxKnownHostsKey,
  boxMachineIpSshEndpoint,
  boxMachineType,
  boxNativeFilePath,
  boxResumePrimeCommand,
  boxRuntimeHomeFailure,
  boxSnapshotSaveIsRecoverable,
  boxSshLaneSettles,
  boxSshTransportFailed,
  reusedBoxLaneOutcome,
  parseBoxSshEndpoint,
} from "./box";

describe("Box machine profiles", () => {
  test("maps the three provider-supported resource combinations", () => {
    expect(boxMachineType({ cpu: 2, memoryMb: 4_096, diskGb: 40 })).toBe(
      "small",
    );
    expect(boxMachineType({ cpu: 4, memoryMb: 8_192, diskGb: 80 })).toBe(
      "default",
    );
    expect(boxMachineType({ cpu: 8, memoryMb: 16_384, diskGb: 100 })).toBe(
      "large",
    );
  });

  test("uses default when no project profile exists and rejects arbitrary combinations", () => {
    expect(boxMachineType()).toBe("default");
    expect(() =>
      boxMachineType({ cpu: 4, memoryMb: 4_096, diskGb: 80 }),
    ).toThrow("Choose one of Box's Small, Default, or Large machine sizes");
  });
});

describe("Box named snapshots", () => {
  test("recovers only recent in-flight saves", () => {
    const now = Date.parse("2026-08-21T10:00:00.000Z");
    expect(
      boxSnapshotSaveIsRecoverable(
        { status: "saving", createdAt: "2026-08-21T09:45:00.000Z" },
        now,
      ),
    ).toBe(true);
    expect(
      boxSnapshotSaveIsRecoverable(
        { status: "saving", createdAt: "2026-08-21T08:00:00.000Z" },
        now,
      ),
    ).toBe(false);
    expect(
      boxSnapshotSaveIsRecoverable(
        { status: "ready", createdAt: "2026-08-21T09:55:00.000Z" },
        now,
      ),
    ).toBe(false);
  });
});

describe("Box persistent file paths", () => {
  test("bind-mounts the durable home without changing its canonical spelling", () => {
    expect(BOX_RUNTIME_HOME_COMMAND).toContain(
      "mount --bind /home/user /home/ubuntu",
    );
    expect(BOX_RUNTIME_HOME_COMMAND).toContain("test ! -L /home/ubuntu");
    expect(BOX_RUNTIME_HOME_COMMAND).toContain("umount /home/ubuntu");
    expect(BOX_RUNTIME_HOME_COMMAND).not.toContain("ln -s");
  });

  test("maps the cross-provider home to Box's native durable home", () => {
    expect(boxNativeFilePath("/home/ubuntu")).toBe("/home/user");
    expect(boxNativeFilePath("/home/ubuntu/.opensession/spec.json")).toBe(
      "/home/user/.opensession/spec.json",
    );
    expect(boxNativeFilePath("/tmp/output")).toBe("/tmp/output");
  });
});

describe("Box SSH control lane", () => {
  test("prefers the provider's reachable host and port over an IPv6 machine address", () => {
    expect(parseBoxSshEndpoint("137.74.205.128:19042")).toEqual({
      host: "137.74.205.128",
      port: 19042,
    });
    expect(parseBoxSshEndpoint("[2001:db8::2]:2200")).toEqual({
      host: "2001:db8::2",
      port: 2200,
    });
    expect(parseBoxSshEndpoint("2001:db8::2")).toBeNull();
  });
});

describe("Box SSH host identity", () => {
  test("scopes a resumed VM host-key rotation to the exact provider endpoint", () => {
    expect(boxKnownHostsKey({ host: "5.135.138.52", port: 19042 })).toBe(
      "[5.135.138.52]:19042",
    );
    expect(boxKnownHostsKey({ host: "162.55.60.74", port: 22 })).toBe(
      "162.55.60.74",
    );
    expect(boxMachineIpSshEndpoint("162.55.60.74")).toEqual({
      host: "162.55.60.74",
      port: 22,
    });
    expect(boxMachineIpSshEndpoint("2001:db8::1")).toBeNull();
  });
});

describe("Box command readiness", () => {
  test("hydrates a resumed workspace without taking Git locks", () => {
    expect(boxResumePrimeCommand("/home/ubuntu/worktrees/app")).toContain(
      "xargs -0 -r -n 64 -P 16 stat",
    );
    expect(boxResumePrimeCommand("/home/ubuntu/worktrees/app")).toContain(
      "GIT_OPTIONAL_LOCKS=0 git status --porcelain",
    );
    expect(boxResumePrimeCommand("/home/ubuntu/worktrees/app")).toContain(
      "test -d /home/ubuntu/worktrees/app/.git",
    );
  });

  test("keeps command temporary files inside the bind-mounted home", () => {
    expect(boxComposeShell("printf ok")).toStartWith(
      "mkdir -p /home/ubuntu/.tmp && export TMPDIR=/home/ubuntu/.tmp && ",
    );
  });

  test("only retries explicit no-command 409 states", () => {
    expect(
      boxCommandPlaneUnavailable({ status: 409, code: "machine_not_running" }),
    ).toBe(true);
    expect(
      boxCommandPlaneUnavailable({ status: 409, code: "box_starting" }),
    ).toBe(true);
    expect(
      boxCommandPlaneUnavailable({ status: 502, code: "box_direct_failed" }),
    ).toBe(false);
    expect(boxCommandPlaneUnavailable({ status: 409, code: "other" })).toBe(
      false,
    );
  });
});

describe("Box SSH lane adoption", () => {
  test("adopts a lane that settles after the first-connection race", async () => {
    // A snapshot-restored box answers on 22 before sshd hands out a session:
    // attempt one dies with ssh's own 255, the next one carries the command.
    const codes = [255, 0];
    let calls = 0;
    const settled = await boxSshLaneSettles(
      async () => {
        calls += 1;
        return { exitCode: codes.shift() ?? 0 };
      },
      3,
      0,
    );
    expect(settled).toBe(true);
    expect(calls).toBe(2);
  });

  test("gives up on a lane that never carries a command", async () => {
    let calls = 0;
    const settled = await boxSshLaneSettles(
      async () => {
        calls += 1;
        return { exitCode: 255 };
      },
      3,
      0,
    );
    expect(settled).toBe(false);
    expect(calls).toBe(3);
  });
});

describe("Box runtime home failures", () => {
  test("names the transport when ssh, not the filesystem, is what failed", () => {
    expect(boxSshTransportFailed(255)).toBe(true);
    expect(boxSshTransportFailed(124)).toBe(true);
    expect(boxSshTransportFailed(1)).toBe(false);
    expect(
      boxRuntimeHomeFailure({
        exitCode: 255,
        stdout: "",
        stderr:
          "mux_client_request_session: read from master failed: Broken pipe\nFailed to connect to new control master",
      }),
    ).toBe(
      "Box runtime home check could not reach the sandbox (exit 255): " +
        "mux_client_request_session: read from master failed: Broken pipe " +
        "Failed to connect to new control master",
    );
  });

  test("still reports a genuine home-layout failure as one", () => {
    expect(boxRuntimeHomeFailure({ exitCode: 1, stdout: "", stderr: "" })).toBe(
      "Box did not preserve /home/ubuntu as the durable canonical home",
    );
  });
});

describe("Box reused SSH lane", () => {
  test("degrades to the command plane when the lane drops, and only fails on a real verdict", () => {
    expect(reusedBoxLaneOutcome(0)).toBe("ok");
    // ssh's own code and the adapter's timeout say the connection went, not
    // that /home/ubuntu is wrong - failing a session start over either is what
    // sent the original investigation at the filesystem.
    expect(reusedBoxLaneOutcome(255)).toBe("degrade");
    expect(reusedBoxLaneOutcome(124)).toBe("degrade");
    // A real non-zero from the check itself IS a verdict about the home path.
    expect(reusedBoxLaneOutcome(1)).toBe("fail");
  });
});
