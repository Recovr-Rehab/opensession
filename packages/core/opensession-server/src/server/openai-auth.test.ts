import { describe, expect, test } from "bun:test";
import { supportsOpenaiFastMode } from "./openai-auth";

describe("OpenAI auth", () => {
  test("does not advertise priority-tier variants on Pi", () => {
    expect(supportsOpenaiFastMode("pi/openai/gpt-5.6-sol")).toBe(false);
  });
});
