import { describe, expect, test } from "bun:test";
import {
  cloudflareZoneCandidates,
  privateAppCaddySnippet,
  upsertPrivateAppCaddy,
} from "./private-app-domain";

describe("managed private app domains", () => {
  test("searches Cloudflare zones from the full hostname to the registrable suffix", () => {
    expect(cloudflareZoneCandidates("os.team.example.com")).toEqual([
      "os.team.example.com",
      "team.example.com",
      "example.com",
    ]);
  });

  test("generates a tailnet-bound Caddy site with managed certificate paths", () => {
    const snippet = privateAppCaddySnippet("os.example.com", "100.64.0.10");
    expect(snippet).toContain("bind 100.64.0.10");
    expect(snippet).toContain("tls /etc/opensession/tls/os.example.com.crt /etc/opensession/tls/os.example.com.key");
    expect(snippet).toContain("reverse_proxy 127.0.0.1:3850");
  });

  test("adds and then updates only the marked private app site", () => {
    const initial = "example.net {\n    respond ok\n}\n";
    const added = upsertPrivateAppCaddy(initial, "os.example.com", "100.64.0.10");
    expect(added).toContain("# BEGIN OPENSESSION PRIVATE APP");
    const updated = upsertPrivateAppCaddy(added, "new.example.com", "100.64.0.20");
    expect(updated).not.toContain("os.example.com {");
    expect(updated).toContain("new.example.com {");
    expect(updated).toContain("bind 100.64.0.20");
    expect(updated.match(/BEGIN OPENSESSION PRIVATE APP/g)).toHaveLength(1);
  });

  test("does not take ownership of an existing unmarked site", () => {
    expect(() => upsertPrivateAppCaddy(
      "os.example.com {\n    reverse_proxy 127.0.0.1:3850\n}\n",
      "os.example.com",
      "100.64.0.10",
    )).toThrow("unmanaged Caddy site");
  });
});
