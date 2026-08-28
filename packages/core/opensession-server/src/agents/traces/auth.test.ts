import { describe, expect, it } from "bun:test";
import { rmSync } from "fs";
import { githubLoginFromTracesSession } from "./auth";
import { publisherLogin, shouldPublishSession } from "./policy";
import { tracesShareEnv } from "./share-env";
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

describe("publisherLogin", () => {
  it("does not infer ownership from connected-account count", () => {
    expect(publisherLogin({ id: "s1" } as NativeSessionFile)).toBeNull();
    expect(publisherLogin({ id: "s1", createdByLogin: "josh" } as NativeSessionFile)).toBe("josh");
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

describe("tracesShareEnv", () => {
  it("puts the device token in env, not a copy of process.env", () => {
    const env = tracesShareEnv("device-secret");
    try {
      expect(env.TRACES_CLI_AUTH_TOKEN).toBe("device-secret");
      expect(env.HOME).toBeTruthy();
      expect(env.HOME).not.toBe(process.env.HOME);
      expect(env.FEATUREBASE_API_KEY).toBeUndefined();
    } finally {
      if (env.HOME) rmSync(env.HOME, { recursive: true, force: true });
    }
  });
});
