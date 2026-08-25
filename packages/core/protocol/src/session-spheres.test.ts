import { describe, expect, test } from "bun:test";
import {
  SPHERE_PROVIDERS,
  isSphereProvider,
  type ExecutionTarget,
  type ProtocolClientMessage,
} from "./session";

describe("Sphere session protocol", () => {
  test("has exactly the approved providers", () => {
    expect([...SPHERE_PROVIDERS]).toEqual(["box", "daytona", "modal"]);
    expect(SPHERE_PROVIDERS.every(isSphereProvider)).toBe(true);
    expect(isSphereProvider("other")).toBe(false);
    expect(isSphereProvider("local")).toBe(false);
  });

  test("distinguishes local, Runner, and Sphere execution", () => {
    const targets: ExecutionTarget[] = [
      { kind: "local" },
      { kind: "runner", executorId: "runner-1", workspaceId: "workspace-1" },
      {
        kind: "sphere",
        provider: "daytona",
        executorId: "executor-1",
        workspaceId: "workspace-1",
        lifecycle: "awake",
      },
    ];
    expect(targets.map(({ kind }) => kind)).toEqual(["local", "runner", "sphere"]);
  });

  test("keeps this machine as the create-session omission default", () => {
    const local: ProtocolClientMessage = {
      type: "create_session",
      branch: "main",
      prompt: "Inspect this repository",
      user: "person@example.com",
    };
    const remote: ProtocolClientMessage = { ...local, sphere: "modal" };
    expect("sphere" in local).toBe(false);
    expect(remote).toMatchObject({ sphere: "modal" });
  });
});
