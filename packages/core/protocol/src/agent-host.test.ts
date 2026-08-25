import { describe, expect, test } from "bun:test";
import {
  AGENT_HOST_PROTOCOL_VERSION,
  decodeAgentHostHello,
  isAgentTurnFence,
  type AgentTurnSpec,
} from "./agent-host";
import { decodeExecutorGrant } from "./executor";

describe("Agent Host protocol", () => {
  test("uses an exact-version handshake", () => {
    const hello = {
      t: "hello" as const,
      version: AGENT_HOST_PROTOCOL_VERSION,
      requestId: "request-1",
    };
    expect(decodeAgentHostHello(hello)).toEqual(hello);
    expect(decodeAgentHostHello({ ...hello, version: 2 })).toBeUndefined();
  });

  test("fences a turn by session, run, turn, and generation", () => {
    const fence = {
      sessionId: "session-1",
      runId: "run-1",
      turnId: "turn-1",
      generation: 0,
    };
    expect(isAgentTurnFence(fence)).toBe(true);
    expect(isAgentTurnFence({ ...fence, turnId: "" })).toBe(false);
    expect(isAgentTurnFence({ ...fence, generation: -1 })).toBe(false);
  });

  test("carries one opaque Executor grant beside control-plane policies", () => {
    const grant = decodeExecutorGrant("opaque-executor-capability");
    expect(grant).toBeDefined();
    const spec: AgentTurnSpec = {
      fence: {
        sessionId: "session-1",
        runId: "run-1",
        turnId: "turn-1",
        generation: 1,
      },
      input: { prompt: "Run the tests" },
      mode: "code",
      modelPolicy: { model: "example-model" },
      mcpPolicy: { servers: [] },
      transcriptPolicy: { maxAppendBytes: 64_000, requireAck: true },
      executorGrant: grant!,
    };
    expect(Object.keys(spec).filter((key) => key === "executorGrant")).toHaveLength(1);
  });
});
