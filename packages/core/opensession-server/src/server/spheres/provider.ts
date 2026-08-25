export const SPHERE_PROVIDER_IDS = ["box", "daytona", "modal"] as const;

export type SphereProviderId = (typeof SPHERE_PROVIDER_IDS)[number];

export interface SphereResourceRef {
  resourceId: string;
  sphereId: string;
  generation: number;
}

export interface CreateSphereResourceInput {
  sphereId: string;
  sessionId: string;
  generation: number;
}

export interface CreatedSphereResource {
  resourceId: string;
  workspaceId: string;
}

export interface SphereResourceInspection {
  state: "awake" | "sleeping" | "missing" | "unknown";
}

export interface EnsuredSphereExecutor {
  executorId: string;
  workspaceId: string;
}

/** Provider boundary for resource lifecycle and fixed executor installation only. */
export interface SphereProvider {
  readonly id: SphereProviderId;
  create(input: CreateSphereResourceInput): Promise<CreatedSphereResource>;
  inspect(resource: SphereResourceRef): Promise<SphereResourceInspection>;
  start(resource: SphereResourceRef): Promise<void>;
  stop(resource: SphereResourceRef): Promise<void>;
  destroy(resource: SphereResourceRef): Promise<void>;
  ensureExecutor(resource: SphereResourceRef): Promise<EnsuredSphereExecutor>;
  listManaged(): Promise<readonly SphereResourceRef[]>;
}
