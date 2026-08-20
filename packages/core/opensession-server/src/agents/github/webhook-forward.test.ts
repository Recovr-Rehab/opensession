import { describe, expect, test } from "bun:test";
import {
  buildForwardCommand,
  computeTargets,
  detectGhWebhook,
  ensureGhWebhook,
  isPublicUrl,
  shouldForward,
  type GhRunner,
} from "./webhook-forward";
import { WEBHOOK_FORWARD_EVENTS } from "./constants";

/**
 * Unit coverage for the command construction, gating, and gh/extension
 * detection. The live outbound `gh webhook forward` subprocess cannot run in
 * tests, so it is exercised only up to argv assembly here.
 */

describe("buildForwardCommand", () => {
  const base = {
    events: WEBHOOK_FORWARD_EVENTS,
    url: "http://127.0.0.1:3848/github/webhook",
    secret: "s3cr3t",
  };

  test("per-repo forwarder argv", () => {
    expect(buildForwardCommand({ repo: "acme/app", ...base })).toEqual([
      "gh",
      "webhook",
      "forward",
      "--repo=acme/app",
      "--events=pull_request,pull_request_review,pull_request_review_comment,issue_comment,workflow_run",
      "--url=http://127.0.0.1:3848/github/webhook",
      "--secret=s3cr3t",
    ]);
  });

  test("org-wide forwarder uses --org", () => {
    const args = buildForwardCommand({ org: "acme", ...base });
    expect(args).toContain("--org=acme");
    expect(args.some((a) => a.startsWith("--repo="))).toBe(false);
  });

  test("secret is omitted when empty", () => {
    const args = buildForwardCommand({ repo: "acme/app", events: base.events, url: base.url });
    expect(args.some((a) => a.startsWith("--secret="))).toBe(false);
  });

  test("events match exactly what the /github/webhook handler processes", () => {
    expect([...WEBHOOK_FORWARD_EVENTS]).toEqual([
      "pull_request",
      "pull_request_review",
      "pull_request_review_comment",
      "issue_comment",
      "workflow_run",
    ]);
  });
});

describe("computeTargets", () => {
  test("org config wins: one org target, no repos", () => {
    expect(computeTargets([{ ghRepo: "acme/app" }], "acme")).toEqual({ org: "acme", repos: [] });
  });

  test("no org: one target per configured ghRepo, deduped, blanks dropped", () => {
    expect(
      computeTargets([{ ghRepo: "acme/app" }, { ghRepo: "acme/api" }, { ghRepo: "" }, {}], ""),
    ).toEqual({ repos: ["acme/app", "acme/api"] });
  });
});

describe("shouldForward (gating)", () => {
  test("public URL present ⇒ forwarder off (inbound HTTP webhook stays authoritative)", () => {
    expect(shouldForward({ publicBaseUrl: "https://os.example.com" })).toBe(false);
  });

  test("no public URL (loopback default) ⇒ forwarder on", () => {
    expect(shouldForward({ publicBaseUrl: "http://127.0.0.1:3850" })).toBe(true);
    expect(shouldForward({ publicBaseUrl: "http://localhost:3850" })).toBe(true);
  });

  test('explicit flag "true" forces on even with a public URL', () => {
    expect(shouldForward({ flag: "true", publicBaseUrl: "https://os.example.com" })).toBe(true);
  });

  test('explicit flag "false" forces off even with no public URL', () => {
    expect(shouldForward({ flag: "false", publicBaseUrl: "http://127.0.0.1:3850" })).toBe(false);
  });
});

describe("isPublicUrl", () => {
  test("classifies loopback vs public hosts", () => {
    expect(isPublicUrl("http://127.0.0.1:3850")).toBe(false);
    expect(isPublicUrl("http://localhost")).toBe(false);
    expect(isPublicUrl("https://os.example.com")).toBe(true);
    expect(isPublicUrl("not a url")).toBe(false);
  });
});

// A GhRunner stub that replies per-command from a script.
function runner(script: Record<string, { code: number; stdout: string }>): {
  run: GhRunner;
  calls: string[][];
} {
  const calls: string[][] = [];
  const run: GhRunner = async (args) => {
    calls.push(args);
    const key = args.join(" ");
    return script[key] ?? { code: 127, stdout: "" };
  };
  return { run, calls };
}

describe("detectGhWebhook", () => {
  test("gh missing ⇒ neither present", async () => {
    const { run } = runner({ "gh --version": { code: 127, stdout: "" } });
    expect(await detectGhWebhook(run)).toEqual({ gh: false, extension: false });
  });

  test("gh present, extension installed", async () => {
    const { run } = runner({
      "gh --version": { code: 0, stdout: "gh version 2.60.0" },
      "gh extension list": { code: 0, stdout: "cli/gh-webhook  v1.0.0\ngithub/gh-stack  v0.1" },
    });
    expect(await detectGhWebhook(run)).toEqual({ gh: true, extension: true });
  });

  test("gh present, extension missing", async () => {
    const { run } = runner({
      "gh --version": { code: 0, stdout: "gh version 2.60.0" },
      "gh extension list": { code: 0, stdout: "github/gh-stack  v0.1" },
    });
    expect(await detectGhWebhook(run)).toEqual({ gh: true, extension: false });
  });
});

describe("ensureGhWebhook", () => {
  test("available when the extension is already installed (no install attempt)", async () => {
    const { run, calls } = runner({
      "gh --version": { code: 0, stdout: "gh version 2.60.0" },
      "gh extension list": { code: 0, stdout: "cli/gh-webhook v1" },
    });
    expect(await ensureGhWebhook(run)).toBe(true);
    expect(calls.some((c) => c.includes("install"))).toBe(false);
  });

  test("installs the extension once when gh is present but it is missing", async () => {
    const { run, calls } = runner({
      "gh --version": { code: 0, stdout: "gh version 2.60.0" },
      "gh extension list": { code: 0, stdout: "" },
      "gh extension install cli/gh-webhook": { code: 0, stdout: "installed" },
    });
    expect(await ensureGhWebhook(run)).toBe(true);
    expect(calls).toContainEqual(["gh", "extension", "install", "cli/gh-webhook"]);
  });

  test("falls back (false) when install fails", async () => {
    const { run } = runner({
      "gh --version": { code: 0, stdout: "gh version 2.60.0" },
      "gh extension list": { code: 0, stdout: "" },
      "gh extension install cli/gh-webhook": { code: 1, stdout: "" },
    });
    expect(await ensureGhWebhook(run)).toBe(false);
  });

  test("falls back (false) when gh is absent", async () => {
    const { run } = runner({ "gh --version": { code: 127, stdout: "" } });
    expect(await ensureGhWebhook(run)).toBe(false);
  });
});
