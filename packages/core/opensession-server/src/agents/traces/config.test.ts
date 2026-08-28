import { afterEach, describe, expect, it } from "bun:test";
import { tracesApiBase, tracesEnabled } from "./config";

describe("tracesEnabled", () => {
  const previous = process.env.ENABLE_TRACES_AGENT;

  afterEach(() => {
    if (previous === undefined) delete process.env.ENABLE_TRACES_AGENT;
    else process.env.ENABLE_TRACES_AGENT = previous;
  });

  it("only the literal string true enables via env", () => {
    process.env.ENABLE_TRACES_AGENT = "true";
    expect(tracesEnabled()).toBe(true);
    for (const value of ["false", "0", "1", "yes", ""]) {
      process.env.ENABLE_TRACES_AGENT = value;
      expect(tracesEnabled()).toBe(false);
    }
  });

  it("stays off when a credential could exist but the flag is not true", () => {
    process.env.ENABLE_TRACES_AGENT = "false";
    expect(tracesEnabled()).toBe(false);
  });
});

describe("tracesApiBase", () => {
  const previous = process.env.TRACES_API_BASE;

  afterEach(() => {
    if (previous === undefined) delete process.env.TRACES_API_BASE;
    else process.env.TRACES_API_BASE = previous;
  });

  it("rejects non-HTTPS bases", () => {
    process.env.TRACES_API_BASE = "http://evil.example/steal";
    expect(tracesApiBase()).toBe("https://actions.traces.com");
  });

  it("accepts an HTTPS origin", () => {
    process.env.TRACES_API_BASE = "https://actions.example.com/";
    expect(tracesApiBase()).toBe("https://actions.example.com");
  });
});
