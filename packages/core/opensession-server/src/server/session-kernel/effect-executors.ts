import type { DurableOutboxItem } from "./store";
import type {
  SessionActorEffectFor,
  SessionActorEffectKind,
} from "./lifecycle-protocol";

type EffectItem<K extends SessionActorEffectKind> = Omit<
  DurableOutboxItem,
  "kind" | "payload"
> &
  SessionActorEffectFor<K>;

type EffectExecutor<K extends SessionActorEffectKind> = (
  item: EffectItem<K>,
) => void | Promise<void>;

type EffectExecutors = {
  [K in SessionActorEffectKind]?: EffectExecutor<K>;
};

function humanAskDeliverPayload(
  payload: unknown,
): SessionActorEffectFor<"human_ask_deliver">["payload"] {
  const value = payload as { askId?: unknown; skipUi?: unknown } | undefined;
  if (typeof value?.askId !== "string" || typeof value.skipUi !== "boolean")
    throw new Error("Invalid human_ask_deliver effect payload");
  return { askId: value.askId, skipUi: value.skipUi };
}

const payloadDecoders: {
  [K in SessionActorEffectKind]: (
    payload: unknown,
  ) => SessionActorEffectFor<K>["payload"];
} = {
  human_ask_deliver: humanAskDeliverPayload,
};

export class SessionEffectExecutorRegistry {
  private readonly executors: EffectExecutors = {};

  register<K extends SessionActorEffectKind>(
    kind: K,
    executor: EffectExecutor<K>,
  ): () => void {
    if (this.executors[kind])
      throw new Error(`Session effect executor ${kind} is already registered`);
    this.executors[kind] = executor as EffectExecutors[K];
    return () => {
      if (this.executors[kind] === executor) delete this.executors[kind];
    };
  }

  kinds(): SessionActorEffectKind[] {
    return Object.keys(this.executors) as SessionActorEffectKind[];
  }

  replaceForTest<K extends SessionActorEffectKind>(
    kind: K,
    executor: EffectExecutor<K>,
  ): () => void {
    if (process.env.NODE_ENV !== "test")
      throw new Error("Session effect executors can only be replaced in tests");
    const previous = this.executors[kind];
    this.executors[kind] = executor as EffectExecutors[K];
    return () => {
      if (this.executors[kind] !== executor) return;
      if (previous) this.executors[kind] = previous;
      else delete this.executors[kind];
    };
  }

  async execute(item: DurableOutboxItem): Promise<boolean> {
    const kind = item.kind as SessionActorEffectKind;
    const executor = this.executors[kind] as
      | EffectExecutor<typeof kind>
      | undefined;
    const decode = payloadDecoders[kind];
    if (!executor || !decode) return false;
    const effectItem = {
      ...item,
      kind,
      payload: decode(item.payload),
    } as EffectItem<typeof kind>;
    await executor(effectItem);
    return true;
  }
}

const globalRegistry = globalThis as typeof globalThis & {
  __opensessionSessionEffectExecutors?: SessionEffectExecutorRegistry;
};
const registry = (globalRegistry.__opensessionSessionEffectExecutors ??=
  new SessionEffectExecutorRegistry());

export function registerSessionEffectExecutor<
  K extends SessionActorEffectKind,
>(kind: K, executor: EffectExecutor<K>): () => void {
  return registry.register(kind, executor);
}

export function registeredSessionEffectKinds(): SessionActorEffectKind[] {
  return registry.kinds();
}

export function replaceSessionEffectExecutorForTest<
  K extends SessionActorEffectKind,
>(kind: K, executor: EffectExecutor<K>): () => void {
  return registry.replaceForTest(kind, executor);
}

export function executeSessionEffect(
  item: DurableOutboxItem,
): Promise<boolean> {
  return registry.execute(item);
}
