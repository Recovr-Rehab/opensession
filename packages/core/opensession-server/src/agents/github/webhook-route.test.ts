import { afterEach, describe, it, expect } from "bun:test";
import { SlackAgent } from "../slack/index";
import { GithubAgent } from "./index";

const savedGithubFlag = process.env.ENABLE_GITHUB_AGENT;
afterEach(() => {
  if (savedGithubFlag === undefined) delete process.env.ENABLE_GITHUB_AGENT;
  else process.env.ENABLE_GITHUB_AGENT = savedGithubFlag;
});

// The GitHub webhook route moved out of the Slack agent so it exists whenever
// the GitHub agent runs — including a GitHub-only install and the outbound
// `gh webhook forward` path, which both target it.
describe("GithubAgent webhook route", () => {
  it("owns POST /github/webhook", () => {
    const routes = new GithubAgent().getRoutes();
    expect(routes.has("POST /github/webhook")).toBe(true);
    expect(routes.has("POST /github-pr/*")).toBe(true);
  });

  it("rejects an unsigned delivery with 401", async () => {
    const handler = new GithubAgent().getRoutes().get("POST /github/webhook")!;
    const req = new Request("http://127.0.0.1/github/webhook", {
      method: "POST",
      headers: { "x-github-event": "pull_request" },
      body: JSON.stringify({ action: "opened" }),
    });
    const res = await handler(req, new URL("http://127.0.0.1/github/webhook"));
    expect(res.status).toBe(401);
  });
});

describe("Slack-only GitHub webhook route", () => {
  it("registers the shared route when the GitHub agent is disabled", () => {
    process.env.ENABLE_GITHUB_AGENT = "false";
    expect(new SlackAgent().getRoutes().has("POST /github/webhook")).toBe(true);
  });

  it("leaves one owner when the GitHub agent is enabled", () => {
    process.env.ENABLE_GITHUB_AGENT = "true";
    expect(new SlackAgent().getRoutes().has("POST /github/webhook")).toBe(false);
    expect(new GithubAgent().getRoutes().has("POST /github/webhook")).toBe(true);
  });
});
