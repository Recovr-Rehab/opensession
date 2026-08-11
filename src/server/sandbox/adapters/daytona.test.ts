import { describe, expect, test } from "bun:test";
import { parseDaytonaExecResult } from "./daytona";

describe("Daytona exec transport", () => {
  test("recovers separate streams and a non-zero command exit code", () => {
    expect(
      parseDaytonaExecResult({
        exitCode: 0,
        result:
          "qualification-out__OS_STDERR_7f3a__qualification-err__OS_EXIT_91c2__7",
      }),
    ).toEqual({
      exitCode: 7,
      stdout: "qualification-out",
      stderr: "qualification-err",
    });
  });

  test("falls back to the SDK response for an unwrapped transport failure", () => {
    expect(parseDaytonaExecResult({ exitCode: 124, result: "timed out" })).toEqual({
      exitCode: 124,
      stdout: "timed out",
      stderr: "",
    });
  });
});
