import { describe, expect, test } from "bun:test";
import {
  EXECUTOR_PROTOCOL_VERSION,
  decodeExecutorFence,
  decodeExecutorGrant,
  decodeExecutorHello,
  decodeExecutorOperation,
  type ExecutorClientMessage,
  type ExecutorOperation,
} from "./executor";

type DeepKeys<T> = T extends readonly unknown[]
  ? never
  : T extends object
    ? { [K in keyof T]: K | DeepKeys<T[K]> }[keyof T]
    : never;
type ForbiddenExecutorLeaf =
  | "prompt"
  | "model"
  | "models"
  | "account"
  | "accountId"
  | "mcp"
  | "transcript"
  | "credential"
  | "credentials"
  | "secret"
  | "accessToken"
  | "apiKey"
  | "authorization"
  | "env";
type ForbiddenLeaves = Extract<
  DeepKeys<ExecutorClientMessage>,
  ForbiddenExecutorLeaf
>;
type Assert<T extends true> = T;
type _ExecutorPayloadHasNoForbiddenLeaves = Assert<
  ForbiddenLeaves extends never ? true : false
>;

const fence = {
  rootId: "root-1",
  sessionId: "session-1",
  runId: "run-1",
  generation: 3,
  deadlineMs: 2_000,
};

describe("executor versioning", () => {
  const hello = {
    t: "hello",
    version: EXECUTOR_PROTOCOL_VERSION,
    requestId: "request-1",
    executorId: "executor-1",
    instanceId: "instance-1",
    generation: 4,
    capabilities: ["fs", "process"] as Array<"fs" | "process">,
  } as const;

  test("accepts only an exact-v2 incarnation hello", () => {
    expect(decodeExecutorHello(hello)).toEqual(hello);
    expect(
      decodeExecutorHello({ ...hello, version: EXECUTOR_PROTOCOL_VERSION - 1 }),
    ).toBeUndefined();
    expect(
      decodeExecutorHello({
        ...hello,
        minVersion: 1,
        maxVersion: EXECUTOR_PROTOCOL_VERSION,
      }),
    ).toBeUndefined();
    expect(
      decodeExecutorHello({ ...hello, enrollmentToken: "forbidden" }),
    ).toBeUndefined();
    expect(
      decodeExecutorHello({ ...hello, capabilities: ["fs", "fs"] }),
    ).toBeUndefined();
  });
});

describe("executor authority fencing", () => {
  test("treats grants as bounded opaque values", () => {
    expect(decodeExecutorGrant("opaque.capability") as string).toBe(
      "opaque.capability",
    );
    expect(decodeExecutorGrant("")).toBeUndefined();
    expect(decodeExecutorGrant("x".repeat(16 * 1024 + 1))).toBeUndefined();
  });

  test("requires a live, non-negative generation fence", () => {
    expect(decodeExecutorFence(fence, 1_000)).toEqual(fence);
    expect(
      decodeExecutorFence({ ...fence, generation: -1 }, 1_000),
    ).toBeUndefined();
    expect(
      decodeExecutorFence({ ...fence, deadlineMs: 1_000 }, 1_000),
    ).toBeUndefined();
    expect(
      decodeExecutorFence({ ...fence, runId: "../run" }, 1_000),
    ).toBeUndefined();
    expect(
      decodeExecutorFence({ ...fence, turnId: "turn-1" }, 1_000),
    ).toBeUndefined();
  });
});

describe("executor operations", () => {
  test("rejects malformed operations before retry classification", () => {
    expect(
      decodeExecutorOperation({
        kind: "fs.write",
        path: "a",
        data: "x",
        encoding: "utf8",
      }),
    ).toBeUndefined();
    expect(
      decodeExecutorOperation({
        kind: "fs.read",
        path: "a",
        idempotencyKey: "stray",
      }),
    ).toBeUndefined();
    expect(
      decodeExecutorOperation({
        kind: "fs.write",
        path: "a",
        data: "x",
        encoding: "utf8",
        idempotencyKey: "write-1",
      }),
    ).toBeDefined();
  });

  test("cover each structured tool/workspace family", () => {
    const operations: ExecutorOperation[] = [
      { kind: "fs.read", path: "src/index.ts" },
      {
        kind: "process.spawn",
        executable: "bun",
        args: ["test"],
        idempotencyKey: "process-1",
      },
      {
        kind: "terminal.open",
        columns: 80,
        rows: 24,
        idempotencyKey: "terminal-1",
      },
      {
        kind: "service.start",
        name: "preview",
        executable: "bun",
        args: ["run", "dev"],
        idempotencyKey: "service-1",
      },
      {
        kind: "portal.open",
        name: "preview",
        port: 3000,
        idempotencyKey: "portal-1",
      },
    ];
    expect(operations.map(({ kind }) => kind.split(".")[0])).toEqual([
      "fs",
      "process",
      "terminal",
      "service",
      "portal",
    ]);
  });
});
