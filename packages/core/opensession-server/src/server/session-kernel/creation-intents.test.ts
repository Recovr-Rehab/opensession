import { describe, expect, test } from "bun:test";
import { requestCreationWorkspace } from "./creation-intents";
import {
  SessionKernelStore,
  type CreationEventDecision,
} from "./store";

function harness(sessionId: string) {
  const store = new SessionKernelStore(":memory:");
  return {
    store,
    kernel: {
      creationState: () => store.creationState(sessionId),
      applyCreationEvent: (
        input: Omit<CreationEventDecision, "sessionId">,
      ) => store.applyCreationEvent({ ...input, sessionId }),
    },
  };
}

const input = {
  sessionId: "create-intent",
  identity: "request-intent",
  workspaceId: "ws-create-intent",
  dedupeKey: "session-create:request-intent",
  name: "Creation intent",
  createdBy: "Alice",
  project: "opensession",
  branch: "feature/intent",
  worktreeDir: "/worktrees/intent",
};

describe("creation workspace intents", () => {
  test("waits for the actor receipt rather than destination evidence", async () => {
    const { store, kernel } = harness(input.sessionId);
    try {
      setTimeout(() => {
        store.applyCreationEvent({
          sessionId: input.sessionId,
          identity: input.identity,
          event: "preparation_started",
          effectId: `workspace:${input.workspaceId}`,
        });
      }, 5);
      const state = await requestCreationWorkspace(input, {
        kernel,
        timeoutMs: 200,
        pollMs: 1,
      });
      expect(state.completedEffectIds).toEqual([
        `workspace:${input.workspaceId}`,
      ]);
      expect(store.pendingOutbox()).toMatchObject([
        {
          effectKey: `workspace:${input.workspaceId}`,
          payload: { worktreeDir: "/worktrees/intent" },
        },
      ]);
    } finally {
      store.close();
    }
  });

  test("does not re-emit work after its durable receipt", async () => {
    const { store, kernel } = harness(input.sessionId);
    try {
      const effectId = `workspace:${input.workspaceId}`;
      store.applyCreationEvent({
        sessionId: input.sessionId,
        identity: input.identity,
        event: "plan",
      });
      store.applyCreationEvent({
        sessionId: input.sessionId,
        identity: input.identity,
        event: "preparation_started",
        nextEffectId: effectId,
        effect: {
          kind: "creation_workspace_prepare",
          effectKey: effectId,
          payload: {
            creationIdentity: input.identity,
            creationGeneration: 1,
            workspaceId: input.workspaceId,
            dedupeKey: input.dedupeKey,
            name: input.name,
            createdBy: input.createdBy,
            project: input.project,
            branch: input.branch,
            worktreeDir: input.worktreeDir,
            mode: "adopt_or_create",
          },
        },
      });
      store.applyCreationEvent({
        sessionId: input.sessionId,
        identity: input.identity,
        event: "preparation_started",
        effectId,
      });
      const [settled] = store.pendingOutbox();
      store.ackOutbox(settled.id);
      await requestCreationWorkspace(input, { kernel, timeoutMs: 20, pollMs: 1 });
      expect(store.pendingOutbox()).toHaveLength(0);
    } finally {
      store.close();
    }
  });

  test("fails closed on identity crossover", async () => {
    const { store, kernel } = harness(input.sessionId);
    try {
      store.applyCreationEvent({
        sessionId: input.sessionId,
        identity: "another-request",
        event: "plan",
      });
      await expect(
        requestCreationWorkspace(input, { kernel, timeoutMs: 20, pollMs: 1 }),
      ).rejects.toThrow("identity crossed");
    } finally {
      store.close();
    }
  });
});
