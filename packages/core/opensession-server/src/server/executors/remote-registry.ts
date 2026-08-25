import type {
  ExecutorConnectionIdentity,
  ExecutorGrant,
} from "@tellahq/opensession-protocol/executor";
import type { DuplexJsonTransport } from "../../runner-executor/agent";
import { RemoteExecutorConnection } from "./remote";

export class RemoteExecutorRegistrationError extends Error {
  constructor(
    readonly code: "stale_generation" | "duplicate_incarnation",
    message: string,
  ) {
    super(message);
    this.name = "RemoteExecutorRegistrationError";
  }
}

export interface RemoteExecutorRegistration extends ExecutorConnectionIdentity {
  transport: DuplexJsonTransport;
  grant: ExecutorGrant;
}

/** Explicit registry with one active incarnation per executor and no import-time effects. */
export class RemoteExecutorRegistry {
  readonly #active = new Map<string, RemoteExecutorConnection>();
  readonly #highestGeneration = new Map<string, number>();

  register(registration: RemoteExecutorRegistration): RemoteExecutorConnection {
    const highest = this.#highestGeneration.get(registration.executorId);
    const active = this.#active.get(registration.executorId);
    if (highest !== undefined && registration.generation < highest) {
      throw new RemoteExecutorRegistrationError(
        "stale_generation",
        "executor generation is stale",
      );
    }
    if (active && active.connected) {
      throw new RemoteExecutorRegistrationError(
        registration.generation === active.identity.generation
          ? "duplicate_incarnation"
          : "stale_generation",
        "executor already has an active incarnation",
      );
    }
    if (highest !== undefined && registration.generation === highest) {
      throw new RemoteExecutorRegistrationError(
        "duplicate_incarnation",
        "executor generation was already registered",
      );
    }
    const connection = new RemoteExecutorConnection(registration);
    this.#active.set(registration.executorId, connection);
    this.#highestGeneration.set(
      registration.executorId,
      registration.generation,
    );
    return connection;
  }

  get(executorId: string): RemoteExecutorConnection | undefined {
    const connection = this.#active.get(executorId);
    return connection?.connected ? connection : undefined;
  }

  disconnect(executorId: string, reason?: unknown): boolean {
    const connection = this.#active.get(executorId);
    if (!connection) return false;
    connection.disconnect(reason);
    this.#active.delete(executorId);
    return true;
  }

  unregister(
    executorId: string,
    instanceId: string,
    generation: number,
  ): boolean {
    const connection = this.#active.get(executorId);
    if (
      !connection ||
      connection.identity.instanceId !== instanceId ||
      connection.identity.generation !== generation
    )
      return false;
    connection.disconnect("unregistered");
    this.#active.delete(executorId);
    return true;
  }

  get size(): number {
    return this.#active.size;
  }
}
