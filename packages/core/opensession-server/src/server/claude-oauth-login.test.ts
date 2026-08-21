import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  listAccountsPublic,
  pickAccount,
  refreshAllUsage,
} from "./claude-accounts";
import { completeClaudeLogin, startClaudeLogin } from "./claude-oauth-login";

const realFetch = globalThis.fetch;
let dir = "";
let accessToken = "sk-ant-oat01-first";

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "opensession-claude-oauth-"));
  process.env.OPENSESSION_STATE_DIR = dir;
  process.env.OPENSESSION_CLAUDE_ACCOUNTS_PATH = join(dir, "accounts.json");
  accessToken = "sk-ant-oat01-first";
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith("/v1/oauth/token")) {
      return Response.json({
        access_token: accessToken,
        refresh_token: "refresh-next",
        expires_in: 28_800,
        scope: "user:profile user:inference",
        account: { email_address: "alex@example.com" },
      });
    }
    if (url.endsWith("/api/oauth/profile")) {
      return Response.json({
        account: { email_address: "alex@example.com" },
        organization: { organization_type: "default_claude_max" },
      });
    }
    if (url.endsWith("/api/oauth/usage")) {
      return Response.json({
        five_hour: { utilization: 12, resets_at: null },
        seven_day: { utilization: 34, resets_at: null },
      });
    }
    throw new Error(`Unexpected fetch: ${url} ${init?.method || "GET"}`);
  }) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
  delete process.env.OPENSESSION_STATE_DIR;
  delete process.env.OPENSESSION_CLAUDE_ACCOUNTS_PATH;
  rmSync(dir, { recursive: true, force: true });
});

describe("Claude OAuth account setup", () => {
  test("creates a runnable account without a setup token and mirrors refreshes", async () => {
    const started = await startClaudeLogin();
    expect(started).not.toHaveProperty("error");
    if ("error" in started) throw new Error(started.error);

    const completed = await completeClaudeLogin(
      started.id,
      "authorization-code#state",
    );
    expect(completed).not.toHaveProperty("error");
    if ("error" in completed) throw new Error(completed.error);

    expect(completed.account).toMatchObject({
      name: "alex@example.com",
      email: "alex@example.com",
      authKind: "oauth",
      usable: true,
    });
    expect(pickAccount()?.token).toBe("sk-ant-oat01-first");

    const credentialsPath = completed.account.credentialsPath!;
    const credentials = JSON.parse(readFileSync(credentialsPath, "utf8"));
    credentials.claudeAiOauth.expiresAt = 0;
    writeFileSync(credentialsPath, JSON.stringify(credentials));
    accessToken = "sk-ant-oat01-refreshed";

    await refreshAllUsage();

    expect(pickAccount()?.token).toBe("sk-ant-oat01-refreshed");
    expect(listAccountsPublic()[0]?.authKind).toBe("oauth");
    expect(
      JSON.parse(
        readFileSync(process.env.OPENSESSION_CLAUDE_ACCOUNTS_PATH!, "utf8"),
      ),
    ).toMatchObject({
      accounts: [{ token: "sk-ant-oat01-refreshed", authKind: "oauth" }],
    });
  });
});
