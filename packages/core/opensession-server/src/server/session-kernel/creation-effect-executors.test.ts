import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { createWorkspace, getWorkspace } from "../workspaces";
import {
  CreationEffectIndeterminateError,
  executeCreationWorkspacePrepare,
  type CreationWorkspaceEffectItem,
} from "./creation-effect-executors";

const roots: string[] = [];
const previousStateDir = process.env.OPENSESSION_STATE_DIR;

afterEach(() => {
  if (previousStateDir === undefined) delete process.env.OPENSESSION_STATE_DIR;
  else process.env.OPENSESSION_STATE_DIR = previousStateDir;
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

function item(): CreationWorkspaceEffectItem {
  return {
    id: 1,
    effectId: "session:creation_workspace_prepare:workspace-effect",
    effectKey: "workspace-effect",
    sessionId: "session-one",
    kind: "creation_workspace_prepare",
    payload: {
      creationIdentity: "create-one",
      creationGeneration: 1,
      workspaceId: "ws-create-one",
      dedupeKey: "session-create:create-one",
      name: "Workspace one",
      createdBy: "Alice",
      project: "opensession",
      branch: "feature/create-one",
      mode: "adopt_or_create",
    },
    attempts: 0,
    nextAttemptAt: 0,
    createdAt: 1,
  };
}

function useTempState(): void {
  const root = mkdtempSync(join(tmpdir(), "creation-workspace-effect-"));
  roots.push(root);
  process.env.OPENSESSION_STATE_DIR = root;
}

describe("creation workspace effect executor", () => {
  test("adopts the destination after a crash before result acknowledgement", async () => {
    useTempState();
    let creates = 0;
    let results = 0;
    const create: typeof createWorkspace = (input) => {
      creates += 1;
      return createWorkspace(input);
    };
    await expect(executeCreationWorkspacePrepare(item(), {
      getWorkspace,
      createWorkspace: create,
      result: () => {
        results += 1;
        return { accepted: true, to: "preparing" };
      },
      afterDestinationAccepted: () => {
        throw new Error("injected crash after destination acceptance");
      },
    })).rejects.toThrow("injected crash after destination acceptance");
    expect(getWorkspace("ws-create-one")).toMatchObject({
      key: "session-create:create-one",
      branch: "feature/create-one",
    });
    await executeCreationWorkspacePrepare(item(), {
      getWorkspace,
      createWorkspace: create,
      result: () => {
        results += 1;
        return { accepted: true, to: "preparing" };
      },
    });
    expect(creates).toBe(1);
    expect(results).toBe(1);
  });

  test("treats replay after actor result acceptance as an acknowledged stale no-op", async () => {
    useTempState();
    let calls = 0;
    const dependencies = {
      getWorkspace,
      createWorkspace,
      result: () => {
        calls += 1;
        return calls === 1
          ? { accepted: true, to: "preparing" as const }
          : {
              accepted: false,
              reason: "stale_effect" as const,
              state: {
                identity: "create-one",
                generation: 1,
                state: "preparing" as const,
                changeSeq: 3,
                updatedAt: 1,
              },
            };
      },
    };
    await executeCreationWorkspacePrepare(item(), dependencies);
    await executeCreationWorkspacePrepare(item(), dependencies);
    expect(calls).toBe(2);
  });

  test("fails closed when the fixed destination belongs to another identity", async () => {
    useTempState();
    createWorkspace({
      id: "ws-create-one",
      key: "another-create",
      name: "Existing",
      createdBy: "Bob",
      repo: "opensession",
      branch: "feature/create-one",
    });
    await expect(executeCreationWorkspacePrepare(item(), {
      getWorkspace,
      createWorkspace,
      result: () => {
        throw new Error("result must not be sent");
      },
    })).rejects.toBeInstanceOf(CreationEffectIndeterminateError);
  });
});
