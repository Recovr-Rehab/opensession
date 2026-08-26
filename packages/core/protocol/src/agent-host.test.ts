import { describe, expect, test } from "bun:test";
import {
  AGENT_HOST_PROTOCOL_VERSION,
  MAX_AGENT_TRANSCRIPT_APPEND_BYTES,
  MAX_AGENT_TURN_DURATION_MS,
  decodeAgentExecutorAccessGrant,
  decodeAgentHostHello,
  decodeAgentHostStartTurn,
  decodeAgentTurnSpec,
  isAgentTurnFence,
  type AgentTurnSpec,
} from "./agent-host";

const now = 1_000;
const accessGrant = decodeAgentExecutorAccessGrant(
  "opaque-dispatch-capability",
)!;
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
  enginePolicy: { engineSessionId: "engine-session-1" },
  mcpPolicy: { servers: [] },
  transcriptPolicy: { maxAppendBytes: 64_000, requireAck: true },
  runPolicy: { trustProfile: "interactive", runKind: "prompt" },
  identityPolicy: { user: "Ada", mcpGrantUser: "Ada" },
  environmentPolicy: {
    author: { name: "Ada", email: "ada@example.test" },
  },
  workspacePolicy: {
    executionRoot: "/work/session-1",
    repositoriesNote: "Primary repository: opensession",
  },
  executorPolicy: {
    executorId: "executor-1",
    rootId: "root-1",
    generation: 1,
    accessGrant,
    deadlineMs: now + 60_000,
  },
};

describe("Agent Host protocol", () => {
  test("uses an exact-version handshake", () => {
    const hello = {
      t: "hello" as const,
      version: AGENT_HOST_PROTOCOL_VERSION,
      requestId: "request-1",
    };
    expect(decodeAgentHostHello(hello)).toEqual(hello);
    expect(decodeAgentHostHello({ ...hello, version: 2 })).toBeUndefined();
    expect(decodeAgentHostHello({ ...hello, extra: true })).toBeUndefined();
  });

  test("fences a turn by exact session, run, turn, and generation", () => {
    const fence = spec.fence;
    expect(isAgentTurnFence(fence)).toBe(true);
    expect(isAgentTurnFence({ ...fence, turnId: "" })).toBe(false);
    expect(isAgentTurnFence({ ...fence, generation: -1 })).toBe(false);
    expect(isAgentTurnFence({ ...fence, model: "forbidden" })).toBe(false);
  });

  test("brands a bounded Agent Host access grant separately", () => {
    expect(decodeAgentExecutorAccessGrant("opaque") as string).toBe("opaque");
    expect(decodeAgentExecutorAccessGrant("")).toBeUndefined();
    expect(
      decodeAgentExecutorAccessGrant("x".repeat(16 * 1024 + 1)),
    ).toBeUndefined();
  });

  test("strictly decodes a complete start_turn", () => {
    const message = {
      t: "start_turn" as const,
      version: AGENT_HOST_PROTOCOL_VERSION,
      requestId: "request-1",
      spec,
    };
    expect(decodeAgentTurnSpec(spec, now)).toEqual(spec);
    expect(decodeAgentHostStartTurn(message, now)).toEqual(message);
    expect(
      decodeAgentHostStartTurn({ ...message, prompt: "forbidden" }, now),
    ).toBeUndefined();
    expect(
      decodeAgentHostStartTurn(
        { ...message, spec: { ...spec, model: "forbidden" } },
        now,
      ),
    ).toBeUndefined();
  });

  test("rejects stale, mismatched, malformed, and operation-grant-shaped bindings", () => {
    const replaceExecutorPolicy = (
      executorPolicy: Record<string, unknown>,
    ) => ({
      ...spec,
      executorPolicy,
    });
    expect(
      decodeAgentTurnSpec(
        replaceExecutorPolicy({ ...spec.executorPolicy, deadlineMs: now }),
        now,
      ),
    ).toBeUndefined();
    expect(
      decodeAgentTurnSpec(
        replaceExecutorPolicy({
          ...spec.executorPolicy,
          deadlineMs: now + MAX_AGENT_TURN_DURATION_MS + 1,
        }),
        now,
      ),
    ).toBeUndefined();
    expect(
      decodeAgentTurnSpec(
        replaceExecutorPolicy({ ...spec.executorPolicy, generation: 2 }),
        now,
      ),
    ).toBeUndefined();
    expect(
      decodeAgentTurnSpec(
        replaceExecutorPolicy({ ...spec.executorPolicy, executorId: "bad id" }),
        now,
      ),
    ).toBeUndefined();
    expect(
      decodeAgentTurnSpec(
        replaceExecutorPolicy({
          ...spec.executorPolicy,
          grant: accessGrant,
          fence: spec.fence,
        }),
        now,
      ),
    ).toBeUndefined();
    expect(
      decodeAgentTurnSpec({ ...spec, executorGrant: accessGrant }, now),
    ).toBeUndefined();
  });

  test("rejects credential and provider nesting outside named policies", () => {
    expect(
      decodeAgentTurnSpec(
        {
          ...spec,
          input: { ...spec.input, providerConfig: { apiKey: "secret" } },
        },
        now,
      ),
    ).toBeUndefined();
    expect(
      decodeAgentTurnSpec(
        {
          ...spec,
          modelPolicy: { ...spec.modelPolicy, accessGrant: "persist-me" },
        },
        now,
      ),
    ).toBeUndefined();
    expect(
      decodeAgentTurnSpec(
        {
          ...spec,
          mcpPolicy: { ...spec.mcpPolicy, credentials: { token: "secret" } },
        },
        now,
      ),
    ).toBeUndefined();
    expect(
      decodeAgentTurnSpec(
        {
          ...spec,
          transcriptPolicy: {
            ...spec.transcriptPolicy,
            maxAppendBytes: MAX_AGENT_TRANSCRIPT_APPEND_BYTES + 1,
          },
        },
        now,
      ),
    ).toBeUndefined();
    expect(
      decodeAgentTurnSpec(
        {
          ...spec,
          workspacePolicy: { executionRoot: "/work/session-1\u0000escape" },
        },
        now,
      ),
    ).toBeUndefined();
    expect(
      decodeAgentTurnSpec(
        {
          ...spec,
          fence: { ...spec.fence, runId: "run-1\nforged" },
        },
        now,
      ),
    ).toBeUndefined();
  });
});
