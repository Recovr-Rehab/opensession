import { createWorkspace, getWorkspace, type Workspace } from "../workspaces";
import { registerSessionEffectExecutor } from "./effect-executors";
import { sessionKernel } from "./kernel";
import type { SessionActorEffectFor } from "./lifecycle-protocol";
import type {
  CreationEventDecisionResult,
  DurableOutboxItem,
} from "./store";

type WorkspaceEffect = SessionActorEffectFor<"creation_workspace_prepare">;
export type CreationWorkspaceEffectItem = Omit<
  DurableOutboxItem,
  "kind" | "payload"
> & WorkspaceEffect;

export class CreationEffectIndeterminateError extends Error {
  readonly indeterminate = true;
}

type WorkspaceExecutorDependencies = {
  getWorkspace: typeof getWorkspace;
  createWorkspace: typeof createWorkspace;
  result: (item: CreationWorkspaceEffectItem) => CreationEventDecisionResult;
  afterDestinationAccepted?: (workspace: Workspace) => void;
};

function defaultResult(
  item: CreationWorkspaceEffectItem,
): CreationEventDecisionResult {
  return sessionKernel(item.sessionId).applyCreationEvent({
    identity: item.payload.creationIdentity,
    event: "preparation_started",
    effectId: item.effectKey,
    detail: { workspaceId: item.payload.workspaceId },
  });
}

const defaultDependencies: WorkspaceExecutorDependencies = {
  getWorkspace,
  createWorkspace,
  result: defaultResult,
};

function assertAdoptableWorkspace(
  workspace: Workspace,
  item: CreationWorkspaceEffectItem,
): void {
  const payload = item.payload;
  if (workspace.key !== payload.dedupeKey)
    throw new CreationEffectIndeterminateError(
      `Workspace ${payload.workspaceId} exists with another durable identity`,
    );
  if (payload.project !== undefined && workspace.repo !== payload.project)
    throw new CreationEffectIndeterminateError(
      `Workspace ${payload.workspaceId} exists for another project`,
    );
  if (payload.branch !== undefined && workspace.branch !== payload.branch)
    throw new CreationEffectIndeterminateError(
      `Workspace ${payload.workspaceId} exists for another branch`,
    );
  if (
    payload.worktreeDir !== undefined &&
    workspace.worktreeDir !== payload.worktreeDir
  )
    throw new CreationEffectIndeterminateError(
      `Workspace ${payload.workspaceId} exists for another worktree`,
    );
}

/**
 * Create or adopt a fixed workspace destination, then return its fenced result.
 * A retry after destination acceptance adopts the same workspace. A retry after
 * result acceptance receives a stale-result no-op and can safely acknowledge.
 */
export async function executeCreationWorkspacePrepare(
  item: CreationWorkspaceEffectItem,
  dependencies: WorkspaceExecutorDependencies = defaultDependencies,
): Promise<void> {
  const payload = item.payload;
  let workspace = dependencies.getWorkspace(payload.workspaceId);
  if (workspace) assertAdoptableWorkspace(workspace, item);
  else {
    workspace = dependencies.createWorkspace({
      id: payload.workspaceId,
      key: payload.dedupeKey,
      name: payload.name,
      createdBy: payload.createdBy,
      repo: payload.project,
      branch: payload.branch,
      worktreeDir: payload.worktreeDir,
    });
  }
  dependencies.afterDestinationAccepted?.(workspace);
  const result = dependencies.result(item);
  if (result.accepted || result.reason === "stale_effect") return;
  throw new CreationEffectIndeterminateError(
    `Workspace effect ${item.effectId} result was rejected: ${result.reason || "unknown"}`,
  );
}

const registrationGlobal = globalThis as typeof globalThis & {
  __opensessionCreationWorkspaceExecutorRegistered?: boolean;
};

export function ensureCreationEffectExecutors(): void {
  if (registrationGlobal.__opensessionCreationWorkspaceExecutorRegistered) return;
  registerSessionEffectExecutor(
    "creation_workspace_prepare",
    executeCreationWorkspacePrepare,
  );
  registrationGlobal.__opensessionCreationWorkspaceExecutorRegistered = true;
}
