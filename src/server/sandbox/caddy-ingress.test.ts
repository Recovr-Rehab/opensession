import { describe, expect, test } from "bun:test";
import {
  caddyfileImportsManagedFragment,
  caddyIngressSnippet,
  webhookHostsFromCaddy,
} from "./caddy-ingress";

describe("sandbox Caddy ingress", () => {
  test("generates only the three sandbox routes and a webhook fallback", () => {
    const snippet = caddyIngressSnippet("https://hooks.example.com");
    expect(snippet).toContain("hooks.example.com {");
    expect(snippet).toContain("handle /run-ws/*");
    expect(snippet).toContain("handle /rpc-ws");
    expect(snippet).toContain("handle /ingress-health");
    expect(snippet.match(/127\.0\.0\.1:3860/g)?.length).toBe(3);
    expect(snippet).toContain("reverse_proxy 127.0.0.1:3848");
    expect(snippet).not.toContain("3850");
  });

  test("discovers a single webhook host in adapted Caddy JSON", () => {
    expect(
      webhookHostsFromCaddy({
        apps: {
          http: {
            servers: {
              main: {
                routes: [
                  {
                    match: [{ host: ["hooks.example.com"] }],
                    handle: [
                      {
                        handler: "subroute",
                        routes: [
                          {
                            handle: [
                              {
                                handler: "reverse_proxy",
                                upstreams: [{ dial: "127.0.0.1:3848" }],
                              },
                            ],
                          },
                        ],
                      },
                    ],
                  },
                ],
              },
            },
          },
        },
      }),
    ).toEqual(["hooks.example.com"]);
  });

  test("managed installation requires an explicit fragment import", () => {
    expect(
      caddyfileImportsManagedFragment("import /etc/caddy/opensession.d/*.caddy\n"),
    ).toBe(true);
    expect(
      caddyfileImportsManagedFragment(
        "import /etc/caddy/opensession.d/sandbox-ingress.caddy\n",
      ),
    ).toBe(true);
    expect(caddyfileImportsManagedFragment("hooks.example.com { respond ok }\n")).toBe(
      false,
    );
  });
});
