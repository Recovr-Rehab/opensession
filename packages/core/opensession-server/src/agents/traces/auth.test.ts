import { describe, expect, it } from "bun:test";
import { githubLoginFromTracesSession } from "./auth";
import { shouldPublishSession } from "./policy";
import type { NativeSessionFile } from "../../server/types";

describe("githubLoginFromTracesSession", () => {
  it("prefers the personal namespace slug", () => {
    expect(
      githubLoginFromTracesSession({
        user: { displayName: "Josh Oliver" },
        actor: { namespace: { slug: "joshuaoliver", type: "individual" } },
      }),
    ).toBe("joshuaoliver");
  });

  it("falls back to display name", () => {
    expect(
      githubLoginFromTracesSession({
        user: { displayName: "joshuaoliver" },
        actor: { namespace: { slug: "recovr", type: "org" } },
      }),
    ).toBe("joshuaoliver");
  });
});

describe("shouldPublishSession", () => {
  const base = { id: "s1" } as NativeSessionFile;

  it("skips automations", () => {
    expect(shouldPublishSession({ ...base, automation: "triage" }, "prompt")).toBe(false);
  });

  it("skips unattended kinds", () => {
    expect(shouldPublishSession(base, "automation")).toBe(false);
    expect(shouldPublishSession(base, "github-review")).toBe(false);
  });

  it("publishes interactive kinds", () => {
    expect(shouldPublishSession(base, "prompt")).toBe(true);
    expect(shouldPublishSession(base, "slack")).toBe(true);
  });
});
