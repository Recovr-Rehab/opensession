import { describe, expect, test } from "bun:test";
import {
  SessionEffectExecutorRegistry,
} from "./effect-executors";
import type { DurableOutboxItem } from "./store";

function outbox(payload: unknown, kind = "human_ask_deliver"): DurableOutboxItem {
  return {
    id: 1,
    effectId: "session:human_ask_deliver:ask",
    effectKey: "ask",
    sessionId: "session",
    kind,
    payload,
    attempts: 0,
    nextAttemptAt: 0,
    createdAt: 1,
  };
}

describe("session effect executor registry", () => {
  test("decodes typed payloads before execution", async () => {
    const registry = new SessionEffectExecutorRegistry();
    let delivered: { askId: string; skipUi: boolean } | undefined;
    registry.register("human_ask_deliver", (item) => {
      delivered = item.payload;
    });

    expect(
      await registry.execute(outbox({ askId: "ask-one", skipUi: false })),
    ).toBe(true);
    expect(delivered).toEqual({ askId: "ask-one", skipUi: false });
  });

  test("rejects malformed known effects and ignores unknown versions", async () => {
    const registry = new SessionEffectExecutorRegistry();
    registry.register("human_ask_deliver", () => {});

    await expect(
      registry.execute(outbox({ askId: "ask-one" })),
    ).rejects.toThrow("Invalid human_ask_deliver effect payload");
    expect(await registry.execute(outbox(null, "future_effect"))).toBe(false);
  });

  test("allows exactly one executor per effect kind", () => {
    const registry = new SessionEffectExecutorRegistry();
    const unregister = registry.register("human_ask_deliver", () => {});
    expect(() =>
      registry.register("human_ask_deliver", () => {}),
    ).toThrow("already registered");
    unregister();
    expect(registry.kinds()).toEqual([]);
  });
});
