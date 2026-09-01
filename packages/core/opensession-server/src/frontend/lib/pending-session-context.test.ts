import { describe, expect, test } from "bun:test";
import {
  setPendingSessionContext,
  takePendingSessionContext,
} from "./pending-session-context";

describe("pending session context", () => {
  test("seeds a new tab exactly once", () => {
    setPendingSessionContext("new-session", "source-session");

    expect(takePendingSessionContext("new-session")).toEqual([
      "source-session",
    ]);
    expect(takePendingSessionContext("new-session")).toEqual([]);
  });
});
