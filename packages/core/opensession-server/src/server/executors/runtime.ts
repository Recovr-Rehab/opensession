import type {
  ExecutorCapability,
  ExecutorFence,
  ExecutorGrant,
  ExecutorOperation,
} from "@tellahq/opensession-protocol/executor";
import {
  openSQLiteCommandLedger,
  type SQLiteCommandLedger,
} from "../../runner-executor/sqlite-ledger";
import type { ExecutorContext } from "./contract";
import { ExecutorBroker } from "./broker";
import { ExecutorGrantAuthority } from "./grants";
import {
  ExecutorIngress,
  type ExecutorAuthority,
  type ExecutorIngressOptions,
} from "./ingress";
import { RemoteExecutorRegistry } from "./remote-registry";
import { SqliteExecutorInstanceClaims } from "./sqlite-claims";
import { ExecutorEnrollmentAuthority } from "../managed-executors/enrollment";
import {
  ExecutorManager,
  type DurableWorkspaceCheckpoint,
} from "../managed-executors/manager";
import type { ExecutorProvider } from "../managed-executors/provider";
import { ExecutorProviderRegistry } from "../managed-executors/registry";
import { SqliteExecutorStateStore } from "../managed-executors/sqlite-state";
import type { ExecutorRecord } from "../managed-executors/state";

export interface ExecutorRuntimePaths {
  /** Boot should derive these from stateDir() and keep each database distinct. */
  runnerLedgerDb: string;
  managedStateDb: string;
  instanceClaimsDb: string;
}

export interface RunnerExecutorAuthorization {
  capabilities: readonly ExecutorCapability[];
  connectable: boolean;
}

export interface ExecutorRuntimeOptions {
  paths: ExecutorRuntimePaths;
  providers: readonly ExecutorProvider[];
  runner: {
    /** Must verify the persisted paired Runner token. No ambient credentials are consulted. */
    authenticatePairedToken(input: {
      runnerId: string;
      token: string;
    }): boolean | Promise<boolean>;
    /** Must inspect the socket peer supplied by boot. Forwarded headers are not peer identity. */
    isTrustedPeer(remoteAddress: string): boolean | Promise<boolean>;
    authorize(input: {
      runnerId: string;
      generation: number;
    }): RunnerExecutorAuthorization | Promise<RunnerExecutorAuthorization>;
  };
  managed: {
    capabilities(record: ExecutorRecord): readonly ExecutorCapability[];
    checkpointWorkspace(
      record: ExecutorRecord,
    ): Promise<DurableWorkspaceCheckpoint>;
    /** Revokes any authority outside this composition, after its durable local fence is raised. */
    revokeExecutionAuthority(input: {
      executorId: string;
      throughGeneration: number;
    }): Promise<void>;
  };
  ingress: Pick<
    ExecutorIngressOptions,
    "createId" | "now" | "rateLimit" | "timers" | "connectionPolicy"
  >;
  grantTtlMs?: number;
  runnerLedger?: Omit<Parameters<typeof openSQLiteCommandLedger>[0], "dbPath">;
}

/**
 * Explicit, import-inert composition root for the next Executor runtime.
 *
 * Boot integration is deliberately not included here. Boot must derive private state paths,
 * provide the real paired-token and socket-peer callbacks, route the exact ingress path with
 * the kernel-reported peer address, attach `ingress.websocket` to Bun.serve, and call start()
 * before exposing routes. It must call close() during shutdown. Provider SDK construction and
 * credentials remain outside this module.
 */
export function createExecutorRuntime(
  options: ExecutorRuntimeOptions,
): ExecutorRuntime {
  return new ExecutorRuntime(options);
}

export class ExecutorRuntime {
  readonly registry = new RemoteExecutorRegistry();
  readonly enrollment: ExecutorEnrollmentAuthority;
  readonly brokerGrants: ExecutorGrantAuthority;
  readonly broker: ExecutorBroker;
  readonly providers = new ExecutorProviderRegistry();
  readonly #options: ExecutorRuntimeOptions;
  readonly #executionGrants = new ExecutorGrantAuthority();
  readonly #issuedByExecutor = new Map<string, Map<ExecutorGrant, number>>();
  readonly #grantTtlMs: number;
  #claims?: SqliteExecutorInstanceClaims;
  #managedStore?: SqliteExecutorStateStore;
  #ledger?: SQLiteCommandLedger;
  #manager?: ExecutorManager;
  #ingress?: ExecutorIngress;
  #started = false;
  #closed = false;
  #startPromise?: Promise<this>;

  constructor(options: ExecutorRuntimeOptions) {
    assertOptions(options);
    this.#options = options;
    this.#grantTtlMs = options.grantTtlMs ?? 30_000;
    this.enrollment = new ExecutorEnrollmentAuthority({
      now: options.ingress.now,
    });
    this.brokerGrants = new ExecutorGrantAuthority({
      now: options.ingress.now,
    });
    this.broker = new ExecutorBroker(this.brokerGrants, {
      now: options.ingress.now,
    });
    for (const provider of options.providers) this.providers.register(provider);
  }

  start(): Promise<this> {
    if (this.#closed)
      return Promise.reject(new Error("Executor runtime is closed"));
    if (this.#started) return Promise.resolve(this);
    if (!this.#startPromise) {
      this.#startPromise = this.#initialize().catch((error) => {
        this.#startPromise = undefined;
        throw error;
      });
    }
    return this.#startPromise;
  }

  async #initialize(): Promise<this> {
    let ledger: SQLiteCommandLedger | undefined;
    let managedStore: SqliteExecutorStateStore | undefined;
    let claims: SqliteExecutorInstanceClaims | undefined;
    try {
      ledger = openSQLiteCommandLedger({
        ...this.#options.runnerLedger,
        dbPath: this.#options.paths.runnerLedgerDb,
      });
      await ledger.recover();
      if (this.#closed) throw new Error("Executor runtime closed during start");
      managedStore = new SqliteExecutorStateStore(
        this.#options.paths.managedStateDb,
      );
      claims = new SqliteExecutorInstanceClaims(
        this.#options.paths.instanceClaimsDb,
      );

      const manager = new ExecutorManager({
        store: managedStore,
        providers: this.providers,
        now: this.#options.ingress.now,
        checkpointWorkspace: this.#options.managed.checkpointWorkspace,
        revokeExecutionAuthority: async (input) => {
          claims!.revokeThrough(
            "managed",
            input.executorId,
            input.throughGeneration,
          );
          this.registry.disconnect(
            input.executorId,
            "Executor generation was revoked",
          );
          this.#revokeExecutorGrants("managed", input.executorId);
          this.enrollment.revokeThrough(
            input.executorId,
            input.throughGeneration,
          );
          await this.#options.managed.revokeExecutionAuthority(input);
        },
      });
      const ingress = new ExecutorIngress({
        ...this.#options.ingress,
        registry: this.registry,
        authenticateRunner: async ({
          runnerId,
          generation,
          token,
          remoteAddress,
        }) => {
          if (!remoteAddress) return { ok: false, status: 403 };
          const paired = await this.#options.runner.authenticatePairedToken({
            runnerId,
            token,
          });
          if (!paired) return { ok: false, status: 401 };
          if (!(await this.#options.runner.isTrustedPeer(remoteAddress)))
            return { ok: false, status: 403 };
          const authorization = await this.#options.runner.authorize({
            runnerId,
            generation,
          });
          if (!authorization.connectable) return { ok: false, status: 403 };
          return {
            ok: true,
            authority: this.#authority(
              "runner",
              runnerId,
              generation,
              authorization.capabilities,
            ),
          };
        },
        consumeManagedEnrollment: (token, fence) =>
          this.enrollment.consume(token, fence),
        authorizeManaged: async ({ executorId, generation }) => {
          const record = await managedStore!.getByExecutorId(executorId);
          if (
            !record ||
            record.instanceGeneration !== generation ||
            record.lifecycle !== "awake"
          )
            return undefined;
          return this.#authority(
            "managed",
            executorId,
            generation,
            this.#options.managed.capabilities(record),
            (claim) => managedStore!.claimConnectableInstance(claim),
          );
        },
      });
      this.#ledger = ledger;
      this.#managedStore = managedStore;
      this.#claims = claims;
      this.#manager = manager;
      this.#ingress = ingress;
      this.#started = true;
      return this;
    } catch (error) {
      claims?.close();
      managedStore?.close();
      ledger?.close();
      throw error;
    }
  }

  get ingress(): ExecutorIngress {
    return this.#requireStarted(this.#ingress);
  }

  get manager(): ExecutorManager {
    return this.#requireStarted(this.#manager);
  }

  get runnerLedger(): SQLiteCommandLedger {
    return this.#requireStarted(this.#ledger);
  }

  /** Durable unpair/disable seam. Boot must call this before retiring a generation. */
  revokeRunnerAuthority(runnerId: string, throughGeneration: number): void {
    const claims = this.#requireStarted(this.#claims);
    claims.revokeThrough("runner", runnerId, throughGeneration);
    this.registry.disconnect(runnerId, "Runner Executor authority was revoked");
    this.#revokeExecutorGrants("runner", runnerId);
  }

  /** Validation seam for a future scoped grant route. It never consults ambient auth. */
  validateExecutionGrant(grant: ExecutorGrant, fence: ExecutorFence): boolean {
    try {
      this.#executionGrants.validate(grant, fence);
      return true;
    } catch {
      return false;
    }
  }

  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    this.#ingress?.shutdown();
    this.registry.shutdown("Executor runtime closed");
    for (const grants of this.#issuedByExecutor.values())
      for (const grant of grants.keys()) this.#executionGrants.revoke(grant);
    this.#issuedByExecutor.clear();
    this.#executionGrants.revokeAll();
    this.brokerGrants.revokeAll();
    this.#claims?.close();
    this.#managedStore?.close();
    this.#ledger?.close();
    this.#started = false;
  }

  #authority(
    source: "runner" | "managed",
    executorId: string,
    generation: number,
    capabilities: readonly ExecutorCapability[],
    claimInstance?: ExecutorAuthority["claimInstance"],
  ): ExecutorAuthority {
    const issue = (context: ExecutorContext, _operation?: ExecutorOperation) =>
      this.#issueGrant(source, executorId, context);
    return {
      executorId,
      generation,
      capabilities: [...capabilities],
      claimInstance:
        claimInstance ?? ((claim) => this.#claims!.claim({ source, ...claim })),
      resolveGrant: issue,
      resolveCleanupGrant: (context) => issue(context),
    };
  }

  #issueGrant(
    source: "runner" | "managed",
    executorId: string,
    context: ExecutorContext,
  ): ExecutorGrant {
    const now = this.#options.ingress.now();
    const expiresAtMs = now + this.#grantTtlMs;
    const grant = this.#executionGrants.issue({
      rootId: context.rootId,
      sessionId: context.sessionId,
      runId: context.runId,
      generation: context.generation,
      expiresAtMs,
    });
    const key = `${source}:${executorId}`;
    const issued =
      this.#issuedByExecutor.get(key) ?? new Map<ExecutorGrant, number>();
    for (const [prior, expiry] of issued)
      if (expiry <= now) issued.delete(prior);
    issued.set(grant, expiresAtMs);
    this.#issuedByExecutor.set(key, issued);
    return grant;
  }

  #revokeExecutorGrants(
    source: "runner" | "managed",
    executorId: string,
  ): void {
    const key = `${source}:${executorId}`;
    const grants = this.#issuedByExecutor.get(key);
    if (!grants) return;
    for (const grant of grants.keys()) this.#executionGrants.revoke(grant);
    this.#issuedByExecutor.delete(key);
  }

  #requireStarted<T>(value: T | undefined): T {
    if (!this.#started || !value)
      throw new Error("Executor runtime is not started");
    return value;
  }
}

function assertOptions(options: ExecutorRuntimeOptions): void {
  if (
    !options ||
    !options.paths ||
    !options.runner ||
    !options.managed ||
    !options.ingress
  )
    throw new TypeError("Executor runtime dependencies are required");
  const paths = Object.values(options.paths);
  if (
    paths.some(
      (path) => typeof path !== "string" || !path || path === ":memory:",
    )
  )
    throw new TypeError(
      "Executor runtime database paths must be explicit filesystem paths",
    );
  if (new Set(paths).size !== paths.length)
    throw new TypeError("Executor runtime database paths must be distinct");
  for (const callback of [
    options.runner.authenticatePairedToken,
    options.runner.isTrustedPeer,
    options.runner.authorize,
    options.managed.capabilities,
    options.managed.checkpointWorkspace,
    options.managed.revokeExecutionAuthority,
    options.ingress.createId,
    options.ingress.now,
    options.ingress.rateLimit,
  ]) {
    if (typeof callback !== "function")
      throw new TypeError("Executor runtime callback is required");
  }
  if (
    !options.ingress.timers ||
    typeof options.ingress.timers.setTimeout !== "function" ||
    typeof options.ingress.timers.clearTimeout !== "function"
  )
    throw new TypeError("Executor runtime timers are required");
  const ttl = options.grantTtlMs ?? 30_000;
  if (!Number.isSafeInteger(ttl) || ttl < 1 || ttl > 5 * 60_000)
    throw new TypeError(
      "Executor runtime grant TTL must be between 1ms and 5 minutes",
    );
}
