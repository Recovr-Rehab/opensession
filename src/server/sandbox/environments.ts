/** Persistent per-repository sandbox environment readiness. */

import { existsSync, readFileSync, statSync } from "fs";
import { stateDir } from "../paths";
import { writeJsonAtomic } from "../shared/atomic-write";
import { REPOS } from "../worktree";
import {
  sandboxConnectionReady,
  type WorkspaceSandboxProvider,
} from "./connections";
import {
  invalidateRemoteRepoTemplate,
  readRemoteRepoTemplate,
} from "./remote-repo-template";
import {
  invalidatePrewarm,
  prewarmStatus,
  requestPrewarm,
} from "./prewarm";
import { startSandboxOperation } from "./operations";

const invalidationTimers: Map<string, ReturnType<typeof setTimeout>> =
  ((globalThis as any).__sandboxEnvironmentInvalidationTimers ??= new Map());

export interface SandboxEnvironment {
  repo: string;
  provider: WorkspaceSandboxProvider;
  state: "not_prepared" | "preparing" | "ready" | "failed" | "stale";
  updatedAt: string;
  preparedAt?: string;
  expiresAt?: string;
  failureCode?: string;
  failureSummary?: string;
  mode?: "template" | "per_session";
}

interface StoredEnvironments {
  version: 1;
  environments: SandboxEnvironment[];
}

function storePath(): string {
  return process.env.OPENSESSION_SANDBOX_ENVIRONMENTS_STORE || stateDir("sandbox-environments.json");
}

function readStored(): SandboxEnvironment[] {
  try {
    const raw = JSON.parse(readFileSync(storePath(), "utf-8")) as StoredEnvironments;
    return Array.isArray(raw?.environments) ? raw.environments : [];
  } catch {
    return [];
  }
}

function writeEnvironment(environment: SandboxEnvironment): void {
  const all = readStored().filter(
    (candidate) =>
      candidate.repo !== environment.repo || candidate.provider !== environment.provider,
  );
  all.push(environment);
  writeJsonAtomic(storePath(), { version: 1, environments: all } satisfies StoredEnvironments);
}

function storedEnvironment(
  repo: string,
  provider: WorkspaceSandboxProvider,
): SandboxEnvironment | undefined {
  return readStored().find(
    (environment) => environment.repo === repo && environment.provider === provider,
  );
}

async function derivedEnvironment(
  repo: string,
  provider: WorkspaceSandboxProvider,
): Promise<SandboxEnvironment> {
  const stored = storedEnvironment(repo, provider);
  const now = new Date().toISOString();
  if (!sandboxConnectionReady(provider)) {
    return {
      repo,
      provider,
      state: "not_prepared",
      updatedAt: stored?.updatedAt || now,
    };
  }
  if (provider === "docker") {
    return {
      repo,
      provider,
      state: "ready",
      mode: "per_session",
      updatedAt: stored?.updatedAt || now,
      preparedAt: stored?.preparedAt || now,
    };
  }
  if (provider === "daytona" || provider === "modal") {
    const template = readRemoteRepoTemplate(provider, repo);
    if (template) {
      return {
        repo,
        provider,
        state: "ready",
        mode: "template",
        updatedAt: template.createdAt,
        preparedAt: template.createdAt,
        expiresAt: template.expiresAt,
      };
    }
  } else if (provider === "microvm") {
    const { microvmRepoTemplatePath } = await import("./adapters/microvm");
    const path = microvmRepoTemplatePath(repo);
    if (path && existsSync(path)) {
      const stat = statSync(path);
      const expires = stat.mtimeMs + 24 * 60 * 60_000;
      if (expires > Date.now()) {
        return {
          repo,
          provider,
          state: "ready",
          mode: "template",
          updatedAt: stat.mtime.toISOString(),
          preparedAt: stat.mtime.toISOString(),
          expiresAt: new Date(expires).toISOString(),
        };
      }
      return {
        repo,
        provider,
        state: "stale",
        mode: "template",
        updatedAt: stat.mtime.toISOString(),
        preparedAt: stat.mtime.toISOString(),
        expiresAt: new Date(expires).toISOString(),
      };
    }
  }
  return (
    stored || {
      repo,
      provider,
      state: "not_prepared",
      updatedAt: now,
    }
  );
}

export async function listSandboxEnvironments(): Promise<SandboxEnvironment[]> {
  const out: SandboxEnvironment[] = [];
  const providers: WorkspaceSandboxProvider[] = ["docker", "daytona", "modal", "microvm"];
  for (const repo of Object.keys(REPOS)) {
    for (const provider of providers) out.push(await derivedEnvironment(repo, provider));
  }
  return out;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function removeTemplate(
  repo: string,
  provider: WorkspaceSandboxProvider,
): Promise<void> {
  if (provider === "daytona" || provider === "modal") {
    const previous = invalidateRemoteRepoTemplate(provider, repo);
    if (previous?.artifactId) {
      if (provider === "daytona") {
        const { deleteDaytonaTemplateArtifact } = await import("./adapters/daytona");
        await deleteDaytonaTemplateArtifact(previous.artifactId);
      } else {
        const { deleteModalTemplateArtifact } = await import("./adapters/modal");
        await deleteModalTemplateArtifact(previous.artifactId);
      }
    }
  } else if (provider === "microvm") {
    const { deleteMicrovmRepoTemplate } = await import("./adapters/microvm");
    await deleteMicrovmRepoTemplate(repo);
  }
}

/**
 * Drop warm artifacts after the repository's default branch changes. Artifact
 * deletion is best-effort, but mappings are invalidated first so a stale image
 * can never be selected while provider cleanup is retrying.
 */
export async function invalidateSandboxEnvironmentsForRepo(repo: string): Promise<void> {
  if (!(repo in REPOS)) return;
  for (const provider of ["daytona", "modal", "microvm"] as const) {
    await invalidatePrewarm(provider, repo).catch((error) => {
      console.warn(`[sandbox:${provider}] failed to release prewarm for ${repo}:`, error);
    });
    await removeTemplate(repo, provider).catch((error) => {
      console.warn(`[sandbox:${provider}] failed to delete stale template for ${repo}:`, error);
    });
    const now = new Date().toISOString();
    writeEnvironment({
      repo,
      provider,
      state: "stale",
      mode: "template",
      updatedAt: now,
    });
  }
}

/** Coalesce the webhook burst generated by one default-branch update. */
export function scheduleSandboxEnvironmentInvalidation(repo: string): void {
  if (!(repo in REPOS) || invalidationTimers.has(repo)) return;
  invalidationTimers.set(
    repo,
    setTimeout(() => {
      invalidationTimers.delete(repo);
      void invalidateSandboxEnvironmentsForRepo(repo).catch((error) => {
        console.error(`[sandbox] environment invalidation failed for ${repo}:`, error);
      });
    }, 2_000),
  );
}

export async function prepareSandboxEnvironment(
  repo: string,
  provider: WorkspaceSandboxProvider,
  options: { rebuild?: boolean; user?: string } = {},
): Promise<void> {
  if (!(repo in REPOS)) throw Object.assign(new Error(`Unknown repository "${repo}"`), { code: "REPO_UNKNOWN" });
  if (!sandboxConnectionReady(provider)) {
    throw Object.assign(new Error(`${provider} is not Ready`), { code: "CONNECTION_NOT_READY" });
  }
  if (provider === "docker") {
    writeEnvironment({
      repo,
      provider,
      state: "ready",
      mode: "per_session",
      preparedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    return;
  }
  if (options.rebuild) {
    await invalidatePrewarm(provider, repo);
    await removeTemplate(repo, provider);
  }
  const now = new Date().toISOString();
  writeEnvironment({ repo, provider, state: "preparing", updatedAt: now });
  try {
    const deadline = Date.now() + 20 * 60_000;
    while (Date.now() < deadline) {
      const requested = await requestPrewarm(provider, repo, options.user || "workspace-setup");
      const entry = prewarmStatus(provider, repo);
      if (requested.state === "ready" || entry?.state === "ready") {
        // Publishing is complete before the pool flips Ready. Release this
        // build sandbox so preparing many repos stays within the paid cap;
        // the retained provider artifact is what sessions restore.
        await invalidatePrewarm(provider, repo);
        const derived = await derivedEnvironment(repo, provider);
        if (derived.state !== "ready") {
          throw Object.assign(new Error("Prepared template could not be verified"), {
            code: "TEMPLATE_VERIFY_FAILED",
          });
        }
        writeEnvironment(derived);
        return;
      }
      if (requested.state === "failed" || entry?.state === "failed") {
        throw Object.assign(new Error("Repository setup failed in the sandbox provider"), {
          code: "ENVIRONMENT_SETUP_FAILED",
        });
      }
      if (requested.state === "disabled" || requested.state === "unsupported") {
        throw Object.assign(new Error("This provider cannot prepare project environments"), {
          code: "ENVIRONMENT_UNSUPPORTED",
        });
      }
      await delay(2_000);
    }
    throw Object.assign(new Error("Project environment preparation timed out"), {
      code: "ENVIRONMENT_TIMEOUT",
    });
  } catch (error) {
    const code =
      typeof (error as { code?: unknown })?.code === "string"
        ? String((error as { code: string }).code)
        : "ENVIRONMENT_SETUP_FAILED";
    const failure: SandboxEnvironment = {
      repo,
      provider,
      state: "failed",
      updatedAt: new Date().toISOString(),
      failureCode: code,
      failureSummary:
        code === "ENVIRONMENT_TIMEOUT"
          ? "Project setup took too long. Try rebuilding it."
          : "Project setup failed. Review the retained setup log and rebuild it.",
    };
    writeEnvironment(failure);
    throw Object.assign(new Error(failure.failureSummary), { code });
  }
}

const providerQueues: Map<string, Promise<void>> = ((globalThis as any).__sandboxEnvironmentQueues ??= new Map());

export function scheduleSandboxEnvironment(
  repo: string,
  provider: WorkspaceSandboxProvider,
  options: { rebuild?: boolean; user?: string } = {},
) {
  const previous = providerQueues.get(provider) || Promise.resolve();
  const operation = startSandboxOperation(
    { kind: "environment_rebuild", provider, repo },
    async () => {
      const run = previous.catch(() => {}).then(() => prepareSandboxEnvironment(repo, provider, options));
      providerQueues.set(provider, run);
      try {
        await run;
      } finally {
        if (providerQueues.get(provider) === run) providerQueues.delete(provider);
      }
    },
  );
  return operation;
}

export function scheduleReadyConnectionEnvironments(provider: WorkspaceSandboxProvider): void {
  for (const repo of Object.keys(REPOS)) scheduleSandboxEnvironment(repo, provider);
}
