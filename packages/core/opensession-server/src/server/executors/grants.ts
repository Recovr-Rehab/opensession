import { randomBytes } from "node:crypto";
import type {
  ExecutorFence,
  ExecutorGrant,
} from "@tellahq/opensession-protocol/executor";
import { ExecutorFailure } from "./contract";

export interface ExecutorGrantScope {
  rootId: string;
  sessionId: string;
  runId: string;
  generation: number;
  expiresAtMs: number;
}

export interface ExecutorGrantAuthorityOptions {
  now?: () => number;
  maxGrants?: number;
}

const DEFAULT_MAX_GRANTS = 10_000;

/** In-memory capability authority. Tokens are random lookup keys, never claims. */
export class ExecutorGrantAuthority {
  readonly #grants = new Map<ExecutorGrant, ExecutorGrantScope>();
  readonly #now: () => number;
  readonly #maxGrants: number;

  constructor(options: ExecutorGrantAuthorityOptions = {}) {
    this.#now = options.now ?? Date.now;
    this.#maxGrants = options.maxGrants ?? DEFAULT_MAX_GRANTS;
    if (!Number.isSafeInteger(this.#maxGrants) || this.#maxGrants < 1) {
      throw new Error("maxGrants must be a positive safe integer");
    }
  }

  issue(scope: ExecutorGrantScope): ExecutorGrant {
    assertScope(scope);
    if (scope.expiresAtMs <= this.#now()) {
      throw new ExecutorFailure(
        "deadline_exceeded",
        "grant expiry must be in the future",
      );
    }
    this.#pruneExpired();
    if (this.#grants.size >= this.#maxGrants) {
      throw new ExecutorFailure("executor_busy", "grant capacity is exhausted");
    }
    let grant: ExecutorGrant;
    do {
      grant = randomBytes(32).toString("base64url") as ExecutorGrant;
    } while (this.#grants.has(grant));
    this.#grants.set(grant, {
      rootId: scope.rootId,
      sessionId: scope.sessionId,
      runId: scope.runId,
      generation: scope.generation,
      expiresAtMs: scope.expiresAtMs,
    });
    return grant;
  }

  validate(grant: ExecutorGrant, fence: ExecutorFence): ExecutorGrantScope {
    const scope = this.#grants.get(grant);
    if (!scope)
      throw new ExecutorFailure(
        "invalid_grant",
        "executor grant is invalid or revoked",
      );
    const now = this.#now();
    if (scope.expiresAtMs <= now) {
      this.#grants.delete(grant);
      throw new ExecutorFailure(
        "deadline_exceeded",
        "executor grant has expired",
      );
    }
    if (
      scope.rootId !== fence.rootId ||
      scope.sessionId !== fence.sessionId ||
      scope.runId !== fence.runId
    ) {
      throw new ExecutorFailure(
        "invalid_grant",
        "executor grant does not authorize this root, session, and run",
      );
    }
    if (scope.generation !== fence.generation) {
      throw new ExecutorFailure(
        "stale_generation",
        "executor generation is stale",
      );
    }
    return { ...scope };
  }

  revoke(grant: ExecutorGrant): boolean {
    return this.#grants.delete(grant);
  }

  revokeGeneration(
    input: Pick<
      ExecutorGrantScope,
      "rootId" | "sessionId" | "runId" | "generation"
    >,
  ): number {
    let revoked = 0;
    for (const [grant, scope] of this.#grants) {
      if (
        scope.rootId === input.rootId &&
        scope.sessionId === input.sessionId &&
        scope.runId === input.runId &&
        scope.generation === input.generation
      ) {
        this.#grants.delete(grant);
        revoked++;
      }
    }
    return revoked;
  }

  get size(): number {
    return this.#grants.size;
  }

  #pruneExpired(): void {
    const now = this.#now();
    for (const [grant, scope] of this.#grants) {
      if (scope.expiresAtMs <= now) this.#grants.delete(grant);
    }
  }
}

function assertScope(scope: ExecutorGrantScope): void {
  if (
    typeof scope.rootId !== "string" ||
    !scope.rootId ||
    typeof scope.sessionId !== "string" ||
    !scope.sessionId ||
    typeof scope.runId !== "string" ||
    !scope.runId ||
    !Number.isSafeInteger(scope.generation) ||
    scope.generation < 0 ||
    !Number.isSafeInteger(scope.expiresAtMs)
  ) {
    throw new ExecutorFailure(
      "invalid_request",
      "invalid executor grant scope",
    );
  }
}
