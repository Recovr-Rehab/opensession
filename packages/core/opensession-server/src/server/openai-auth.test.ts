import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import type { CodexAccount } from "./codex-accounts";
import {
  buildOpenaiRemoteSeedUpload,
  buildSeededOpenaiAuth,
  supportsOpenaiFastMode,
} from "./openai-auth";

describe("OpenAI auth", () => {
  test("does not advertise priority-tier variants on Pi", () => {
    expect(supportsOpenaiFastMode("pi/openai/gpt-5.6-sol")).toBe(false);
  });

  test("round-trips the projected remote seed without copying host credentials", () => {
    const root = mkdtempSync(join(tmpdir(), "opensession-openai-seed-"));
    const hostHome = join(root, "host-only-codex-home");
    const remoteRoot = join(root, "remote-seeds");
    const expires = (Math.floor(Date.now() / 1000) + 3600) * 1000;
    const access = `h.${Buffer.from(JSON.stringify({ exp: expires / 1000 })).toString("base64url")}.s`;
    const homeAccount: CodexAccount = {
      id: "remote-account",
      name: "Remote account",
      kind: "home",
      value: hostHome,
      createdAt: "2026-08-20T00:00:00.000Z",
    };
    const apiKeyAccount: CodexAccount = {
      id: "unsupported-api-key",
      name: "Unsupported API key",
      kind: "api_key",
      value: "sk-must-not-cross-the-sandbox-boundary",
      createdAt: "2026-08-20T00:00:00.000Z",
    };
    try {
      mkdirSync(hostHome, { recursive: true });
      writeFileSync(
        join(hostHome, "auth.json"),
        JSON.stringify({
          tokens: {
            access_token: access,
            account_id: "provider-account-id",
          },
        }),
      );

      const upload = buildOpenaiRemoteSeedUpload([homeAccount, apiKeyAccount]);
      expect(upload.accounts).toEqual([
        { ...homeAccount, value: "opensession-remote-seed" },
      ]);
      expect(upload.skipped).toEqual([
        {
          account: apiKeyAccount,
          reason: "remote Pi runs do not support OpenAI API-key accounts",
        },
      ]);
      expect(
        JSON.stringify({ accounts: upload.accounts, seeds: upload.seeds }),
      ).not.toContain(apiKeyAccount.value);
      expect(JSON.stringify(upload.accounts)).not.toContain(hostHome);

      const seed = upload.seeds[0];
      const accountDir = join(remoteRoot, seed.accountId);
      mkdirSync(accountDir, { recursive: true });
      writeFileSync(join(accountDir, "auth.json"), seed.content);
      expect(buildSeededOpenaiAuth(upload.accounts[0], remoteRoot)).toEqual({
        seeded: {
          openai: {
            type: "oauth",
            access,
            refresh: "codex-managed-no-refresh",
            expires,
            accountId: "provider-account-id",
          },
        },
      });

      const expired = JSON.parse(seed.content);
      expired.openai.expires = Date.now() - 1;
      writeFileSync(join(accountDir, "auth.json"), JSON.stringify(expired));
      expect(buildSeededOpenaiAuth(upload.accounts[0], remoteRoot)).toEqual({
        error: 'ChatGPT account "Remote account" has an expired access token',
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
