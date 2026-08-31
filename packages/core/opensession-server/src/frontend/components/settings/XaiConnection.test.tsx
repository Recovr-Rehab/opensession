import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { XaiConnectionCard } from "./XaiConnection";
import type { XaiDeviceFlow, XaiStatus } from "../../lib/api/xai";

const flow: XaiDeviceFlow = {
  flowId: "flow-1",
  userCode: "ABCD-EFGH",
  verificationUri: "https://x.ai/device",
  expiresAt: Date.now() + 1_800_000,
};

function render(
  status: XaiStatus | null,
  live: XaiDeviceFlow | null = null,
): string {
  return renderToStaticMarkup(
    <XaiConnectionCard
      status={status}
      flow={live}
      busy={false}
      onConnect={() => {}}
      onDisconnect={() => {}}
      onStopWaiting={() => {}}
    />,
  );
}

describe("Grok connection card", () => {
  test("offers a connect action to an administrator", () => {
    const html = render({ connected: false, canManage: true });
    expect(html).toContain("Connect Grok");
    expect(html).not.toContain("Disconnect");
  });

  test("shows the state but no actions to a non-administrator", () => {
    const html = render({ connected: false, canManage: false });
    expect(html).not.toContain("Connect Grok");
    expect(html).not.toContain("Disconnect");
    expect(html).toContain("Only a workspace administrator");
  });

  test("names who connected it and when", () => {
    const html = render({
      connected: true,
      canManage: true,
      connectedBy: "octocat",
      connectedAt: Date.now(),
    });
    expect(html).toContain("Connected by @octocat");
    expect(html).toContain("Today at");
    expect(html).toContain("Disconnect");
  });

  test("a connected non-administrator still sees that it is connected", () => {
    const html = render({
      connected: true,
      canManage: false,
      connectedBy: "octocat",
    });
    expect(html).toContain("Connected by @octocat");
    expect(html).not.toContain("Disconnect");
  });

  test("a live sign-in shows the code and the prefilled link", () => {
    const html = render({ connected: false, canManage: true }, flow);
    expect(html).toContain("ABCD-EFGH");
    expect(html).toContain('href="https://x.ai/device"');
    expect(html).toContain("Waiting for xAI");
    // The user code is the person's to type. The server-side flow handle is
    // not a secret either, but it has no business being rendered.
    expect(html).not.toContain("flow-1");
  });

  test("says it is still checking before the first status arrives", () => {
    expect(render(null)).toContain("Checking Grok");
  });
});
