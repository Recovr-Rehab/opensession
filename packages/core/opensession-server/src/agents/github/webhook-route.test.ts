import { describe, it, expect } from "bun:test";
import { GithubAgent } from "./index";

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
